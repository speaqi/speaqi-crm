# SPEAQI CRM

CRM operativo per pipeline, follow-up e lead ingestion.

## Stack

- Next.js 15
- Supabase: auth + database
- Resend: email reminder
- n8n: automazioni orchestrate via workflow JSON in [`n8n/workflows`](/Users/massimo/Documents/thebest/speaqi-crm/n8n/workflows)

## Setup

1. Configura le variabili in `.env.local` partendo da `.env.local.example`.
2. Applica la migration Supabase:
   - [`supabase/migrations/20260325150000_crm_schema.sql`](/Users/massimo/Documents/thebest/speaqi-crm/supabase/migrations/20260325150000_crm_schema.sql)
3. Avvia l'app:

```bash
npm run dev
```

## Modello dati

- `contacts`: lead e contatti commerciali
- `activities`: timeline completa delle interazioni
- `tasks`: prossime azioni e follow-up
- `pipeline_stages`: stadi configurabili della pipeline
- `email_logs`: log minimo degli invii

## Rotte principali

- `GET/POST /api/contacts`
- `GET/PATCH/DELETE /api/contacts/:id`
- `GET/POST /api/contacts/:id/activities`
- `GET/POST /api/contacts/:id/tasks`
- `GET /api/tasks`
- `PATCH /api/tasks/:id`
- `GET/PUT /api/pipeline-stages`
- `POST /api/import/legacy`
- `POST /api/speaqi/leads`
- `POST /api/automation/followups`
- `POST /api/automation/stale-leads`

## Migrazione legacy

Alla prima apertura, se il nuovo schema è vuoto, l'app prova a importare i dati dalla tabella legacy `user_state`.

Per analizzare un CSV legacy esterno e produrre un CSV pulito compatibile con il modello `contacts`:

```bash
npm run analyze:legacy -- "/percorso/file.csv" --contacts-csv "/percorso/rubrica.csv"
```

Lo script genera in `/tmp`:

- `report.md`: riepilogo qualità dati + mappatura proposta
- `contacts_import.csv`: CSV pulito pronto per import/mapping
- `matches_review.csv`: match trovati contro la rubrica, utile per revisione manuale

Per i contatti aperti senza `Scadenza`, lo script assegna automaticamente un `next_followup_at` a `+3` giorni per restare compatibile con le regole del CRM.

Per importare il CSV pulito dentro Supabase e farlo comparire nel CRM:

```bash
npm run import:contacts-csv -- "/percorso/contacts_import.csv" --email "utente@dominio.it" --password "********"
```

Lo script:

- crea gli stage standard se non esistono
- fa upsert su `contacts` usando `legacy_id`
- crea i task `follow-up` mancanti per i contatti aperti

In alternativa, se hai la service role in `.env.local`, puoi usare `--user-id "<uuid>"`.

## n8n

I workflow template sono in:

- [`n8n/workflows/01-followups.json`](/Users/massimo/Documents/thebest/speaqi-crm/n8n/workflows/01-followups.json)
- [`n8n/workflows/02-stale-leads.json`](/Users/massimo/Documents/thebest/speaqi-crm/n8n/workflows/02-stale-leads.json)
- [`n8n/workflows/03-speaqi-webhook.json`](/Users/massimo/Documents/thebest/speaqi-crm/n8n/workflows/03-speaqi-webhook.json)
