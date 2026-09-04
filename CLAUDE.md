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
| `APP_BASE_URL` | Base URL the n8n workflows call (e.g. `https://crm.speaqi.it`) |
| `AUTOMATION_SECRET` | Auth secret for n8n automation endpoints |
| `AUTOMATION_WORKSPACE_USER_ID` | Workspace owner the automations act as — server-side only, never accepted from a request body |
| `AUTOMATION_SENDER_USER_ID` | Gmail account used to send; defaults to the workspace owner |
| `AUTOMATION_TIMEZONE` | Timezone for the daily cap window (default `Europe/Rome`) |
| `AUTOMATION_SEND_ENABLED` | Kill switch for autonomous sending; anything but `true` makes `/send` and `/send-batch` return 503 |
| `AUTOMATION_DAILY_SEND_CAP` | Max automated Gmail sends per sender per day (default 40) |
| `AUTOMATION_SEND_DELAY_MS` | Optional pause between sends inside a batch |
| `AUTOMATION_RECONCILE_FAIL_HOURS` | How long an `unknown` attempt may stay unresolved before it is failed (minimum 24) |
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
| `email_drafts` | AI drafts awaiting review (`sent_via` + `provider_message_id` link the row to what actually went out) |
| `automation_send_attempts` | One row per autonomous send attempt: atomic claim, RFC `Message-ID`, terminal outcome |
| `automation_send_daily_counters` | Per-sender per-local-day reserved/sent counters backing the atomic daily cap |
| `gmail_accounts` | Connected Gmail accounts (encrypted tokens) |
| `gmail_messages` | Synced Gmail threads linked to contacts |
| `team_members` | Multi-user team management (with `auth_user_id` linking) |
| `quotes` | Preventivi/preventivi with Stripe integration |
| `user_settings` | Per-user settings (e.g. email AI configuration) |
| `commercial_campaigns` | Motore campagne generico: un verticale = una riga (`slug`, `event_tag`, mittente, `landing_url`, filtri import, tetti) |
| `commercial_campaign_steps` | Fino a 20 email per campagna; uno step gia inviato e immutabile (trigger) |
| `commercial_enrollments` | Un contatto in sequenza per campagna |
| `commercial_messages` | Un messaggio programmato/inviato per step |
| `commercial_suppressions` | Disiscrizioni, reclami e blacklist (per struttura o per email) |
| `commercial_campaign_daily_counters` | Contatore giornaliero per campagna dietro il tetto arruolamenti atomico |

Migrations live in `supabase/migrations/` (timestamped SQL files).

## Directory Structure

```
src/
├── app/
│   ├── (app)/                  # Authenticated routes
│   │   ├── dashboard/
│   │   ├── todo/              # To Do board: attività personali/extra, avanzamento + Gantt
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
│   │   ├── commerciale/        # Area Commerciale: tutti i progetti + /commerciale/[id]
│   │   ├── preventivi/         # Quotes management (CRUD)
│   │   └── impostazioni/       # Settings & team admin
│   │       ├── email-ai/       # Email AI configuration
│   │       └── team/           # Team management
│   ├── api/                    # API routes
│   │   ├── auth/               # Session management
│   │   ├── contacts/           # CRUD + [id] + bulk + repair-names
│   │   │   └── [id]/activities, emails, emails/sync, tasks
│   │   ├── leads/              # AI-ready lead API + [id]/memory, status
│   │   ├── tasks/              # CRUD + create + pending + standalone + [id]/complete
│   │   ├── activities/         # Activity log
│   │   ├── activity/log        # Activity logging
│   │   ├── pipeline-stages/
│   │   ├── gmail/              # Gmail connect, callback
│   │   ├── analytics/          # Team analytics: breakdown per agente + giorno
│   │   ├── ai/                 # score, classify-reply, next-action, update-memory, generate-drafts
│   │   ├── automation/         # n8n endpoints: orchestrator, followups, send-batch, reconcile-sends, …
│   │   ├── email/              # Email sending + reminder
│   │   ├── import/             # csv, legacy, ocr
│   │   ├── integrations/       # Acumbamail webhook
│   │   ├── commercial/         # campaigns (CRUD + [id] + [id]/steps) + hospitality (alias)
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
│   ├── todo/                   # TodoRow, TodoGantt (pagina /todo)
│   └── ui/                     # Modal, Toast
├── lib/
│   ├── server/                 # Server-only utilities
│   │   ├── crm.ts              # Pipeline & contact core logic
│   │   ├── lead-ops.ts         # Lead creation, scoring, memory
│   │   ├── ai-ready.ts         # Data normalization for AI agents
│   │   ├── gmail.ts            # Gmail API, token encryption, sync
│   │   ├── email-drafts.ts     # AI email draft generation
│   │   ├── quotes.ts           # Quote normalization, calculation, tokens
│   │   ├── commercial-campaigns.ts  # Motore campagne generico: step, arruolamento, filtri import
│   │   ├── collaborator-filters.ts  # Workspace access & assignee filtering
│   │   ├── user-settings.ts    # Per-user settings helpers
│   │   ├── automation-auth.ts  # x-automation-secret check + server-side AutomationContext
│   │   ├── automation-send.ts  # Autonomous send engine: guardrails, atomic claim, quota
│   │   ├── draft-reconcile.ts  # Closes drafts sent by hand from Gmail
│   │   ├── scope-filters.ts    # applyPipelineScope / applyCrmScope
│   │   ├── backup.ts           # Database dump → Storage + email
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
│   ├── todo.ts                 # Aree, stati di avanzamento e span Gantt per /todo
│   ├── openapi/speaqi-call.ts  # OpenAPI spec
│   ├── supabase.ts             # Supabase browser client
│   └── db.ts                   # DB utilities
└── types/
    └── index.ts                # Shared TypeScript types
```

