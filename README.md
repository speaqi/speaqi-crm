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

## n8n

I workflow template sono in:

- [`n8n/workflows/01-followups.json`](/Users/massimo/Documents/thebest/speaqi-crm/n8n/workflows/01-followups.json)
- [`n8n/workflows/02-stale-leads.json`](/Users/massimo/Documents/thebest/speaqi-crm/n8n/workflows/02-stale-leads.json)
- [`n8n/workflows/03-speaqi-webhook.json`](/Users/massimo/Documents/thebest/speaqi-crm/n8n/workflows/03-speaqi-webhook.json)
