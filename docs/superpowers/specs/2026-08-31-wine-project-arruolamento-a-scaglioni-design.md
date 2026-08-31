# Wine Project — arruolamento a scaglioni

Data: 2026-08-31
Stato: approvato, da implementare

## Problema

Il tag `event_tag = 'wine-project'` fa oggi due lavori insieme: dice *chi fa
parte del bacino* e, di fatto, *chi parte subito*. `backfillWineProjectFollowups`
ripassa a ogni giro tutti i contatti taggati e li arruola tutti, quindi taggare
3.300 cantine significa creare 3.300 email 1 nello stesso istante.

L'unico freno è `daily_send_cap`, che però è un tetto sugli **invii totali** e
viene conteggiato su tutte e cinque le sequenze insieme. Con un bacino grande
il difetto è strutturale: man mano che i follow-up si accumulano, saturano il
tetto e i contatti nuovi smettono di partire senza che nulla lo segnali.

Serve separare le due domande: quante cantine **entrano** ogni giorno, e quante
email **escono** ogni giorno.

## Decisione

Portare Wine sul modello che Hospitality usa già (`commercial_enrollments`,
`enrollEligibleHospitalityContacts`), con lo stesso vocabolario, invece di
inventare un meccanismo parallelo. Il tag torna a significare solo
appartenenza al bacino; l'ingresso in sequenza diventa un atto distinto,
governato da una manopola dedicata.

## Architettura

### Impostazioni

Nuova colonna su `wine_project_automation_settings`:

```sql
daily_enrollment_cap integer not null default 30
  check (daily_enrollment_cap between 1 and 5000)
```

Le due manopole restano indipendenti:

| Campo | Governa |
|---|---|
| `daily_enrollment_cap` | cantine nuove immesse in sequenza ogni giorno |
| `daily_send_cap` | email totali inviabili ogni giorno, follow-up inclusi |

### Arruolamento

`backfillWineProjectFollowups` cambia comportamento a parità di firma e di
chiamante (`POST /api/automation/wine-project-followups`).

1. Se `settings.enabled` è falso, esce con zero. Invariato.
2. Calcola `rimanenti = daily_enrollment_cap − (eventi con sequence = 1 creati
   oggi)`. Il giorno è quello di Roma, coerente con `startOfRomeDay()` già usato
   dal conteggio degli invii. Se `rimanenti < 1`, esce.
3. Carica in memoria l'insieme dei `contact_id` già presenti in
   `wine_project_followup_events`.
4. Scorre i candidati in **paginazione keyset su `id` crescente** (`.gt('id',
   cursor)`, pagine da 500), saltando quelli già arruolati, finché non ne
   raccoglie `rimanenti` o esaurisce il bacino.
5. Per ciascuno chiama `planWineProjectFollowups`, che dopo il commit `e09fb1c`
   crea **solo l'email 1**. Le successive nascono a catena dopo ogni invio
   riuscito.

Filtri sui candidati, invariati rispetto a oggi: `event_tag = 'wine-project'`,
`email_unsubscribed_at is null`, `status not in ('Closed','Paid','Lost')`.
In più il contatto deve avere un'email.

**Perché keyset e non offset.** Con un bacino in cui i primi contatti sono già
arruolati, una `limit` semplice restituirebbe sempre la stessa prima pagina di
già-entrati e non arruolerebbe mai nessuno. È lo stesso motivo per cui
`enrollEligibleHospitalityContacts` usa keyset.

**Ordine.** Per `id` crescente: deterministico, stabile fra un giro e l'altro, e
identico alla scelta già fatta su Hospitality. Non corrisponde a un criterio
commerciale; se in futuro servirà pescare per priorità o per data, si cambia
solo la clausola di ordinamento.

### Interfaccia

Campo numerico "Nuovi contatti al giorno" in `/impostazioni/wine-project`,
accanto a "Invii massimi al giorno". Va aggiunto al tipo `WineProjectSettings`
lato web, ai valori di default e a `normalizeWineProjectAutomationSettings`
lato server.

## Flusso dati

```
cron wine-project-followups
  ├─ backfill: arruola fino a daily_enrollment_cap nuovi → email 1 'scheduled'
  └─ queue: 'scheduled' con scadenza passata → 'queued'
                    ↓
cron wine-project-campaigns
  ├─ invia i 'queued' fino a daily_send_cap → 'sent'
  └─ scheduleNextWineProjectFollowup → crea la tappa successiva
```

## Gestione degli errori

L'arruolamento **fallisce chiuso**. Se la colonna `daily_enrollment_cap` non
esiste ancora (migration non applicata) o le impostazioni non sono leggibili,
la funzione arruola zero e riporta l'anomalia nella risposta dell'endpoint.

Il ripiego sul comportamento attuale sarebbe la scelta sbagliata: un errore di
lettura arruolerebbe l'intero bacino in un colpo, cioè esattamente il danno che
questo lavoro previene. Meglio un giorno di invii mancati che 3.300 email
partite per un default.

`planWineProjectFollowups` continua a fare upsert con `ignoreDuplicates` su
`(contact_id, sequence)`: un doppio giro di cron o due worker in parallelo non
possono creare doppioni.

## Test

- **Unitario sul conteggio**: con `daily_enrollment_cap = 30` e 12 email 1 già
  create oggi, l'arruolamento ne prende 18.
- **Unitario sulla paginazione**: bacino di 600 contatti di cui i primi 550 già
  arruolati, cap 30 → arruola 30 dei restanti 50, non zero.
- **Fail-closed**: impostazioni non leggibili → zero arruolati, anomalia
  riportata.
- **Verifica in produzione**: con `enabled` ancora falso, chiamare l'endpoint e
  controllare che l'arruolamento resti zero; poi attivare su un cap piccolo e
  verificare il numero di email 1 create.

## Fuori ambito

- Hospitality, che ha già il proprio motore di arruolamento.
- L'unificazione dei due sistemi su `commercial_*`: è la direzione giusta ma è
  una migrazione a sé, da affrontare dopo il pilota Wine.
- Scaglioni etichettati per confrontare le performance per segmento: si possono
  ottenere con `list_name`, che già esiste, senza codice nuovo.