Path alias: `@/*` → `./src/*`

## Data Loading (performance)

Il workspace contiene decine di migliaia di contatti (quasi tutti `holding`, import evento). Regole per non rifare l'errore di caricarli tutti:

- **Set di lavoro**: `useCRM` carica in memoria solo `scope=crm,personal` (`WORKING_SET_QUERY`). Le righe `holding` **non** entrano mai in `state.contacts`.
- **Liste separate on demand**: `loadHoldingContacts({ search, list, limit })` interroga `/api/contacts?scope=holding&...` con ricerca lato database; la pagina `/contacts` la chiama (debounce 300 ms) solo quando la tab attiva è `holding` o `all`. `loadMoreHoldingContacts()` allarga la finestra di `HOLDING_PAGE_SIZE` (1000).
- **Conteggi**: badge sidebar, contatori tab e chip cartella arrivano da `GET /api/contacts/summary` (`count: 'exact', head: true` + RPC `contact_scope_folder_counts`). Non contare mai gli scope filtrando array in memoria.
- **Un solo caricamento**: `loadAll` parte una volta per sessione e a ogni mutazione, con tutte le richieste in parallelo. Non è più legato al `pathname` — cambiare pagina non ricarica nulla (`workspace=all` non cambia il payload: il server ignora già il filtro assegnatario per l'admin).
- **Render a finestra**: `/contacts` monta `CONTACTS_PAGE_SIZE` righe per volta (IntersectionObserver + "Mostra altri"); `/kanban` monta `COLUMN_PAGE_SIZE` card per colonna. Filtri, selezione e azioni di massa lavorano sull'insieme filtrato completo, non su quello montato.
- **Identità in cache**: `requireRouteUser` mette in cache `auth.getUser` (30 s) e la risoluzione del membro team (60 s) per token; `invalidateRouteUserCaches()` le svuota.
- Su liste grandi usa sempre `Set`/`Map` per le appartenenze: `Array.includes` dentro un `filter` diventa quadratico.

## Key Behaviors

- **Email sent** → auto-creates 24h follow-up task
- **Email reply** → updates memory, status, score, next_action
- `next_followup_at` and `next_action_at` stay in sync with pending tasks
- Tasks use `idempotency_key` to prevent duplicates
- Contacts have `contact_scope`: `crm` (active pipeline), `holding` (waiting for reply), or `personal` (personal area) — plus the orthogonal flags `is_partner` (partner AND possibly client) and `hidden` (out of pipeline surfaces)
- Vinitaly/Acumbamail leads enter as `holding` scope until engaged
- Every status change also syncs the contact's open deal (`syncDealWithContactStatus`); closed contacts re-enter the pipeline via "Nuova opportunità" (`POST /api/deals`)
- Dashboard "Da recuperare" panel surfaces open contacts with no next step (including Waiting contacts whose recall date has passed) with quick reschedule/dismiss actions
- Sidebar shows only the core loop (Oggi, To Do, Pipeline, Contatti, Follow-up, Preventivi, Commerciale, Analytics, Impostazioni); other pages stay reachable by URL
- **To Do board** (`/todo`): standalone tasks (`tasks.contact_id is null`, `type = 'todo'`) are the one place for everything to do, Speaqi and non-Speaqi. They carry `area` (`speaqi` / `personale` / `altro`), `progress_state` (`todo` / `in_progress` / `blocked` / `done`), `progress_percent` and `start_date` (with `due_date` it draws the Gantt bar). `status` stays the binary flag the rest of the CRM reads: `/api/tasks/standalone` is the only place where the two are kept in sync. Standalone tasks are visible **only to the workspace owner** — the `tasks_workspace` RLS policy joins through `contacts`, which they don't have
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
- Messaging baseline in `src/lib/email-ai-framework.ts` (`DEFAULT_EMAIL_AI_FRAMEWORK`); every field is overridable per user in `user_settings`
- **Wine master message** (`email_wine_core_message`): the single concept behind every email to a cantina — "raccontate la cantina una volta, Speaqi la fa parlare con il mondo". Injected by `buildEmailSegmentGuidance` for both cold and high-interest wine contacts; QR, traduzioni, video e AI Concierge non sono mai il prodotto
- `validateGeneratedDraft` (`src/lib/server/email-draft-context.ts`) runs the institutional checks (blocking) plus the Wine guardrails (correction pass only) on every generated draft
- **Wine email models**: reference emails injected by `buildEmailSegmentGuidance` for wine contacts as a structure/rhythm/CTA model, never as text to copy. Editable in `/impostazioni/email-ai` ("Modelli email — Speaqi Wine", stored in `user_settings.email_wine_templates`); the defaults live in `src/lib/email-wine-templates.ts` — A "Esempio gratuito" (preferred), B "Novità dal progetto", C "Partiamo da una bottiglia", D "Prova sociale". Text format: one `### ID | Etichetta` block per model with optional `Quando:` / `Oggetto:` lines then the body; models can be added, renamed or removed without code changes (empty or unparseable text falls back to the code defaults). `pickWineEmailTemplate` rotates deterministically by contact id — the **first model in the list** is the preferred one and weighs 2× — so one list doesn't get identical emails; the chosen variant is stored in `email_drafts.wine_template` and shown/switchable in `/email` (regenerating with `wine_template: '<ID>'`). The models reference a previous email, so the guidance drops that opening when the contact has no previous contact (`followupMode` / high-interest)
- **Open tracking (MailSuite) requires sending from Gmail**: browser extensions inject their pixel in the Gmail compose window, so a CRM API send is never tracked. The tracked path is: "📥 Prepara tutte in Gmail" in `/email` (`POST /api/automation/prepare-gmail-drafts`, one Gmail token/signature for the whole batch, 25 drafts per call, skips drafts already in Gmail unless `include_existing`) → "Apri in Gmail ↗" per draft (`email_drafts.gmail_draft_message_id` builds `mail.google.com/mail/u/<account>/#drafts?compose=<id>`) → send by hand from Gmail → reconciliation closes the draft in the CRM
- **Sent-from-Gmail reconciliation** (`src/lib/server/draft-reconcile.ts`, `POST /api/automation/reconcile-drafts`): a draft saved to Gmail ("Salva in bozza") and then sent by hand from Gmail used to stay `pending` forever. The reconciler compares pending drafts with the account's sent mail — a message to that contact after the draft's `created_at` closes the draft as `sent` with `sent_via = 'gmail'` and `provider_message_id` = the Gmail message (unique index: one message can never close two drafts), copying the subject/body actually sent, then delegates activity + follow-up to `syncContactGmailMessages`. Runs automatically when `/email` loads, on the "Controlla invii Gmail" button, and every 30 min from `05-reply-monitor`. `email_drafts.sent_via` records the path: `crm` / `automation` / `gmail`

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

Located in `n8n/workflows/` — see `n8n/README.md` for the recommended re-enable order. Fifteen workflows (all exported with `"active": false`):
- `00-error-handler.json` — Error Trigger → `/api/automation/error-alert`; import it first and set it as Error Workflow on every other one
- `01-followups.json` — due/SLA/quote-recovery task generation + Wine Project sequence (every 10 min)
- `02-stale-leads.json` — stale lead detection (daily 09:00)
- `03-speaqi-webhook.json` — inbound lead ingestion webhook
- `04-orchestrator.json` — morning AI email drafts (Mon–Fri 08:00, human sends)
- `05-reply-monitor.json` — Gmail reply sync + AI classification, then draft reconciliation (every 30 min)
- `06-db-maintenance.json` — data hygiene (hourly)
- `07-weekly-recap.json` — weekly recap email (Monday 07:30)
- `08-backup.json` — nightly database backup (03:00)
- `09-score-leads.json` — lead score recalculation (daily 06:00)
- `10-acumbamail-qualification.json` — holding → CRM promotion (daily 07:00)
- `11-send-holding.json` — autonomous holding sends (Mon–Fri 09:00); shipped in shadow mode with `dry_run: true` and gated by `AUTOMATION_SEND_ENABLED`
- `12-hospitality-commercial.json` — Hospitality outreach + reply sync (every 30 min); shipped with `dry_run: true`
- `12-wine-project-automation.json` — Wine Project follow-ups, campaign groups, engagement and replies (every 30 min)
- `13-reconcile-sends.json` — resolves `unknown` send attempts against Gmail (hourly at :20); must be active **before** `11-send-holding`

> Two files share the `12-` prefix (`12-hospitality-commercial`, `12-wine-project-automation`). The number is only a filename convention — n8n keys workflows by `id` — but keep it in mind when reading the list.

**Backup**: the Supabase Free plan has no daily backups and no PITR. `POST /api/automation/backup` (logic in `src/lib/server/backup.ts`) dumps every table in `BACKUP_TABLES`, gzips it, uploads it to the private `backups` Storage bucket and emails a copy via Resend — two copies, one outside Supabase. Paginates at 1000 rows (PostgREST truncates there), aborts if `contacts` fails, and only prunes old backups after an intact run. `send_email: false` in the body verifies dump + Storage without sending. Local equivalent: `npm run backup`.

All use `APP_BASE_URL` and require `AUTOMATION_SECRET` for endpoint authentication (including `/api/email/reminder`). The n8n workflows are just schedulers: the logic lives in `/api/automation/*`.

**Sending paths**: `/api/automation/send-draft` is session-authenticated (browser, human-in-the-loop). The machine-to-machine surface is `AUTOMATION_SECRET`-authenticated and has **two paths with different guarantees**:

- `POST /api/automation/send` with `draft_id`, and `POST /api/automation/send-batch`, both go through `src/lib/server/automation-send.ts`: workspace and sender come from env (a body that carries `workspace_user_id`/`sender_user_id`/`scopes` is rejected 400), scope must be `holding`, and the send is an atomic RPC claim + transactional daily quota. A failure of uncertain outcome becomes `unknown` and is never re-queued — only `/api/automation/reconcile-sends` may resolve it.
- `POST /api/automation/send` with `contact_id` is the older ad-hoc path: it accepts `sender_user_id` from the body, checks the cap with a non-atomic count, and honours `ignore_cap`. Phase D4 of `docs/AUTOMAZIONE-CRM-N8N.md` requires the two to converge on one engine; until they do, **automations must use `draft_id` or `send-batch`**, never `contact_id`.

**Follow-up cadence**: single source of truth in `src/lib/sla.ts` (`statusSlaHours`, `nextFollowupAfterEmail`, `nextHoldingFollowup`, `toCallableSlot`). Never re-inline the SLA table.

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
| `scripts/backup_supabase.mjs` | Local dated backup (`npm run backup`) — the Free plan has no PITR/daily backups. Paginates at 1000 rows; writes JSON per table + `contacts.csv` + manifest into gitignored `backups/` |
| `scripts/analyze_legacy_csv.py` | Analyze legacy CSV format |
| `scripts/import_contacts_csv.py` | Import contacts from CSV |
| `scripts/restore_dmo_contacts.py` | Restore DMO contacts |
| `scripts/sql/` | Diagnostic SQL queries (collaborator visibility, legacy ID audit) |
| `scripts/csv/` | CSV data files for import |

## Commerciale (motore campagne generico)

`/commerciale` e l'unica area del commerciale: dentro ci stanno tutti i
progetti — Wine Project, Hospitality e i verticali che verranno.

Aggiungerne uno (consorzi, GAL, comuni, aree SNAI) e un atto di
**configurazione**, non di sviluppo: nome, verticale, tag contatti, mittente,
testi, cadenza, lista sorgente, filtri e tetti vivono sulla riga di
`commercial_campaigns`. Wine Project resta sulle sue tabelle e sulla sua pagina:
migrarlo e un lavoro separato, da fare a motore collaudato.

- **UI**: `/commerciale` e la porta unica al commerciale — elenco per verticale,
  "Nuova campagna" e la sezione **Progetti su motore proprio** — e
  `/commerciale/[id]` la scheda del singolo progetto (email, cadenza, lista
  sorgente e filtri, tetti, interruttori, statistiche, ultimi invii). Voce
  **Commerciale** in `NAV_ITEMS`.
- **Progetti fuori da `commercial_*`**: `GET /api/commercial/campaigns`
  restituisce anche `external_projects[]`. Oggi contiene solo Wine Project, coi
  suoi numeri veri (bacino, eventi programmati, eventi in coda) e un
  collegamento a `/impostazioni/wine-project`: il progetto resta sul suo motore
  ma si vede dall'area, perche una pagina raggiungibile solo via URL prima o poi
  si dimentica. Se le sue tabelle non si leggono, l'elenco delle campagne resta
  comunque in piedi.
- **Hospitality**: e una riga di `commercial_campaigns` come le altre, quindi
  ha la sua scheda in `/commerciale/[id]`; la pagina storica `/hospitality`
  (checklist di attivazione, batch di import) resta raggiungibile dal link
  "scheda dedicata" nell'elenco, non piu dalla sidebar.
- **API**: `GET|POST /api/commercial/campaigns`, `GET|PATCH
  /api/commercial/campaigns/[id]`, `PUT /api/commercial/campaigns/[id]/steps`.
  `/api/commercial/hospitality` resta come alias sottile finche la pagina
  `/hospitality` non viene ritirata.
- **Motore**: `src/lib/server/commercial-campaigns.ts` —
  `ensureCampaignSteps()` (crea solo gli step mancanti, mai riscrive) e
  `enrollCampaignContacts()` (prima i contatti CRM col tag della campagna, poi
  la lista Acumbamail).
- **Due tetti distinti**: `daily_enrollment_cap` limita gli arruolamenti nuovi,
  `daily_cap` gli invii. Il primo e prenotato atomicamente da
  `reserve_commercial_enrollment_slots` / `settle_commercial_enrollment_slots`
  su `commercial_campaign_daily_counters`; il secondo da
  `claim_commercial_messages`.
- **Filtri import per campagna**: `import_exclude_keyword` e
  `import_required_country`, entrambi `NULL` di default (nessun filtro). Chi non
  supera il filtro paese viene creato col tag `<event_tag>_en` e senza
  iscrizione — parcheggiato, non perso.
- **Immutabilita**: `slug` non cambia una volta assegnato (entra nelle chiavi
  Acumbamail e negli UTM gia inviati); uno step gia inviato non si riscrive ne
  si cancella. Entrambe imposte da trigger, non solo dal codice.
- **Sicurezza**: campagna nuova nasce `paused`; l'attivazione richiede
  `approval_status = 'approved'`; `COMMERCIAL_OUTREACH_SEND_ENABLED` resta il
  kill switch. Disiscritti, reclami, hard bounce e blacklist (per struttura o
  per email) sono esclusi in `claim_commercial_messages`, non solo lato codice.
- **Cron**: `POST /api/automation/commercial-outreach` gira su tutte le campagne
  attive del workspace con **fallimento isolato per campagna** — un errore su
  una non ferma le altre e viene riportato in `results[].error`. Accetta
  `campaign_id` o `vertical` per limitare il giro. Workflow n8n:
  `12-hospitality-commercial.json` (SPEAQI Commercial Campaigns, ogni 30 min,
  `dry_run: true`).

### Test

Nessuna dipendenza di test oltre `tsx`: si usa `node:test`.

```bash
npm run test:unit   # motore campagne su client Supabase finto
npm run test:db     # integrazione e concorrenza su un Postgres locale usa-e-getta
npm test            # entrambi
```

`tests/db.sh` crea il cluster (`initdb`), applica `tests/sql/fixture.sql` e le
migration `commercial_*`. `tests/db.sh stop` lo spegne.
