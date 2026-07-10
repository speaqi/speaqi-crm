# CLAUDE.md — Speaqi CRM

## Project Overview

**Speaqi CRM** is a production-grade sales pipeline CRM for lead management, follow-ups, and automation. Built with Next.js 15 + Supabase, deployed on Railway.app.

## Tech Stack

- **Framework**: Next.js 15 (React 19, App Router, standalone output)
- **Language**: TypeScript 5 (strict mode)
- **Runtime**: Node.js 20.x
- **Database & Auth**: Supabase (PostgreSQL + RLS + SSR auth)
- **Email**: Resend (reminders), Gmail API (OAuth 2.0 sync)
- **AI**: OpenAI (voice commands, lead scoring, classification, email drafts, memory)
- **Payments**: Stripe (quote checkout)
- **Automation**: n8n workflows
- **Webhook Ingestion**: Acumbamail
- **MCP**: Model Context Protocol server (`@modelcontextprotocol/sdk`)
- **Deployment**: Railway.app (Nixpacks builder)

## Commands

```bash
npm run dev          # Dev server on localhost:3000
npm run build        # Production build (standalone output)
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
| `STRIPE_SECRET_KEY` | Stripe secret key for quote payments |
| `RESEND_API_KEY` | Resend email API key |
| `GOOGLE_CLIENT_ID` | Gmail OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Gmail OAuth secret |
| `GOOGLE_REDIRECT_URI` | Gmail OAuth callback URL |
| `GMAIL_TOKEN_ENCRYPTION_KEY` | 32+ char secret for token encryption |
| `OPENAI_API_KEY` | OpenAI API key |
| `OPENAI_MODEL` | Model ID (e.g. `gpt-5-mini`) |
| `AUTOMATION_SECRET` | Auth secret for n8n automation endpoints |
| `SPEAQI_WEBHOOK_SECRET` | Auth secret for Acumbamail webhook |
| `REMINDER_EMAIL` | From address for reminder emails |
| `ACUMBAMAIL_WEBHOOK_USER_ID` | Acumbamail integration user ID |
| `ACUMBAMAIL_WEBHOOK_TOKEN` | Acumbamail integration token |
| `ACUMBAMAIL_DEFAULT_SOURCE` | Default source tag (e.g. `vinitaly`) |
| `ACUMBAMAIL_DEFAULT_CONTACT_SCOPE` | Default scope (e.g. `holding`) |
| `ACUMBAMAIL_DEFAULT_CATEGORY` | Default category for imported contacts |

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
| `contacts` | Leads/contacts (AI-ready fields, contact_scope, `is_partner`, `hidden`, engagement tracking) |
| `deals` | Trattative/opportunità per contact (max 1 open per contact, enables re-entry after close) |
| `activities` | Full interaction timeline per contact |
| `tasks` | Follow-ups and next actions (idempotency_key for deduplication) |
| `lead_memories` | AI-generated synthetic memory per lead |
| `ai_decision_logs` | Audit trail of AI decisions |
| `email_logs` | Email sending history |
| `gmail_accounts` | Connected Gmail accounts (encrypted tokens) |
| `gmail_messages` | Synced Gmail threads linked to contacts |
| `team_members` | Multi-user team management (with `auth_user_id` linking) |
| `quotes` | Preventivi/preventivi with Stripe integration |
| `user_settings` | Per-user settings (e.g. email AI configuration) |

Migrations live in `supabase/migrations/` (timestamped SQL files).

## Directory Structure

```
src/
├── app/
│   ├── (app)/                  # Authenticated routes
│   │   ├── dashboard/
│   │   ├── contacts/
│   │   │   └── [id]/           # Contact detail page
│   │   ├── kanban/
│   │   ├── calendario/         # 5-day planning view with drag-and-drop
│   │   ├── attivita/           # Analytics team + log giornaliero + follow-up inbox
│   │   ├── quick-capture/
│   │   ├── gmail/
│   │   ├── voice/
│   │   ├── vinitaly/           # Holding area for event leads
│   │   ├── import/
│   │   ├── speaqi/
│   │   ├── personali/          # Personal contacts area
│   │   ├── preventivi/         # Quotes management (CRUD)
│   │   └── impostazioni/       # Settings & team admin
│   │       ├── email-ai/       # Email AI configuration
│   │       └── team/           # Team management
│   ├── api/                    # API routes
│   │   ├── auth/               # Session management
│   │   ├── contacts/           # CRUD + [id] + bulk + repair-names
│   │   │   └── [id]/activities, emails, emails/sync, tasks
│   │   ├── leads/              # AI-ready lead API + [id]/memory, status
│   │   ├── tasks/              # CRUD + create + pending + [id]/complete
│   │   ├── activities/         # Activity log
│   │   ├── activity/log        # Activity logging
│   │   ├── pipeline-stages/
│   │   ├── gmail/              # Gmail connect, callback
│   │   ├── analytics/          # Team analytics: breakdown per agente + giorno
│   │   ├── ai/                 # score, classify-reply, next-action, update-memory, generate-drafts
│   │   ├── automation/         # followups, stale-leads
│   │   ├── email/              # Email sending + reminder
│   │   ├── import/             # csv, legacy, ocr
│   │   ├── integrations/       # Acumbamail webhook
│   │   ├── quotes/             # CRUD + [id]/checkout
│   │   │   └── public/         # Public quote access + checkout + accept-contract
│   │   ├── mcp/                # Model Context Protocol server
│   │   ├── openapi/            # speaqi-call spec
│   │   ├── voice/              # Voice command processing
│   │   ├── user-settings/      # Per-user settings
│   │   ├── team-members/       # Team CRUD + [id]
│   │   ├── speaqi/leads        # Speaqi lead API
│   │   └── health/             # Health check
│   ├── login/                  # Login page (email + password)
│   ├── preventivo/             # Preventivo pubblico con pagamento Stripe
│   ├── termini-speaqi/         # Terms of service
│   ├── api-docs/               # Swagger UI
│   └── page.tsx                # Root → redirect('/login')
├── components/
│   ├── crm/                    # ContactDrawer, ContactModal, CallOutcomeModal, EmailDraftPanel
│   ├── layout/                 # Sidebar, Topbar, BrandLockup
│   └── ui/                     # Modal, Toast
├── lib/
│   ├── server/                 # Server-only utilities
│   │   ├── crm.ts              # Pipeline & contact core logic
│   │   ├── lead-ops.ts         # Lead creation, scoring, memory
│   │   ├── ai-ready.ts         # Data normalization for AI agents
│   │   ├── gmail.ts            # Gmail API, token encryption, sync
│   │   ├── email-drafts.ts     # AI email draft generation
│   │   ├── quotes.ts           # Quote normalization, calculation, tokens
│   │   ├── collaborator-filters.ts  # Workspace access & assignee filtering
│   │   ├── user-settings.ts    # Per-user settings helpers
│   │   ├── gcal.ts             # Google Calendar integration
│   │   ├── http.ts             # HTTP client utilities
│   │   └── supabase.ts         # Supabase server helpers
│   ├── api.ts                  # Client-side API helpers
│   ├── data.ts                 # Constants: stages, status mappings, labels, filters
│   ├── contact-name.ts         # Contact name formatting
│   ├── csv-import.ts           # CSV import logic
│   ├── email.ts                # Email utilities
│   ├── quote-defaults.ts       # Default contract terms & bank instructions
│   ├── speaqi-quote-packages.ts # START/EXPERIENCE/SIGNATURE package definitions
│   ├── schedule.ts             # Scheduling utilities
│   ├── openapi/speaqi-call.ts  # OpenAPI spec
│   ├── supabase.ts             # Supabase browser client
│   └── db.ts                   # DB utilities
└── types/
    └── index.ts                # Shared TypeScript types
