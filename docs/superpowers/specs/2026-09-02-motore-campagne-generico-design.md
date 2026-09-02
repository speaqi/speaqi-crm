# Motore campagne generico

Data: 2026-09-02
Stato: approvato, da implementare

## Problema

Ogni verticale commerciale oggi richiede codice nuovo. Wine Project ha tabelle
proprie (`wine_project_automation_settings`, `wine_project_followup_events`),
rotte proprie e una pagina propria sotto `/impostazioni/wine-project`.
Hospitality ha il suo motore su `commercial_*`, la sua rotta e la sua pagina.

Aggiungere consorzi, GAL, comuni o aree SNAI significherebbe, con questa
impostazione, duplicare una terza e una quarta volta lo stesso impianto. Il
lavoro cresce linearmente col numero di verticali e le correzioni vanno
riportate a mano su ogni copia — è già successo: lo stesso difetto del
`field_type` Acumbamail esisteva in entrambe le implementazioni.

Serve che aggiungere un verticale sia un atto di configurazione, non di
sviluppo.

## Decisione

Riusare `commercial_*`, che è già un motore multi-campagna, e costruirci sopra
l'area Campagne. Nessuna tabella nuova.

Wine Project **resta sulle sue tabelle** e continua a girare come ora. La sua
migrazione sul motore è un lavoro separato, da fare quando le campagne nuove
avranno collaudato il motore: la campagna Wine è in volo (email 1 inviata a 30
cantine, email 2 in coda) e migrarla adesso metterebbe a rischio l'unica cosa
che oggi funziona.

## Cosa esiste già

`commercial_campaigns` è generico per costruzione:

| Colonna | Copre |
|---|---|
| `vertical` | wine, hospitality, consorzi, gal, comuni, snai… |
| `cadence_days integer[]` | cadenza libera, non cinque tappe fisse |
| `daily_cap` | tetto invii giornaliero |
| `acumbamail_list_id` | lista sorgente |
| `status` | `paused` / `active` / `completed` |
| `sender_name`, `sender_email`, `reply_to` | mittente per campagna |
| `stop_on_open`, `stop_on_click` | condizioni di stop configurabili |
| `automatic_pause_bounce_rate`, `automatic_pause_complaint_rate` | sicurezza |

`commercial_campaign_steps` regge fino a 20 step con oggetto, testo e HTML per
ciascuno. `commercial_enrollments` e `commercial_messages` tracciano stato per
contatto e per messaggio.

L'API Hospitality è 99 righe e l'unico punto legato al verticale è la chiamata
`ensureHospitalityCampaign()`; tutto il resto lavora già su `campaign.id`.

## Architettura

### Colonne nuove su `commercial_campaigns`

Tre valori oggi cablati nel codice diventano configurazione:

```sql
slug           text     -- prefisso chiavi Acumbamail e utm_campaign
brand_eyebrow  text     -- riga di intestazione nell'HTML dell'email
landing_url    text     -- destinazione del bottone CTA
```

Oggi valgono rispettivamente `hospitality-e{n}-…`, `SPEAQI · HOSPITALITY
EXPERIENCE` e un URL costruito nel codice della rotta. La migration li
popola con i valori attuali per la campagna Hospitality esistente, così il
comportamento non cambia.

Aggiunge anche i due criteri di filtro import, per campagna:

```sql
import_exclude_keyword text  -- default 'consorzio'
import_required_country text -- default 'ITALIA'
```

### API

Sostituisce `/api/commercial/hospitality` con due rotte generiche:

- `GET /api/commercial/campaigns` — elenco, raggruppabile per verticale
- `POST /api/commercial/campaigns` — crea campagna e step predefiniti
- `GET|PATCH /api/commercial/campaigns/[id]` — dettaglio e aggiornamento
- `PUT /api/commercial/campaigns/[id]/steps` — salva gli step

`ensureHospitalityCampaign()` viene generalizzata in
`ensureCampaignSteps(campaign)`: alla creazione la campagna nasce con cinque
step precompilati, da riscrivere. Nasce utilizzabile, non vuota.

La rotta `/api/commercial/hospitality` resta come alias sottile sulla nuova,
per non rompere la pagina Hospitality esistente durante la transizione.

### Arruolamento dalla lista Acumbamail

Il modello è: **il contatto entra nel CRM nel momento in cui gli parte
l'email**, non mille in anticipo.

`enrollEligibleHospitalityContacts` diventa `enrollCampaignContacts(campaign,
limit)`. A ogni giro:

