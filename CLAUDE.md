# CLAUDE.md — Speaqi CRM

## Project Overview

**Speaqi CRM** is a production-grade sales pipeline CRM for lead management, follow-ups, and automation. Built with Next.js 15 + Supabase, deployed on Railway.app.

## Tech Stack

- **Framework**: Next.js 15 (React 19, App Router)
- **Language**: TypeScript 5 (strict mode)
- **Database & Auth**: Supabase (PostgreSQL + RLS + SSR auth)
- **Email**: Resend (reminders), Gmail API (OAuth 2.0 sync)
- **AI**: OpenAI (voice commands, lead scoring, classification)
- **Automation**: n8n workflows
- **Webhook Ingestion**: Acumbamail
- **Deployment**: Railway.app (Nixpacks builder)

## Commands

```bash
npm run dev          # Dev server on localhost:3000
npm run build        # Production build
npm start            # Production start (via start.cjs for Railway health checks)
npm run lint         # ESLint

# Data import utilities
npm run analyze:legacy -- "/path/file.csv"
npm run import:contacts-csv -- "/path/file.csv" --email "user@domain.it" --password "****"
```

## Environment Variables

Copy `.env.local.example` to `.env.local`. Required keys:

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (server-only admin ops) |
| `RESEND_API_KEY` | Resend email API key |
| `GOOGLE_CLIENT_ID` | Gmail OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Gmail OAuth secret |
| `GOOGLE_REDIRECT_URI` | Gmail OAuth callback URL |
| `GMAIL_TOKEN_ENCRYPTION_KEY` | 32+ char secret for token encryption |
| `OPENAI_API_KEY` | OpenAI API key |
| `OPENAI_MODEL` | Model ID (e.g. `gpt-4o-mini`) |
| `AUTOMATION_SECRET` | Auth secret for n8n automation endpoints |
| `SPEAQI_WEBHOOK_SECRET` | Auth secret for Acumbamail webhook |
| `REMINDER_EMAIL` | From address for reminder emails |
| `ACUMBAMAIL_WEBHOOK_USER_ID` | Acumbamail integration user ID |
| `ACUMBAMAIL_WEBHOOK_TOKEN` | Acumbamail integration token |
| `ACUMBAMAIL_DEFAULT_SOURCE` | Default source tag (e.g. `vinitaly`) |
| `ACUMBAMAIL_DEFAULT_CONTACT_SCOPE` | Default scope (e.g. `holding`) |

> **Build note**: `NEXT_PUBLIC_*` variables must be available at Docker **build** time (passed as `ARG`), not just at runtime.

## Database

Supabase PostgreSQL with Row Level Security on all tables.

Apply migrations:
```bash
supabase migration up
```

**Core tables:**

| Table | Purpose |
|---|---|
| `pipeline_stages` | Configurable pipeline stages |
| `contacts` | Leads/contacts (AI-ready fields: score, category, country, language, assigned_agent, next_action_at) |
| `activities` | Full interaction timeline per contact |
| `tasks` | Follow-ups and next actions (idempotency_key for deduplication) |
| `lead_memories` | AI-generated synthetic memory per lead |
| `ai_decision_logs` | Audit trail of AI decisions |
| `email_logs` | Email sending history |
| `gmail_accounts` | Connected Gmail accounts (encrypted tokens) |
| `gmail_messages` | Synced Gmail threads linked to contacts |
| `team_members` | Multi-user team management |

Migrations live in `supabase/migrations/` (timestamped SQL files).

## Directory Structure