```

Path alias: `@/*` → `./src/*`

## Key Behaviors

- **Email sent** → auto-creates 24h follow-up task
- **Email reply** → updates memory, status, score, next_action
- `next_followup_at` and `next_action_at` stay in sync with pending tasks
- Tasks use `idempotency_key` to prevent duplicates
- Contacts have `contact_scope`: `crm` (active pipeline), `holding` (waiting for reply), or `personal` (personal area) — plus the orthogonal flags `is_partner` (partner AND possibly client) and `hidden` (out of pipeline surfaces)
- Vinitaly/Acumbamail leads enter as `holding` scope until engaged
- Every status change also syncs the contact's open deal (`syncDealWithContactStatus`); closed contacts re-enter the pipeline via "Nuova opportunità" (`POST /api/deals`)
- Dashboard "Da recuperare" panel surfaces open contacts with no next step (including Waiting contacts whose recall date has passed) with quick reschedule/dismiss actions
- Sidebar shows only the core loop (Oggi, Pipeline, Contatti, Follow-up, Preventivi, Analytics, Impostazioni); other pages stay reachable by URL
- **Admin collaborator filter**: Admin can toggle `workspace=all` to see all contacts, otherwise sees only assigned contacts (matching `responsible` or `assigned_agent` via `contactMatchesAssigneeName`)

## Pipeline Stages

Default stages (configurable in `pipeline_stages` table, see `src/lib/data.ts`):

New → Contacted → Interested → Waiting → Call booked → Quote → Lost → Closed → Paid

Each stage has a `system_key` and `color`. Closed statuses: `closed`, `paid`, `lost`, `not_interested`.

> "Supertop" is NOT a stage anymore: it means `priority = 3` (max) on the contact, shown as star/badge.

## Deals (Trattative)

- Pipeline position lives on `contacts.status` (mirror cache read by dashboard/kanban/automations), but each contact has a history of `deals` — at most ONE open (partial unique index `deals_one_open_per_contact`).
- `src/lib/server/deal-ops.ts`: `syncDealWithContactStatus` keeps the open deal aligned on every status change (hooked in contacts POST/PATCH, bulk, lead-ops, Gmail reply outcome); `reopenWithNewDeal` re-enters a closed/paid contact into the pipeline with a new opportunity.
- `POST /api/deals` = "Nuova opportunità" (button in contact detail page); `GET /api/deals?contact_id=X` = history.
- Each deal has an optional `counterparty` (the entity the deal is with — a person can carry deals for different organizations).
- Quote paid → contact `Paid` + open deal closed as won; new quotes attach to the open deal via `quotes.deal_id`.

## Contact Scopes

| Scope | Description | Route |
|---|---|---|
| `crm` | Active pipeline, main CRM flow | `/contacts`, `/kanban` |
| `holding` | Waiting list (event leads, unengaged) | `/contacts?scope=holding` |
| `personal` | Personal contacts, separate from CRM | `/contacts?scope=personal` |

**Partner is NOT a scope**: it's the `is_partner` boolean — a partner can also be a client and sit in the pipeline. Per-contact pipeline exclusion uses the `hidden` flag. Canonical server-side visibility rule in `src/lib/server/scope-filters.ts`: `applyPipelineScope` (scope crm + not hidden — work queues, automations) and `applyCrmScope` (scope only — analytics/finance reporting).

## Quotes / Preventivi

- **Internal management**: `/preventivi` — full CRUD for quotes
- **Public page**: `/preventivo?id=TOKEN` — customer-facing quote with Stripe checkout
- **Packages**: START (€349.99), EXPERIENCE (€699.99), SIGNATURE (€999.99) — defined in `src/lib/speaqi-quote-packages.ts`
- **Pricing display**: net price + IVA, total with IVA
- **Payment methods**: bank transfer, Stripe, or both
- **Contract**: auto-accept or email-based acceptance with Resend
- **Status flow**: draft → sent → accepted → paid (or cancelled)
- **Payment state**: pending → deposit_requested → paid → waived
- Key API endpoints:
  - `GET /api/quotes/public?token=X` — public quote view
  - `POST /api/quotes/public/checkout` — Stripe checkout session
  - `POST /api/quotes/public/accept-contract` — contract acceptance

## Collaborator / Workspace Access

- Collaborators see only contacts assigned to them (by `responsible` or `assigned_agent`)
- Admin sees all contacts by default; toggle `workspace=all` to see everything
- Filter logic in `src/lib/server/collaborator-filters.ts` and `src/lib/data.ts` (contact visibility helpers)
- Team members linked via `auth_user_id` on `team_members` table
- `team_members` table has `name`, `email`, `color`, `auth_user_id`, `is_current_admin`

## AI Features

| Endpoint | Purpose |
|---|---|
| `POST /api/ai/score-lead` | Score a lead |
| `POST /api/ai/classify-reply` | Classify email reply intent |
| `POST /api/ai/next-action` | Suggest next action |
| `POST /api/ai/update-memory` | Update lead memory |
| `POST /api/ai/generate-drafts` | Generate email drafts for today's contacts |

## Email AI Drafts

- Dashboard panel generates draft emails for today's contacts using AI
- Powered by `src/lib/server/email-drafts.ts`
- User settings for email AI configuration at `/impostazioni/email-ai`
- Model used: `OPENAI_MODEL` env var

## Voice Commands

- Voice FAB on dashboard for quick access to `/voice`
- `POST /api/voice/command` — process voice commands via OpenAI

## MCP Server

- `POST /api/mcp` — Model Context Protocol server endpoint
- Uses `@modelcontextprotocol/sdk`

## Brand & Legal

- **Legal entity**: Speaqi di TheBestItaly · P.IVA: 10831191217 · C.F.: 95125440636
- **Colors CRM**: Dark `#16192e` sidebar, accent `#4f6ef7` blue, white surface

## Public Routes

| Route | Description |
|---|---|
| `/login` | Login page (email + password) |
| `/preventivo?id=TOKEN` | Public quote with Stripe payment, contract, urgency |
| `/termini-speaqi` | Terms of service |
| `/api-docs` | Swagger UI |

## Onboarding

- Dashboard shows welcome card when `allContacts.length === 0` with 3 CTA: Importa CSV, Crea contatto, Nota vocale
- Voice FAB (floating action button) on dashboard for quick access to `/voice`
- Sidebar includes "Nota vocale" button in footer

## API Documentation

- Swagger UI: `http://localhost:3000/api-docs`
- OpenAPI spec: `GET /api/openapi/speaqi-call`

## Deployment (Railway.app)

- Builder: Nixpacks (uses `railway.json`)
- Port: **3000** (forced)
- Start: `node start.cjs` — proxy server on `0.0.0.0:3000`, spawns Next.js on internal port
- Health check endpoint: `/api/health`
- `NEXT_PUBLIC_*` vars must be passed as Docker `ARG` at build time
- Restart policy: `ON_FAILURE`

## n8n Workflows

Located in `n8n/workflows/` — see `n8n/README.md` for the recommended re-enable order. Seven workflows (all exported with `"active": false`):
1. `01-followups.json` — due/SLA/quote-recovery task generation (every 10 min)
2. `02-stale-leads.json` — stale lead detection (daily 09:00)
3. `03-speaqi-webhook.json` — inbound lead ingestion webhook
4. `04-orchestrator.json` — morning AI email drafts (Mon–Fri 08:00, human sends)
5. `05-reply-monitor.json` — Gmail reply sync + AI classification (every 30 min)
6. `06-db-maintenance.json` — data hygiene (hourly)
7. `07-weekly-recap.json` — weekly recap email (Monday 07:30)

All use `APP_BASE_URL` and require `AUTOMATION_SECRET` for endpoint authentication (including `/api/email/reminder`). The n8n workflows are just schedulers: the logic lives in `/api/automation/*`.

## Analytics Team (`/attivita`)

Main page for sales team monitoring. Structure:

1. **Analytics team** — per-agent table (contact responsible) with calls, emails, other activities, contacts touched in selected period (today / week / month / custom)
2. **Daily bar chart** — call trends day by day in the period
3. **Daily log** — timeline of all activities for a selectable day, with agent label
4. **Calls to make today** — queue of overdue or due-today calls
5. **Follow-up inbox** — pending tasks sorted by urgency (overdue → high priority → date)
6. **Leads without next step** — open leads without a follow-up set

**API analytics**: `GET /api/analytics?start=&end=`
- Groups activities by `contacts.responsible` (agent assigned to the contact)
- Returns: `agentSummary[]`, `byDate[]`, `byAgentDate[]`, `totalActivities`
- Filter: only authenticated user's activities (RLS)

> The `responsible` field on `contacts` points to a name in `team_members`. It's the key to understand who works what.

## Team & Auth

- Multi-user with roles (admin / member)
- All data isolated by `user_id` via RLS policies
- Admin panel: `/impostazioni` (settings + team management)
- `SUPABASE_SERVICE_ROLE_KEY` required for admin cross-user operations
- Collaborators see only their assigned contacts; admin can toggle full visibility with `workspace=all`

## Utility Scripts

| Path | Purpose |
|---|---|
| `scripts/analyze_legacy_csv.py` | Analyze legacy CSV format |
| `scripts/import_contacts_csv.py` | Import contacts from CSV |
| `scripts/restore_dmo_contacts.py` | Restore DMO contacts |
| `scripts/sql/` | Diagnostic SQL queries (collaborator visibility, legacy ID audit) |
| `scripts/csv/` | CSV data files for import |
