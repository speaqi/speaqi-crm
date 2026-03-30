# SPEAQI CRM

CRM operativo per pipeline, follow-up e lead ingestion.

## Stack

- Next.js 15
- Supabase: auth + database
- Resend: email reminder
- Gmail API: invio email e sincronizzazione thread
- n8n: automazioni orchestrate via workflow JSON in [`n8n/workflows`](/Users/massimo/Documents/thebest/speaqi-crm/n8n/workflows)

## Setup

1. Configura le variabili in `.env.local` partendo da `.env.local.example`.
2. Applica la migration Supabase:
   - [`supabase/migrations/20260325150000_crm_schema.sql`](/Users/massimo/Documents/thebest/speaqi-crm/supabase/migrations/20260325150000_crm_schema.sql)
   - [`supabase/migrations/20260327154240_gmail_integration.sql`](/Users/massimo/Documents/thebest/speaqi-crm/supabase/migrations/20260327154240_gmail_integration.sql)
   - [`supabase/migrations/20260330094500_ai_ready_crm.sql`](/Users/massimo/Documents/thebest/speaqi-crm/supabase/migrations/20260330094500_ai_ready_crm.sql)
3. Avvia l'app:

```bash
npm run dev
```

## Modello dati

- `contacts`: lead e contatti commerciali
- `activities`: timeline completa delle interazioni
- `tasks`: prossime azioni e follow-up
- `lead_memories`: memoria sintetica AI per lead
- `ai_decision_logs`: audit delle decisioni prese dagli endpoint AI
- `pipeline_stages`: stadi configurabili della pipeline
- `email_logs`: log minimo degli invii
- `gmail_accounts`: account Gmail collegato per utente
- `gmail_messages`: thread email sincronizzati e legati ai contatti

Campi AI-ready aggiunti:

- `contacts.company`, `contacts.country`, `contacts.language`
- `contacts.score`, `contacts.assigned_agent`, `contacts.next_action_at`
- `activities.metadata`
- `tasks.action`, `tasks.priority`, `tasks.idempotency_key`

## Rotte principali

- `GET/POST /api/contacts`
- `GET/PATCH/DELETE /api/contacts/:id`
- `GET/POST /api/contacts/:id/activities`
- `GET/POST /api/contacts/:id/tasks`
- `GET /api/tasks`
- `PATCH /api/tasks/:id`
- `GET/PUT /api/pipeline-stages`
- `GET/DELETE /api/gmail`
- `POST /api/gmail/connect`
- `POST /api/import/legacy`
- `POST /api/speaqi/leads`
- `POST /api/automation/followups`
- `POST /api/automation/stale-leads`
- `POST /api/voice/command`

## API AI-ready

Layer spec-compatible sopra il modello storico `contacts/activities/tasks`, pensato per agenti esterni che devono leggere e scrivere tutto dal CRM.

Lead management:

- `GET /api/leads?status=&limit=&source=`
- `GET /api/leads/:id`
- `POST /api/leads`
- `POST /api/leads/update`
- `POST /api/leads/:id/status`
- `GET /api/leads/next-actions`

Memory:

- `GET /api/leads/:id/memory`
- `POST /api/leads/:id/memory/update`
- `POST /api/ai/update-memory`

Activity e task:

- `POST /api/activity/log`
- `GET /api/tasks/pending`
- `POST /api/tasks/create`
- `POST /api/tasks/:id/complete`

AI endpoints:

- `POST /api/ai/classify-reply`
- `POST /api/ai/next-action`
- `POST /api/ai/score-lead`

Comportamento chiave:

- `email_sent` crea un task di attesa/follow-up a 24h
- `email_reply` aggiorna memoria, stato, score e next action
- `next_action_at` e `next_followup_at` vengono riallineati ai task pending
- i task possono essere resi idempotenti via `idempotency_key`

## Gmail

Variabili richieste in `.env.local`:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `GMAIL_TOKEN_ENCRYPTION_KEY`

Callback OAuth da registrare nel progetto Google Cloud:

- `http://localhost:3000/api/gmail/callback` in locale
- l'URL pubblico equivalente in produzione

Flusso attuale:

- pagina [`/gmail`](/Users/massimo/Documents/thebest/speaqi-crm/src/app/(app)/gmail/page.tsx) per collegare o scollegare l'account
- invio email direttamente nella scheda contatto
- sync dei messaggi Gmail nella scheda contatto, con recupero delle email già inviate o ricevute per quel contatto
- follow-up opzionale creato automaticamente dopo un invio email dal CRM

## Voice commands

Variabili richieste in `.env.local`:

- `OPENAI_API_KEY`
- `OPENAI_MODEL` opzionale, default `gpt-5-mini`

Flusso attuale:

- pagina [`/voice`](/Users/massimo/Documents/thebest/speaqi-crm/src/app/(app)/voice/page.tsx) per registrare o incollare il comando
- endpoint [`/api/voice/command`](/Users/massimo/Documents/thebest/speaqi-crm/src/app/api/voice/command/route.ts) che interpreta il testo con OpenAI
- match dei candidati fatto sulle schede CRM usando nome, telefono, email e `legacy_id`
- se il match e affidabile, il CRM pianifica subito il task di follow-up e aggiorna il calendario

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
