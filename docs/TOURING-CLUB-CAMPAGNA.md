# Touring Club Italia — campagna commerciale

Due campagne sul motore generico (`commercial_campaigns`), una per lingua,
alimentate dallo stesso CSV Touring Club.

| | italiana | inglese |
|---|---|---|
| slug | `touring-club` | `touring-club-en` |
| `event_tag` | `touring-club` | `touring-club-en` |
| `locale` | `it` | `en` |
| contatti | 26.412 | 7.488 |
| step | 5 (giorni 1, 4, 9, 16, 28) | 5 (idem) |

Servono due campagne e non una: il motore tiene **una sola sequenza per
campagna** e sceglie lo step per numero, non per lingua del contatto.

## Cosa c'e gia

- Righe campagna e 10 step: **create in produzione**, `status = paused`,
  `approval_status = analysis`.
- Testi: `src/lib/server/touring-club-campaign.ts` (unica fonte).
- Colonna `locale` su `commercial_campaigns` (migration
  `20260906120000_commercial_campaign_locale.sql`, gia applicata): decide saluto,
  fallback azienda, etichetta del bottone e piede di disiscrizione. Prima erano
  scritti in italiano dentro al codice, quindi una campagna inglese usciva con la
  cornice italiana.

## Cosa manca, in ordine

### 1. Caricare i contatti nel CRM

```bash
# prova senza scrivere niente
npm run touring:import -- --file "/percorso/Touring_Club_Italia.csv" --emit-acumbamail /tmp/touring.json

# scrittura vera
npm run touring:import -- --file "/percorso/Touring_Club_Italia.csv" --emit-acumbamail /tmp/touring.json --apply --user-id 212e3b5a-f099-4b40-9ace-b6c25f1db562
```

`NEXT_PUBLIC_SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` vengono letti da
`.env.local` se non sono gia nell'ambiente. Anche `--user-id` si puo omettere se
`.env.local` ha `AUTOMATION_WORKSPACE_USER_ID`.

Cosa fa, oltre a importare:

- **Ripara il mojibake.** Il CSV e UTF-8 gia letto una volta come MacRoman
  (`Caff√® Letterario` invece di `Caffè Letterario`): senza riparazione 1.518
  nomi partirebbero storpiati dentro le email.
- **Divide per lingua.** `paese = IT` oppure regione italiana nell'indirizzo —
  il campo `paese` e vuoto su 10.515 righe ma 9.103 di queste sono italiane, e
  senza il recupero finirebbero nella sequenza inglese.
- **Deduplica per email**: 3.031 righe collassate.
- **Esclude 934 caselle interne** Touring (`@touringclub.it`,
  `@volontaritouring.it`): sono la fonte della lista, non clienti potenziali.
- Scarta 51 email non valide.
- Scrive `marketing_eligibility = 'eligible'` direttamente, quindi **non serve**
  chiamare `/api/commercial/campaigns/[id]/audience`.

Totale scritto: 33.900 contatti `contact_scope = 'holding'`.

### 2. Creare la lista su Acumbamail

```bash
npm run touring:acumbamail -- --from /tmp/touring.json --name "Touring Club Italia" --apply
```

Anche qui `ACUMBAMAIL_AUTH_TOKEN` arriva da `.env.local` se non e nell'ambiente.

Senza `--apply` e un dry run. Lo script crea la lista, aggiunge i merge tag
(`first_name`, `full_name`, `greeting`, `company`, `demo_url`) e carica gli
iscritti a blocchi di 500.

> La lista Acumbamail **non** va agganciata come `acumbamail_list_id` alle
> campagne: i contatti arrivano dal CRM gia divisi per lingua, mentre la lista e
> unica e mescolata — agganciarla farebbe finire iscritti inglesi nella sequenza
> italiana. Serve come archivio e per eventuali invii broadcast.

### 3. Puntare il bottone a una pagina che esiste

`landing_url` e `https://speaqi.com/demo/touring-club` su entrambe le campagne,
ma **quella pagina va creata**, altrimenti la CTA di tutte e cinque le email
porta a un 404.

```
PATCH /api/commercial/campaigns/<id>  { "landing_url": "https://..." }
```

### 4. Sbloccare l'invio

Il motore non spedisce finche tutte e quattro non sono vere:

1. `COMMERCIAL_OUTREACH_SEND_ENABLED=true` nell'ambiente;
2. `approval_status = 'approved'` sulla campagna;
3. `status = 'active'`;
4. il cron `12-hospitality-commercial.json` attivo **senza** `dry_run: true`.

Da `/commerciale/<id>` si fa tutto tranne la variabile d'ambiente.

## Prima di aprire il rubinetto

Il motore campagne **non ha mai inviato un messaggio in produzione**
(`commercial_messages` con `status = 'sent'`: zero). Queste sono le prime
33.900 email che gli si chiede di gestire.

Conviene un pilota: `daily_cap` basso (20-30) sulla sola campagna italiana per
due o tre giorni, guardare recapito, aperture e reclami, e solo dopo alzare il
tetto e attivare l'inglese. `daily_enrollment_cap` e a 200: a quel ritmo
l'arruolamento completo dura circa sei mesi, quindi va alzato una volta che il
pilota convince.

Vale anche la parte legale: sono 33.900 contatti raccolti da una lista di terzi,
mai passati da un opt-in verso Speaqi. `require_marketing_attestation` e a
`false` su entrambe le campagne — scelta deliberata per non bloccare l'import,
non un giudizio sulla base giuridica.