1. Calcola `rimanenti = daily_cap − arruolati oggi per questa campagna`.
2. Se `rimanenti < 1`, esce.
3. Arruola prima dai contatti CRM che hanno già `event_tag` della campagna e
   non sono ancora iscritti — è il comportamento attuale, va preservato perché
   i 2.704 contatti Wine e i contatti Hospitality esistenti stanno lì.
4. Se restano posti e `acumbamail_list_id` è valorizzato, scarica la lista,
   scarta chi ha già quell'email in `contacts` (qualunque tag), applica
   `import_exclude_keyword` e `import_required_country`, e per i soli
   `rimanenti` crea contatto e iscrizione nella stessa operazione.

Chi non supera il filtro paese viene creato con `event_tag` suffisso `_en` e
nessuna iscrizione — parcheggiato, non perso. È il trattamento già applicato
a mano agli 84 contatti stranieri di Wine.

Scaricare una lista da 3.000 iscritti richiede uno o due secondi (misurato):
sostenibile a ogni giro senza cache.

### Interfaccia

Due pagine, non una per verticale:

- `/campagne` — elenco per verticale, stato, progresso, pulsante "Nuova
  campagna"
- `/campagne/[id]` — email, cadenza, lista sorgente e filtri, tetti, i due
  interruttori (pausa e invio reale), statistiche, ultimi invii

La creazione chiede nome, verticale, tag contatti e mittente. Tutto il resto
si configura dopo, sulla pagina della campagna.

### Menù

Nuova voce **Campagne** in `NAV_ITEMS`, che porta a `/campagne`.

Oggi il menù ha 7 voci a fronte di 22 pagine: quindici sono raggiungibili solo
digitando l'URL, e un commento nel codice lo dichiara esplicitamente. Questa
spec **non** riorganizza le altre quattordici: al termine del lavoro le pagine
orfane vanno elencate all'utente perché decida cosa promuovere nel menù, cosa
spostare sotto Impostazioni e cosa archiviare. Nasconderle o spostarle
d'iniziativa rischia di far sparire strumenti in uso.

## Flusso dati

```
cron n8n (ogni 30 minuti)
  └─ per ogni campagna attiva:
       ├─ enrollCampaignContacts: contatti CRM col tag, poi lista Acumbamail
       │    → crea contatto + iscrizione, fino a daily_cap
       ├─ invio degli step maturi via Acumbamail
       └─ sincronizzazione aperture, click, risposte
```

## Gestione degli errori

**Fallimento isolato per campagna.** Un errore su una campagna (lista
inesistente, token scaduto, rete) non deve impedire alle altre di girare: il
ciclo raccoglie l'errore, lo riporta nella risposta e prosegue.

**Import che fallisce chiuso.** Se la lettura della lista non riesce,
l'arruolamento da quella fonte è zero e viene dichiarato. Non si ripiega su un
comportamento alternativo: arruolare per errore l'intero bacino è il danno
peggiore possibile qui.

**Invio spento alla nascita.** Una campagna nuova ha `status: 'paused'`.
Nessuna campagna può spedire prima che qualcuno l'abbia guardata e attivata
deliberatamente.

**Nessun doppione.** `commercial_enrollments` ha già `unique(campaign_id,
contact_id)`: un doppio giro di cron o due worker in parallelo non possono
iscrivere due volte lo stesso contatto.

## Test

- **Arruolamento misto**: campagna con 10 contatti CRM taggati non iscritti e
  una lista Acumbamail, `daily_cap` 30 → 10 dal CRM e 20 dalla lista.
- **Tetto rispettato**: con 25 già arruolati oggi e cap 30 → ne arruola 5.
- **Filtro**: un record con `consorzio` nel nome azienda non viene creato; uno
  con paese diverso viene creato col tag `_en` e senza iscrizione.
- **Duplicati**: una email già presente in `contacts` non viene ricreata.
- **Isolamento errori**: due campagne, una con `acumbamail_list_id`
  inesistente → l'altra arruola regolarmente e la risposta segnala l'errore.
- **Verifica in produzione**: creare una campagna di prova con cap 1 e lista
  nota, controllare che nasca un solo contatto e una sola iscrizione, poi
  eliminarla.

## Fuori ambito

- **Migrazione di Wine su `commercial_*`.** Lavoro separato, da affrontare a
  motore collaudato. Fino ad allora Wine gira sulle sue tabelle e sulla sua
  pagina.
- **Riorganizzazione delle quattordici pagine orfane.** Solo l'elenco e la
  proposta, la decisione è dell'utente.
- **Import da CSV o altre fonti.** La sorgente è Acumbamail, come confermato.
- **Aggiornamento dei contatti esistenti.** Chi ha già quell'email nel CRM
  viene saltato, non aggiornato.