```
src/
├── app/
│   ├── (app)/              # Authenticated routes
│   │   ├── dashboard/
│   │   ├── contacts/
│   │   ├── kanban/
│   │   ├── calendario/     # 5-day planning view with drag-and-drop
│   │   ├── attivita/       # Analytics team + log giornaliero + follow-up inbox
│   │   ├── quick-capture/
│   │   ├── gmail/
│   │   ├── voice/
│   │   ├── vinitaly/       # Holding area for event leads
│   │   ├── import/
│   │   ├── speaqi/
│   │   └── impostazioni/   # Settings & team admin
│   ├── api/                # API routes
│   │   ├── contacts/
│   │   ├── leads/          # AI-ready lead API
│   │   ├── tasks/
│   │   ├── activities/
│   │   ├── pipeline-stages/
│   │   ├── gmail/
│   │   ├── analytics/      # Team analytics: breakdown per agente + giorno
│   │   ├── ai/             # score, classify, next-action, update-memory
│   │   ├── automation/     # followups, stale-leads
│   │   ├── email/
│   │   ├── import/
│   │   ├── integrations/   # Acumbamail webhook
│   │   ├── mcp/            # Model Context Protocol server
│   │   ├── openapi/
│   │   ├── voice/
│   │   ├── team-members/
│   │   └── health/
│   └── api-docs/           # Swagger UI
├── components/
│   ├── crm/                # ContactDrawer, ContactModal, CallOutcomeModal
│   ├── layout/             # Sidebar, Topbar, BrandLockup
│   └── ui/                 # Modal, Toast
├── lib/
│   ├── server/             # Server-only utilities
│   │   ├── crm.ts          # Pipeline & contact core logic
│   │   ├── lead-ops.ts     # Lead creation, scoring, memory
│   │   ├── ai-ready.ts     # Data normalization for AI agents
│   │   ├── gmail.ts        # Gmail API, token encryption, sync
│   │   └── supabase.ts     # Supabase server helpers
│   ├── api.ts              # Client-side API helpers
│   ├── data.ts             # Constants: stages, status mappings
│   ├── supabase.ts         # Supabase browser client
│   └── db.ts               # DB utilities
└── types/
    └── index.ts            # Shared TypeScript types
```

Path alias: `@/*` → `./src/*`

## Key Behaviors

- **Email sent** → auto-creates 24h follow-up task
- **Email reply** → updates memory, status, score, next_action
- `next_followup_at` and `next_action_at` stay in sync with pending tasks
- Tasks use `idempotency_key` to prevent duplicates
- Contacts have `contact_scope`: `crm` (active pipeline) or `holding` (waiting for reply)
- Vinitaly/Acumbamail leads enter as `holding` scope until engaged

## API Documentation

- Swagger UI: `http://localhost:3000/api-docs`
- OpenAPI spec: `GET /api/openapi/speaqi-call`

## Deployment (Railway.app)

- Builder: Nixpacks (uses `railway.json`)
- Port: **3000** (forced)
- Start: `node start.cjs` — proxy server on `0.0.0.0:3000`, spawns Next.js on internal port
- Health check endpoint: `/api/health`
- `NEXT_PUBLIC_*` vars must be passed as Docker `ARG` at build time

## n8n Workflows

Located in `n8n/workflows/`. Three workflows:
1. `01-followups.json` — follow-up automation
2. `02-stale-leads.json` — stale lead detection
3. `03-speaqi-webhook.json` — webhook processing

All require `AUTOMATION_SECRET` for endpoint authentication.

## Analytics Team (`/attivita`)

Pagina principale per monitoring del team commerciale. Struttura:

1. **Analytics team** — tabella per agente (responsabile del contatto) con chiamate, email, altre attività, contatti toccati nel periodo selezionato (oggi / settimana / mese / custom)
2. **Bar chart giornaliero** — andamento chiamate giorno per giorno nel periodo
3. **Log giornaliero** — timeline di tutte le attività di un giorno selezionabile, con agente in etichetta
4. **Chiamate da fare oggi** — coda di chiamate scadute o in scadenza oggi
5. **Follow-up inbox** — task pending ordinati per urgenza (scaduti → alta priorità → data)
6. **Lead senza next step** — lead aperti senza follow-up impostato

**API analytics**: `GET /api/analytics?start=&end=`
- Raggruppa activities per `contacts.responsible` (agente assegnato al contatto)
- Ritorna: `agentSummary[]`, `byDate[]`, `byAgentDate[]`, `totalActivities`
- Filtro: solo le attività dell'utente autenticato (RLS)

> Il campo `responsible` su `contacts` punta a un nome in `team_members`. È la chiave per capire chi lavora cosa.

## Pipeline Stages

Default stages (configurable in `pipeline_stages` table):
- Aperto → Proposta → Chiuso → Supertop → Paid

## Team & Auth

- Multi-user with roles (admin / member)
- All data isolated by `user_id` via RLS policies
- Admin panel: `/impostazioni`
- `SUPABASE_SERVICE_ROLE_KEY` required for admin cross-user operations
