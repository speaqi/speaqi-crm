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
- **Automation**: pianificatore interno (`src/lib/automation-schedule.ts`), ha preso il posto di n8n
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
npm run shipping:import                  # catalogo compagnie di navigazione: prova a secco
npm run shipping:import -- --apply       # scrive (workspace da AUTOMATION_WORKSPACE_USER_ID o --user-id)
```

## Environment Variables

Copy `.env.local.example` to `.env.local`. Required keys:

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (server-only admin ops) |
| `STRIPE_SECRET_KEY` | Stripe secret key for quote payments |
| `STRIPE_VIDEO_MAP_PRICE_ID` / `STRIPE_VIDEO_MAP_COUPON_ID` | Prodotto "Video nella mappa" del catalogo Stripe (488 €/anno IVA inclusa = il listino attuale, 400 € + IVA) + coupon permanente (122 €), che serve solo ai preventivi firmati quando il prezzo era 300 € + IVA. Opzionali: senza il prezzo, il checkout scrive l'importo al volo; il coupon da solo non basta |
| `ARUBA_FE_USERNAME` / `ARUBA_FE_PASSWORD` | Credenziali del pannello Fatturazione Elettronica Aruba, con le API attive sull'account. Senza, `/fatture` prepara bozze e XML ma non invia |
| `ARUBA_FE_ENV` | `production` per inviare allo SDI vero. Qualunque altro valore (o niente) = **ambiente demo di Aruba**: le fatture non arrivano allo SDI |
| `STUDIOMAP_CATALOG_TOKEN` / `STUDIOMAP_CATALOG_URL` | Lettura del catalogo di StudioMap (stato delle mappe in prima pagina e nella scheda). Senza il token si vedono solo le mappe online su Speaqi |
| `SPEAQI_PUBLIC_API_URL` | API pubblica di Speaqi per le guide online (default `https://api.speaqi.com/api/v1`) |
| `STRIPE_WEBHOOK_SECRET` | Segreto di firma dell'endpoint `/api/integrations/stripe/webhook` (abbonamenti annuali). Senza, il webhook risponde 500 e Stripe riprova |
| `RESEND_API_KEY` | Resend email API key |
| `GOOGLE_CLIENT_ID` | Gmail OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Gmail OAuth secret |
| `GOOGLE_REDIRECT_URI` | Gmail OAuth callback URL |
| `GMAIL_TOKEN_ENCRYPTION_KEY` | 32+ char secret for token encryption |
| `OPENAI_API_KEY` | OpenAI API key |
| `OPENAI_MODEL` | Model ID (e.g. `gpt-5-mini`) |
| `OPENAI_AGENCY_MODEL` | Modello dell'agente Speaqi Agency (analisi del brief, presentazioni, revisioni). Default `gpt-5.1`, indipendente da `OPENAI_MODEL`: con `gpt-5-mini` i titoli tornavano etichette d'argomento. Deve leggere immagini e PDF |
| `AGENCY_RENDER_SECRET` | Segreto della chiave con cui Chromium stampa in PDF una proposta Agency non ancora approvata. Senza, si usa `SUPABASE_SERVICE_ROLE_KEY`; senza nessuno dei due il PDF di una bozza non si genera (quello di una approvata sì) |
| `OPENAI_TOURISM_DECK_MODEL` | Modello dell'agente che personalizza le presentazioni per destinazione (default `OPENAI_MODEL`, poi `gpt-5-mini`). Deve leggere immagini e PDF |
| `APP_BASE_URL` | Base URL pubblico del CRM (e.g. `https://crm.speaqi.com`) |
| `AUTOMATION_SECRET` | Auth secret for the `/api/automation/*` endpoints (il pianificatore lo manda in `x-automation-secret`) |
| `AUTOMATION_SCHEDULER_ENABLED` | `true` accende il pianificatore delle automazioni dentro il CRM. Spento di default: acceso insieme a un altro scheduler farebbe partire tutto due volte |
| `AUTOMATION_SCHEDULER_JOBS` | Elenco di job ammessi, separati da virgola (es. `backup`). Con `AUTOMATION_SCHEDULER_ENABLED=true` gira solo quello: serve per accendere il backup notturno senza invii, follow-up e sequenze. Vuota = tutti. Un nome sbagliato non fa partire niente |
| `TOURISM_RESEARCH_ENABLED` / `TOURISM_RESEARCH_INTERVAL_SEC` | Il worker della ricerca Tourism e' **spento di default**: parte solo con `true`, con una pausa fra i giri di `INTERVAL_SEC` secondi (default 300, minimo 60) |
| `R2_BACKUP_ACCOUNT_ID` / `R2_BACKUP_BUCKET` / `R2_BACKUP_ACCESS_KEY_ID` / `R2_BACKUP_SECRET_ACCESS_KEY` | Copia del backup su Cloudflare R2, fuori da Supabase (`crm/speaqi-backup_*.json.gz`). Tutte e quattro o niente. Il bucket deve essere **privato**, diverso da quello pubblico delle immagini (`images.speaqi.com`): contiene dati personali. La rotazione la fa una regola di scadenza del bucket (30 giorni), non il codice |
| `AUTOMATION_WORKSPACE_USER_ID` | Workspace owner the automations act as — server-side only, never accepted from a request body |
| `AUTOMATION_SENDER_USER_ID` | Gmail account used to send; defaults to the workspace owner |
| `AUTOMATION_TIMEZONE` | Timezone for the daily cap window (default `Europe/Rome`) |
| `AUTOMATION_SEND_ENABLED` | Kill switch for autonomous sending; anything but `true` makes `/send` and `/send-batch` return 503 |
| `AUTOMATION_DAILY_SEND_CAP` | Max automated Gmail sends per sender per day (default 40) |
| `AUTOMATION_SEND_DELAY_MS` | Optional pause between sends inside a batch |
| `AUTOMATION_RECONCILE_FAIL_HOURS` | How long an `unknown` attempt may stay unresolved before it is failed (minimum 24) |
| `ACUMBAMAIL_MIN_INTERVAL_MS` | Distanza minima fra due chiamate allo stesso endpoint Acumbamail (default 6500, tetto documentato 10/min) |
| `ACUMBAMAIL_MAX_ATTEMPTS` | Tentativi massimi su un 429 Acumbamail (default 4) |
| `WINE_DEMO_EMAIL_ENABLED` | Email automatica alla cantina con il link della demo Wine; `false` lascia solo la notifica WhatsApp |
| `OPENWA_BASE_URL` | WhatsApp gateway (OpenWA) base URL |
| `OPENWA_API_KEY` | OpenWA API key |
| `OPENWA_SESSION_ID` | OpenWA session **UUID** (not its name) |
| `WHATSAPP_NOTIFY_TO` | Starting recipient, used only until the number is saved in the CRM (`/impostazioni/whatsapp`) |
| `WHATSAPP_NOTIFY_ENABLED` | Emergency brake: `false` kills every notification whatever the CRM toggle says |
| `TELEGRAM_BOT_TOKEN` | Bot Telegram: note vocali del To Do in ingresso e, con `TELEGRAM_NOTIFY_CHAT_ID`, notifiche in uscita |
| `TELEGRAM_NOTIFY_CHAT_ID` | Chat (id numerico) a cui arrivano le notifiche del CRM. Con questa e il token, Telegram sostituisce OpenWA |
| `TELEGRAM_WEBHOOK_SECRET` | Segreto dell'header `x-telegram-bot-api-secret-token` |
| `TELEGRAM_ALLOWED_CHAT_IDS` | Chat autorizzate a scrivere nel CRM (elenco separato da virgole). Senza, il bot non accetta niente |
| `TELEGRAM_WORKSPACE_USER_ID` | Workspace su cui scrivono le note vocali; default `AUTOMATION_WORKSPACE_USER_ID` |
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
| `whatsapp_notification_events` | Queue of CRM facts to notify on WhatsApp (`notified_at` only once the message really went out; `email_sent/open/click/reply/unsubscribe` + `wine_demo_ready`) |
| `whatsapp_notification_sends` | History of the messages pushed to the WhatsApp gateway |
| `whatsapp_notification_settings` | Per-workspace WhatsApp recipient, toggle and event selection (edited from the UI, not from env) |
| `todo_board_columns` | Colonne aggiunte a mano alla lavagna `/todo` (nome, colore, ordine); valgono su tutti i raggruppamenti |
| `telegram_inbox` | Un messaggio ricevuto dal bot Telegram: trascrizione, intento, attività scritte (`update_id` unico = idempotenza) |
| `tourism_deck_templates` | Il modello generico delle presentazioni per destinazione (slide, segnaposto, istruzioni per l'agente): uno per proprietario, `is_default` |
| `tourism_decks` | Una presentazione per destinazione/ente: input, note, file (`assets`), slide, avvisi, stato (`draft`→`generating`→`ready`→`approved`/`failed`), `public_token` della vista pubblica |
| `agency_projects` | Speaqi Agency: un'opportunità su misura (sito, branding, SEO/GEO, software, AI…). Cliente = `contact_id`, trattativa = `deal_id` del CRM; brief, servizi (slug), materiali (`assets`), marchio del cliente, ultima analisi dell'AI. Nessun importo |
| `agency_presentations` | Una presentazione di un'opportunità: slide, tema, avvisi, `quote_id` (la slide "investimento" legge quel preventivo), stato `draft`→`generating`→`ready`→`approved`/`failed`, `public_token` del link `/proposta/<token>` |
| `agency_presentation_versions` | Ogni stato salvato di una presentazione (generazione, revisione AI, modifica a mano, ripristino). Immutabile (trigger) |
| `agency_service_categories` | Categorie di servizio Agency, configurabili; lo slug non cambia |
| `agency_settings` | Identità dell'agenzia (nome, firma, contatto, chi siamo) e stile di partenza |
| `gmail_accounts` | Connected Gmail accounts (encrypted tokens) |
| `gmail_messages` | Synced Gmail threads linked to contacts |
| `team_members` | Multi-user team management (with `auth_user_id` linking) |
| `quotes` | Preventivi/preventivi with Stripe integration (`billing_interval = 'year'` = abbonamento annuale con carta, rinnovato da Stripe) |
| `quote_signatures` | Firma disegnata di un preventivo (PNG, nome, IP, user-agent, copia di termini e importi). Immutabile, scritta solo dalla RPC `sign_public_quote_contract` |
| `invoices` | Fatture elettroniche (`/fatture`): cliente e righe (jsonb), stato `draft`→`sending`→`sent`→`delivered`/`not_delivered`/`accepted`/`refused`/`rejected`/`error`, XML inviato, file e stato SDI di Aruba. Numero assegnato all'invio, poi immutabile e non cancellabile (trigger). Una per preventivo (`source = 'quote'`) e una per incasso Stripe (`stripe_invoice_id`) |
| `contact_map_links` | Mappe collegate a mano a un contatto (`map_ref` = slug o nome, `role` client/partner/prospect/guide). Lo stato della mappa non si salva: si legge da StudioMap e Speaqi a ogni apertura |
| `invoice_settings` | Dati fiscali di chi emette (cedente): denominazione, P.IVA, CF, regime, sede, IBAN, natura per le righe senza IVA, bollo, formato del numero |
| `invoice_counters` | Ultimo numero di fattura per anno; si parte dall'ultimo emesso sul pannello Aruba. Lo incrementa solo la RPC `reserve_invoice_number` (service role) |
| `stripe_webhook_events` | Idempotenza del webhook Stripe: un evento gia' processato non si rifa' |
| `sales_links` | Link vendita personali (`/vendita/<token>`): solo lo SHA-256 del token, uno attivo per membro del team |
| `user_settings` | Per-user settings (e.g. email AI configuration) |
| `shipping_companies` | Compagnie di navigazione passeggeri (`/navigazione`): sede, riferimenti, `calls_naples` / `calls_civitavecchia` (null = da verificare), `contact_id` verso il contatto su cui si lavora |
| `shipping_itineraries` | Una crociera o una linea di una compagnia (nome, nave, notti, stagione, date di partenza, fonte) |
| `shipping_itinerary_stops` | Le soste in porto di un itinerario, in ordine (giorno, ruolo imbarco/scalo/sbarco, orari, pernottamento). I giorni di navigazione non sono tappe |
| `shipping_ports` | **Vista** (`security_invoker`, aggiornabile) su `tourism_hubs where mode = 'sea'`, con i nomi di colonna di sempre (`cruise_passengers` = `passengers`, `cruise_calls` = `movements`): Navigazione legge e scrive da qui come prima. Anagrafica dei porti del mondo (nome, paese ISO-2, UN/LOCODE, alias): "Naples" e "Napoli" sono lo stesso porto. Porta le coordinate, regione/area, città servita (`destination`: Civitavecchia → Roma), passeggeri e scali l'anno con anno e fonte, porto d'imbarco, e `guide_status` + `guide_priority` (1-3) della superguida Speaqi. La tabella vecchia resta come `shipping_ports_legacy`, senza accesso, finché una release non la cancella |
| `tourism_hubs` | Porti, aeroporti e stazioni di Tourism Intelligence (`mode` sea/air/rail): codici ufficiali (UN/LOCODE, IATA, ICAO, UIC, unici per workspace), coordinate, città servita (`destination` testo, `destination_id` → luogo), taglia, passeggeri con anno e fonte, quota internazionale, movimenti. Si importa con la RPC `tourism_import_hubs` (blocchi da 500, ritrova per codice poi slug, riempie solo i vuoti, un numero si aggiorna solo con un anno più recente, superguida e destinazione mai toccate) |
| `tourism_destinations` | I dati di una destinazione accanto all'entità `kind='place'`: arrivi internazionali (solo con anno e fonte), mercati di provenienza, lingue necessarie, stato e priorità della superguida, mappa Speaqi collegata |
| `tourism_hub_destinations` | Destinazioni **aggiuntive** di un hub che serve più città; la principale è `tourism_hubs.destination_id` e non si ripete (trigger) |
| `tourism_hub_operators` | Chi opera dove: compagnia in un porto, vettore in un aeroporto (`role` base/homeport/calls/route, stagione, frequenza) |
| `trade_fair_exhibitors` | Espositori di una fiera (`/fiere`, oggi TTG 2026): punteggio 0-100 e motivi, priorità, stato (`new`→`contacted`→`replied`→`interested`→`meeting`, `not_interested`), `next_followup_at`, registro `notes` jsonb, `contact_id` opzionale. Unico per `(user_id, fair, slug)` |
| `receivables` | Soldi da ricevere, personali e fuori da Speaqi (`/incassi`): nome, cifra, `collected_at` (null = da incassare). Riga di chi l'ha scritta (`auth.uid()`), non del workspace |
| `commercial_campaigns` | Motore campagne generico: un verticale = una riga (`slug`, `event_tag`, mittente, `landing_url`, filtri import, tetti) |
| `commercial_campaign_steps` | Fino a 20 email per campagna; uno step gia inviato e immutabile (trigger) |
| `commercial_enrollments` | Un contatto in sequenza per campagna |
| `commercial_messages` | Un messaggio programmato/inviato per step |
| `commercial_suppressions` | Disiscrizioni, reclami e blacklist (per struttura o per email) |
| `commercial_campaign_daily_counters` | Contatore giornaliero per campagna dietro il tetto arruolamenti atomico |
| `automation_job_runs` | Una riga per corsa di un'automazione pianificata: `(job, slot)` è la prenotazione che fa partire un job una volta sola con più repliche, più esito e passi. Tenuta 30 giorni |

Migrations live in `supabase/migrations/` (timestamped SQL files).

## Directory Structure

```
src/
├── app/
│   ├── (app)/                  # Authenticated routes
│   │   ├── dashboard/
│   │   ├── todo/              # To Do: lavagna kanban, lista e Gantt delle attività personali/extra
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
│   │   ├── incassi/            # Da incassare: soldi personali da ricevere, fuori da Speaqi
│   │   ├── scheda/[id]/        # Scheda completa del cliente (solo titolare)
│   │   ├── fatture/            # Fatture elettroniche: bozza dal preventivo pagato, invio allo SDI con Aruba
│   │   ├── navigazione/        # Compagnie di navigazione: chi arriva a Napoli / Civitavecchia
│   │   └── impostazioni/       # Settings & team admin
│   │       ├── email-ai/       # Email AI configuration
│   │       └── team/           # Team management
│   ├── api/                    # API routes
│   │   ├── auth/               # Session management
│   │   ├── contacts/           # CRUD + [id] + bulk + repair-names
│   │   │   └── [id]/activities, emails, emails/sync, tasks
│   │   ├── leads/              # AI-ready lead API + [id]/memory, status
│   │   ├── tasks/              # CRUD + create + pending + standalone + [id]/complete
│   │   ├── todo/columns/       # Colonne aggiunte a mano alla lavagna (CRUD + riordino)
│   │   ├── receivables/        # Da incassare (CRUD, solo le righe di chi e' loggato)
│   │   ├── invoices/           # Fatture: lista + bozza da preventivo, [id] (correzione), [id]/send, [id]/xml, settings
│   │   ├── shipping-companies/ # Catalogo compagnie di navigazione (lettura + correzione scali)
│   │   ├── shipping-itineraries/ # Itinerari con tappe (CRUD, salvataggio atomico via RPC)
│   │   ├── shipping-ports/     # Porti con utilizzo, modifica, unione doppioni
│   │   ├── activities/         # Activity log
│   │   ├── activity/log        # Activity logging
│   │   ├── pipeline-stages/
│   │   ├── gmail/              # Gmail connect, callback
│   │   ├── analytics/          # Team analytics: breakdown per agente + giorno
│   │   ├── ai/                 # score, classify-reply, next-action, update-memory, generate-drafts
│   │   ├── automation/         # endpoint delle automazioni pianificate: orchestrator, followups, send-batch, reconcile-sends, …
│   │   ├── email/              # Email sending + reminder
│   │   ├── import/             # csv, legacy, ocr
│   │   ├── integrations/       # Acumbamail webhook + Telegram (webhook, setup) + Stripe (webhook abbonamenti)
│   │   ├── commercial/         # campaigns (CRUD + [id] + [id]/steps) + hospitality (alias)
│   │   ├── quotes/             # CRUD + [id]/signature + [id]/send-acceptance-email
│   │   │   └── public/         # checkout + accept-contract + sign (firma disegnata) + select-choice
│   │   ├── vendita/[token]/quote # Preventivo creato dal link vendita (senza login)
│   │   ├── programma-commerciali/ # Provvigioni e prodotto per guides.speaqi.com/diventa-commerciale (pubblico)
│   │   ├── candidature-commerciali/ # Candidature dei commerciali (inoltrate dal server di Guides)
│   │   ├── sales-links/        # Link vendita attivi (admin); generazione/revoca in team-members/[id]/sales-link
│   │   ├── mcp/                # Model Context Protocol server
│   │   ├── openapi/            # speaqi-call spec
│   │   ├── voice/              # Voice command processing
│   │   ├── user-settings/      # Per-user settings
│   │   ├── team-members/       # Team CRUD + [id]
│   │   ├── speaqi/leads        # Speaqi lead API
│   │   └── health/             # Health check
│   ├── login/                  # Login page (email + password)
│   ├── preventivo/             # Preventivo pubblico: firma disegnata + pagamento con carta per gli abbonamenti
│   ├── vendita/[token]/        # Area del commerciale senza login: dati del cliente → firma e pagamento
│   ├── termini-speaqi/         # Terms of service
│   ├── api-docs/               # Swagger UI
│   └── page.tsx                # Root → redirect('/login')
├── components/
│   ├── crm/                    # ContactDrawer, ContactModal, CallOutcomeModal, EmailDraftPanel
│   ├── layout/                 # Sidebar, Topbar, BrandLockup
│   ├── todo/                   # TodoKanban, TodoCard, TodoRow, TodoGantt, TodoDateField, TodoColumnManager (pagina /todo)
│   ├── navigazione/            # CompanyItineraries, ItineraryEditor, PortsView, RoutesMap (pagina /navigazione)
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
│   │   ├── automation-scheduler.ts # Pianificatore: prenotazione della corsa, passi, errori (ex n8n)
│   │   ├── draft-reconcile.ts  # Closes drafts sent by hand from Gmail
│   │   ├── telegram.ts         # Bot Telegram in ingresso: segreto, elenco chat, download media
│   │   ├── todo-voice.ts       # Dal parlato alle azioni sul To Do (proposta del modello → cosa si scrive)
│   │   ├── transcribe.ts       # Trascrizione vocale (una sola, per browser e Telegram)
│   │   ├── whatsapp.ts         # OpenWA gateway client (fail-soft, never breaks a send)
│   │   ├── whatsapp-notify.ts  # Event queue + immediate replies + digest builder
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
│   ├── automation-schedule.ts  # Le automazioni pianificate: orari, endpoint, parametri (ex workflow n8n)
│   ├── todo.ts                 # Aree, stati di avanzamento e span Gantt per /todo
│   ├── receivables.ts          # Da incassare: lettura importi "1.250,50", totali in centesimi, ordinamento
│   ├── fatturapa.ts            # XML FatturaPA 1.2 (FPR12), controlli P.IVA/CF/CAP, totali in centesimi: puro e testato
│   ├── shipping-companies.ts   # Compagnie di navigazione: validazione catalogo, filtri porto, contatto da creare
│   ├── shipping-itineraries.ts # Itinerari: lettura del testo incollato, riconoscimento porti, porti di base
│   ├── shipping-routes.ts      # Mappa rotte: tappe con coordinate, archi, frecce, navi, lettura coordinate
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
- Sidebar a gruppi (`NAV_GROUPS` in `Sidebar.tsx`): **Lavoro** (Oggi, To Do, Pipeline, Contatti, Follow-up), **Vendite** (Preventivi, Commerciale, Analytics), **Strumenti** (Navigazione, Fiere, Importa), **Solo admin** (Tourism Intelligence, Acumbamail, Da incassare: il gruppo non si disegna senza `isAdmin`), Impostazioni in fondo. Speaqi Agency non sta in un gruppo: è il pulsante in testa, solo per l'admin. Ogni voce passa comunque da `canAccessPath`; le altre pagine restano raggiungibili via URL
- **Prima pagina del titolare** (`CommandCenter` in testa a `/dashboard`, solo `isAdmin`, `GET /api/command-center`): una ricerca su tutto il workspace (`GET /api/command-center/search`: contatti di ogni lista, holding compresa, enti di Tourism Intelligence, mappe) e quattro riquadri — **Aspetta te** (pagamenti falliti, fatture scartate o in errore, bozze da inviare, preventivi pagati senza fattura, proposte Agency e presentazioni Tourism da approvare), **Soldi** (incassato e fatturato del mese nel fuso italiano, da fatturare, rinnovi dei prossimi 30 giorni), **Vendite** (trattative aperte per fase, preventivi in attesa di firma), **Mappe** (in lavorazione / pronte / su Speaqi / online). La logica sta in `src/lib/command-center.ts` (puro, `tests/command-center.unit.test.ts`); lo stato delle mappe in `src/lib/server/maps-status.ts`, che unisce il catalogo di StudioMap e le guide pubbliche di Speaqi **per id della mappa Speaqi**, in memoria un minuto e fail-soft (una fonte giù lascia l'altra e la pagina lo dice)
- **Scheda completa** (`/scheda/[id]`, `GET /api/contacts/[id]/overview`, in `SUPER_ADMIN_PATHS`): tutto su un cliente in una pagina — stato in una frase, trattative, preventivi con firma, abbonamento, fatture con stato SDI e XML, mappe, proposte Agency, enti e presentazioni Tourism, attività da fare, ultime email e attività. Le mappe arrivano da due strade: collegate a mano (`contact_map_links`, `POST|DELETE /api/contacts/[id]/maps`) e, per gli enti, da Tourism Intelligence (`tourism_crm_links` → ente luogo o luoghi che COVERS/MANAGES/PROMOTES → `tourism_destinations.speaqi_map_slug`). Una sezione che non si legge resta vuota invece di far cadere la scheda. Si apre dalla ricerca in prima pagina e dal pulsante «Scheda completa» del contatto
- **Da incassare** (`/incassi`, `GET|POST|PATCH|DELETE /api/receivables`): soldi personali da ricevere, che con Speaqi non c'entrano — solo nome, cifra e se è già incassato. Non tocca contatti, preventivi o finanza. Ogni riga è di chi l'ha scritta (`user_id = auth.uid()`, anche in RLS), non del workspace: un collaboratore non vede quelle del proprietario e viceversa. L'importo si scrive come viene (`parseReceivableAmount`: "1.250,50", "300 €", "12.5") e i totali si sommano in centesimi
- **Fiere** (`/fiere`, area `fiere`, off di default, `GET|POST|PATCH|DELETE /api/trade-fair-exhibitors`): gli espositori di una fiera da valutare e riprendere dopo l'evento. L'elenco si importa incollando una tabella CSV/TSV (`parseExhibitorsText` in `src/lib/trade-fair.ts`, puro e coperto da test); un reimport aggiorna i dati e il punteggio ma **non** tocca stato, priorità manuale, note e follow-up. Il punteggio (`scoreExhibitor`) misura quanto un espositore somiglia a un cliente di Speaqi Maps (enti del turismo, crociere, musei, esperienze, ospitalità) ed è solo un ordinamento: la priorità scelta a mano vince. L'ordine in pagina porta prima i follow-up scaduti. Per cambiare fiera si cambia `FAIR` in `fiere/page.tsx`
- **Compagnie di navigazione** (`/navigazione`, voce in fondo alla sidebar, `GET|PATCH /api/shipping-companies`): crociere, expedition, fluviali e traghetti di tutto il mondo, per vendere Speaqi Maps alle compagnie le cui navi arrivano a Napoli o a Civitavecchia (Roma). Il catalogo sta in `scripts/data/shipping-companies.json` (ricerca web di settembre 2026, allargata con la [lista delle compagnie di crociera](https://en.wikipedia.org/wiki/List_of_cruise_lines) e la categoria delle compagnie di navigazione italiane di Wikipedia: telefono ed email solo se visti in una fonte, altrimenti null; ogni voce porta le sue `sources`) e lo scrive `npm run shipping:import`, prova a secco di default (`--csv` per un file Excel, `--apply` per scrivere). Uno scalo `null` vuol dire **da verificare**, non "no": la pagina lo mostra tratteggiato e il filtro «Da verificare» lo ritrova. Lo script crea per ogni compagnia un contatto `holding` nella cartella «Compagnie di navigazione» (`legacy_id = shipping-<slug>`, `marketing_eligibility = review`: nessuna campagna automatica deve scrivere all'ufficio stampa di una compagnia di crociera), con il telefono dell'ufficio italiano quando c'è e priorità 2/1/0 secondo quanti dei due porti tocca. Un rilancio riempie sul contatto solo i campi vuoti e non tocca gli scali corretti a mano dalla pagina (`ports_manual`)
- **Navigazione — compagnia → itinerario → tappe → porto**: un itinerario (es. «Mediterraneo 7 notti» su MSC World Europa) si carica dalla scheda della compagnia **incollando le tappe come le mostra il sito**, una per riga. `parseItineraryText` (`src/lib/shipping-itineraries.ts`, puro e coperto da test) legge giorno, data e giorno della settimana davanti (saltati), paese dopo la virgola, ruolo fra parentesi (imbarco/sbarco/pernottamento), orari 24 h o AM/PM; le righe di navigazione fanno solo avanzare il giorno. I mesi si riconoscono interi o abbreviati, **mai come prefisso**: prima «8 Marsiglia» e «9 Genova» diventavano date («mar», «gen»). Il porto lo trova `resolvePort` provando **prima il contenuto fra parentesi** («Roma (Civitavecchia)», «Florence/Pisa (La Spezia)»: le compagnie scrivono Città (Porto)), poi il nome, poi i pezzi di «Firenze/Pisa», contro nome, slug, UN/LOCODE e alias. L'anteprima nella pagina mostra per ogni riga il porto riconosciuto e si può cambiare a mano; quello che non trova nulla diventa un porto nuovo, evidenziato in giallo **prima** di salvare
- **Navigazione — il salvataggio è uno solo**: itinerario e tappe li scrive la RPC `save_shipping_itinerary` in una transazione (security invoker, quindi con la RLS di chi chiama). Controlla esplicitamente che compagnia e porti siano del workspace, perché una foreign key non guarda la RLS. Un aggiornamento sostituisce le tappe; se una tappa è invalida non cambia niente. `merge_shipping_ports` unisce un porto doppione in un altro (tappe spostate, nome e alias del vecchio diventano alias del nuovo); un porto usato da un itinerario non si cancella (`on delete restrict`), si unisce
- **Navigazione — porti di base e flag Napoli/Roma**: `CORE_PORTS` (una quarantina di porti del Mediterraneo con alias e UN/LOCODE solo dove certo) vengono creati alla prima apertura da `ensureCorePorts`, che salta quelli già coperti da un alias (un porto di base unito a un altro non rinasce). Un itinerario che fa tappa a Napoli o Civitavecchia accende `calls_naples` / `calls_civitavecchia` in lettura (`effectivePortFlags`): vale più del catalogo, e il bollino sulla pagina resta bloccato finché lo dice un itinerario. La scheda **Porti** parte dal porto: compagnie che ci arrivano (da itinerari, più — per Napoli e Civitavecchia — quelle segnate dal catalogo, con asterisco) e itinerari con giorno e orari della sosta
- **Navigazione — porti del mondo e superguide** (scheda «Porti e superguide»): la domanda è «quale città raccontiamo dopo?». Circa 740 porti in nove macro-regioni (`PORT_REGIONS` in `src/lib/shipping-ports.ts`, puro e coperto da test: Mediterraneo, Nord Europa, Fiumi d'Europa, Caraibi, Nord America, Sud America e Antartide, Asia, Oceania e Pacifico, Medio Oriente/India/Africa), caricati da una ricerca web di settembre 2026. I passeggeri l'anno ci sono **solo** dove una fonte li pubblica (`stats_source`), con l'anno: un porto senza numero non è un porto a zero, e la classifica (`comparePorts`) lo mette dopo quelli misurati ordinandolo per compagnie. Il vincolo `shipping_ports_passengers_need_year` impedisce un numero senza anno. `destination` dice la città che si visita davvero (Laem Chabang → Bangkok, Warnemünde → Berlino e Rostock), perché la superguida è della città e non del molo. Lo stato della guida (`none` da valutare / `planned` da fare / `in_progress` / `live` pubblicata / `skip` non serve) si cambia dalla riga; i riquadri in testa contano per stato e dicono quale quota dei crocieristi misurati passa da città con la guida pubblicata. «Esporta CSV» scarica la lista filtrata (punto e virgola + BOM, si apre in Excel). La PATCH tocca solo i campi presenti nel corpo (`normalizePortWorldPatch`), così cambiare lo stato non azzera le statistiche
- **Navigazione — superguide: sì/no e quando** (`guide_priority`, 1 = subito, 2 = dopo le prime, 3 = più avanti): sulla riga c'è **un solo menu** (`GUIDE_CHOICES`: «Sì, subito» / «Sì, dopo le prime» / «Sì, più avanti» / In lavorazione / Pubblicata / No / Da valutare), perché la domanda è una sola. La priorità vale solo per `planned` e `in_progress` (vincolo `shipping_ports_guide_priority_open`; `normalizePortWorldPatch` la azzera quando lo stato passa altrove). La pagina apre sull'ordinamento «Superguide da fare prima» (`comparePorts('guide')`: in lavorazione → da fare per priorità → passeggeri). La prima valutazione di tutti i porti è stata fatta a settembre 2026 con una regola scritta nella nota di ogni porto (`guide_notes`, «Sì, subito. …» / «No. …»): **sì** a ogni posto con qualcosa da raccontare, con priorità dai volumi e dal peso della destinazione (Barcellona, Marsiglia, Atene, Miami, Nassau, Cozumel subito) — anche i porti d'imbarco (la guida è per chi arriva prima o resta dopo: Londra da Southampton, Los Angeles, Savona, Kiel), le cittadine della rotta Hurtigruten, le soste fluviali e le isole private (da proporre alla compagnia che le gestisce). **No** resta solo a una quarantina di porti: i doppioni di una città già coperta da un altro porto (Villefranche → Nizza, Leixões → Porto, Long Beach → Los Angeles), gli aeroporti e le basi da spedizione, gli isolotti disabitati, i porti industriali o ancora in progetto, e Port Canaveral. Chi era «No» nella prima passata e poi è diventato «Sì» porta nella nota il motivo di prima («Prima segnato «No»: …»). Napoli è pubblicata e Roma in lavorazione (confermato)
- **Navigazione dentro Tourism Intelligence** (migration `20261020090000_tourism_hubs` + `20261020090100_tourism_hubs_absorb_ports`): i porti sono righe di `tourism_hubs` con `mode = 'sea'`, passate **con lo stesso id**; la FK delle tappe punta a `tourism_hubs`. `shipping_ports` è una vista con `with cascaded check option`, quindi da lì si scrive solo un porto. Due cose non passano dalla vista e vanno sulla tabella: l'upsert dei porti di base (`ensureCorePorts`, `onConflict: 'user_id,mode,slug'`, perché lo slug è unico per tipo: Napoli porto e Napoli stazione) e gli embed PostgREST delle tappe (`port:tourism_hubs(...)`). `merge_shipping_ports` lavora sulla tabella e sposta anche gli operatori dell'hub. **La superguida passa alla destinazione** quando il porto le viene collegato (`tourism_link_hub_destination`): sul porto i campi si svuotano e resta `guide_moved_at`; `loadShippingPorts` legge la guida dalla destinazione (`applyDestinationGuides` in `src/lib/shipping-ports.ts`), il menu in pagina diventa di sola lettura e il PATCH risponde 409. **Ordine di deploy: prima le migration, poi il codice**
- **Aeroporti** (`scripts/tourism/hubs.ts`, logica in `src/lib/tourism-hubs.ts`, puro e coperto da test): `scripts/data/tourism-airports.json` sono i 3.244 aeroporti grandi e medi con voli di linea e codice IATA di OurAirports (pubblico dominio, ottobre 2026, 233 paesi), slug = IATA in minuscolo. `hubs.ts airports --input airports.csv [--write]` rigenera il catalogo dal CSV scaricato in una cartella vuota; `hubs.ts sql --input <catalogo> --owner UUID` scrive i blocchi SQL in `backups/tourism-hubs/` (stessa forma di `prepare.py`: proprietario in transazione, ruolo authenticated). Passeggeri e quota internazionale non sono ancora caricati
- **Navigazione — mappa delle rotte** (scheda «🗺️ Mappa rotte», `RoutesMap` + `src/lib/shipping-routes.ts`, puro e coperto da test): la mappa del mondo con gli itinerari caricati. Si sceglie una **compagnia** e si vedono tutte le sue rotte, un colore per itinerario; si sceglie una **nave** (es. MSC World Europa) e restano solo le sue, con le tappe numerate in ordine e il nome del porto. Con tutte le compagnie il colore dice la compagnia. Ogni tratta è un arco con una freccia nel verso di marcia: le linee sono **indicative** (collegano i porti in ordine, non seguono la rotta reale) e la legenda lo dice. L'arco si piega a sinistra del verso di marcia, così andata e ritorno fra gli stessi porti non si sovrappongono, e la curvatura cambia per itinerario, così la stessa tratta di dieci itinerari si apre a ventaglio; la tratta più corta passa per l'antimeridiano (`unwrapLng`). Una freccia si disegna solo se la tratta è lunga almeno 56 px a schermo: a vista mondo cento frecce sul Mediterraneo sono una macchia, zoomando compaiono. Due tappe di fila nello stesso porto sono una sosta, non una freccia. Napoli e Civitavecchia hanno l'anello arancione. Leaflet si importa **nel browser** (tocca `window`), tasselli OpenStreetMap. Le coordinate dei 742 porti del catalogo le ha scritte la migration `20260928150000_shipping_ports_coordinates` (due decimali, solo dove mancavano); un porto nuovo nasce senza e la mappa lo elenca in giallo come «senza posizione», con un campo che accetta `40.8359, 14.2488`, la virgola all'italiana o un link di Google Maps (`parseCoordinates` → `PATCH /api/shipping-ports` con `latitude`/`longitude`, sempre in coppia)
- **Navigazione — slug con lettere nordiche**: `normalizePortKey` traduce ø/æ/ð/þ/ß/ł/ı prima di togliere gli accenti. Senza, «Tromsø» diventava `troms` e «Bodø» `bod`, e due porti diversi potevano finire sullo stesso slug
- **To Do board** (`/todo`): standalone tasks (`tasks.contact_id is null`, `type = 'todo'`) are the one place for everything to do, Speaqi and non-Speaqi. They carry `area` (`speaqi` / `personale` / `altro`), `progress_state` (`todo` / `in_progress` / `blocked` / `done`), `progress_percent` and `start_date` (with `due_date` it draws the Gantt bar). `status` stays the binary flag the rest of the CRM reads: `/api/tasks/standalone` is the only place where the two are kept in sync. Standalone tasks are visible **only to the workspace owner** — the `tasks_workspace` RLS policy joins through `contacts`, which they don't have
- **To Do — la lavagna è la vista di partenza**: `/todo` apre sul kanban (`TodoKanban`), con Lista e Gantt come viste alternative. Le colonne vengono da `TODO_GROUPINGS` in `src/lib/todo.ts` e sono **al massimo quattro**, perché la lavagna deve stare tutta nella finestra: sotto i 1180 px scende a due colonne e la pagina torna a scorrere. Quattro raggruppamenti: *Avanzamento* (da fare / in corso / in attesa / fatte), *Quando* (oggi / questa settimana / più avanti / da pianificare), *Progetto* (le tre aree) e *Priorità*. Le **arretrate non hanno una colonna propria**: cadono in "Oggi", perché restano da fare oggi e una colonna di rimproveri in testa alla pagina non si guarda volentieri. Anche la lista apre su "Oggi", non più sulle arretrate
- **To Do — trascinare è l'unica scrittura implicita**: `todoDropPatch()` traduce la colonna d'arrivo nella modifica da salvare e nella frase da mostrare, e restituisce `null` quando la scheda è già dove è stata lasciata — un trascinamento a vuoto non deve contare come rinvio, visto che ogni cambio di `due_date` incrementa `reschedule_count` lato server. L'unica eccezione è una arretrata rilasciata su "Oggi": lì la colonna coincide già, ma l'intenzione è ridatarla. Il `+` in testa a ogni colonna crea l'attività **già** con i valori di quella colonna (`todoColumnDefaults()`)
- **To Do — le colonne si aggiungono dalla lavagna**: in fondo alle colonne c'è il riquadro tratteggiato «+ Aggiungi colonna», che chiede solo un nome (`POST /api/todo/columns`, tabella `todo_board_columns`). **Non è un raggruppamento a parte**: una colonna aggiunta a mano si vede in coda a *tutti* i raggruppamenti, perché una colonna chiamata «Da fatturare» ha senso sia guardando l'avanzamento sia guardando le date. Rinominarla, ricolorarla, riordinarla o cancellarla si fa dal pannello «⚙ Colonne» (`PATCH` per il singolo campo, `PATCH` con `order: [id]` per il riordino completo — scrivere una posizione per volta lascerebbe un ordine intermedio se la seconda scrittura non parte). Massimo 12
- **To Do — una colonna scelta a mano vince sul calcolo**: `tasks.board_column_id` è l'unico campo che dice dove sta una scheda appesa a una colonna aggiunta a mano, e vince su data, stato, area e priorità in ogni raggruppamento — ce l'ha messa qualcuno, e nessun automatismo deve portarla via. Per riportarla fra le colonne calcolate la si trascina fuori: `todoDropPatch` allora scrive `board_column_id: null` **insieme** alla modifica della colonna d'arrivo, e lo scrive anche quando la colonna d'arrivo coincide già con quella calcolata — lì la vecchia logica non avrebbe scritto niente e la scheda sarebbe rimasta appesa. Cancellare una colonna **non** cancella le attività: `on delete set null` sul database le rimette nella colonna che gli spetta, e lo fa il vincolo, non il codice, così non resta scoperto nessun percorso. `board_column_id` arriva dal corpo della richiesta e viene sempre verificato contro le colonne di chi scrive (`resolveBoardColumnId`)
- **To Do — nascondere una colonna non è cancellarla**: le spunte in «⚙ Colonne» tolgono una colonna dalla vista (anche «Fatte», che occupa un quarto dello schermo per roba che non si guarda più) e stanno in `localStorage` (`hiddenColumns` dentro `speaqi.todo.prefs`), per raggruppamento e per postazione. Nascondere l'ultima colonna rimasta non svuota la lavagna: si torna a mostrarle tutte
- **To Do — oltre le quattro colonne la lavagna scorre**: fino a quattro sta tutta in finestra come prima; dalla quinta le colonne prendono una larghezza minima di 230 px e si scorre di lato (`.todo-board.is-scrolling`). Il riquadro «+ Aggiungi colonna» è una traccia stretta a parte (168 px): non è una colonna di lavoro e non deve rubare larghezza a quelle che lo sono
- **To Do — un vocale su Telegram diventa un'attività** (`POST /api/integrations/telegram/webhook`, guida in `docs/TELEGRAM-TODO.md`): si manda una nota vocale e il CRM la trascrive (`transcribeAudio`, lo stesso percorso del microfono nel browser), ne ricava le azioni e le scrive. Serve soprattutto ad **aggiornare** mentre si fa altro — «ho chiuso il preventivo Rossi, domani chiamo Bianchi» è un fatto solo e resta un gesto solo. Tre garanzie da non smontare: la rotta risponde **sempre 200** (Telegram riconsegna finché non lo riceve, quindi un 500 diventerebbe un ciclo: l'errore si dice in chat e in `telegram_inbox.error`); l'unicità sta sul **database** (`telegram_inbox.update_id` unico, scritto *prima* di qualunque lavoro) più un `idempotency_key` `telegram:<update_id>:<n>` su ogni attività creata; e alle chat fuori da `TELEGRAM_ALLOWED_CHAT_IDS` non si risponde nemmeno — un bot risponde a chiunque ne conosca il nome, e rispondere confermerebbe che è vivo
- **To Do — il modello propone, `normalizeTodoActions` decide**: le azioni che tornano da OpenAI vengono filtrate contro le attività e le colonne che esistono davvero (`src/lib/server/todo-voice.ts`, puro e coperto da test). Un `task_id` inventato, una creazione senza titolo, una colonna che non c'è o un aggiornamento che non aggiorna niente vengono buttati senza rumore: un'allucinazione non deve poter scrivere sul database. Una percentuale fra 1 e 99 senza stato esplicito diventa «in corso» — dalla pagina la barra e la colonna si vedono entrambe, da un vocale no, e un'attività al 50% ferma in «Da fare» non si ritroverebbe più
- **To Do — ordinamenti**: `TODO_SORTS` (priorità, scadenza, avanzamento, aggiunte di recente, alfabetico) vale dentro ogni colonna e nella lista; a parità di criterio si scende sempre su scadenza → inserimento → id, altrimenti due schede identiche si scambiano di posto a ogni render. La colonna "Fatte" ignora l'ordinamento scelto e mostra le ultime chiuse per prime. Vista, raggruppamento, ordinamento, filtro area e "mostra fatte" restano in `localStorage` (`speaqi.todo.prefs`), applicati dopo l'idratazione perché il primo render deve coincidere con quello del server
- **To Do — il campo data non salva mentre si digita** (`TodoDateField`): un `input[type=date]` emette un `change` a ogni segmento e finché la data non è completa il valore letto è la stringa vuota. Salvando a ogni evento si scriveva `due_date: null` a metà digitazione, il componente si ri-renderizzava vuoto e i segmenti già inseriti sparivano: si riusciva a mettere una cifra per volta. Il valore vive in locale e si salva solo a data completa, o all'uscita dal campo quando è stata svuotata davvero
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

- **Internal management**: `/preventivi` — full CRUD for quotes. La fascia «Offerte generate» parte **chiusa**: il costruttore prende tutta la larghezza e il pulsante «Preventivi fatti (N)» la apre; la scelta resta in `localStorage` (`speaqi.preventivi.prefs`), letta dopo l'idratazione
- **Public page**: `/preventivo?id=TOKEN` — customer-facing quote
- **Packages** (scritti nel codice, `src/lib/speaqi-quote-packages.ts`): `platform` PIATTAFORMA SPEAQI €990 (una tantum, bonifico) e `video_map` VIDEO NELLA MAPPA €400 + IVA/anno a video, prezzo fisso senza barrato (era €300 con €400 barrato fino al 24/09/2026), `billing: 'yearly'`. `quoteDraftFromPackage()` e' la definizione unica di "preventivo di un pacchetto": la usano il costruttore e `/vendita`
- **Pricing display**: net price + IVA, total with IVA
- **Payment methods**: bank transfer, Stripe, or both
- **Contract**: auto-accept or email-based acceptance with Resend
- **Status flow**: draft → sent → accepted → paid (or cancelled)
- **Payment state**: pending → deposit_requested → paid → waived
- Key API endpoints:
  - `get_public_quote` (RPC, letta dalla pagina server) — public quote view
  - `POST /api/quotes/public/checkout` — Stripe checkout session (ramo abbonamento per `billing_interval = 'year'`)
  - `POST /api/quotes/public/accept-contract` — contract acceptance (spunta)
  - `POST /api/quotes/public/sign` — firma disegnata
  - `POST /api/integrations/stripe/webhook` — eventi Stripe degli abbonamenti

### Abbonamenti annuali (Video nella mappa)

- **Un abbonamento si paga solo con carta e per intero**: `applyBillingRules` (`src/lib/server/quotes.ts`) forza `payment_method = 'stripe'`, acconto 100% e saldo 0 su ogni POST/PATCH con `billing_interval = 'year'`. Acconto 100% e non 0: con un acconto a zero il preventivo risulterebbe `waived`, cioe' niente da pagare. €400 + 22% = €488, e Stripe addebita esattamente `toCents(total_amount)`
- **Stripe solo dopo la firma, solo per gli abbonamenti**: sulla pagina pubblica `canUseStripe = billing_interval === 'year' && has_signature && non pagato`. Tutti gli altri preventivi restano a bonifico come prima. Il checkout risponde 409 se manca la firma, se l'abbonamento esiste gia' o se il totale e' cambiato dopo la firma (`quote_signatures.amounts_snapshot`); una sessione Stripe ancora aperta si riusa, cosi' due clic non fanno due abbonamenti
- **Catalogo Stripe**: con `STRIPE_VIDEO_MAP_PRICE_ID` il checkout usa il prodotto del catalogo invece di `price_data`, solo se l'importo coincide al centesimo con il totale firmato. Prima si prova il prezzo pieno da solo (`catalogPriceCents`, 488 € = il listino attuale, **senza** coupon); poi, se `STRIPE_VIDEO_MAP_COUPON_ID` c'e', prezzo + coupon **per sempre** (`catalogAmountCents`, 366 €), che resta per i preventivi firmati a 300 € + IVA e fa rinnovare anche loro allo stesso prezzo. Tutto il resto (piu' video nello stesso preventivo, un importo fatto a mano, coupon non "per sempre", prezzo non annuale) torna al prezzo scritto al volo. La metadata `pricing=catalog|inline` dice quale strada e' stata presa; una sessione aperta con l'altra strada viene chiusa (`expire`) prima di crearne una nuova
- **Firma disegnata** (`QuoteSignatureForm` + `SignaturePad`): nome e cognome, firma nel riquadro, accettazione dei termini e — per l'abbonamento — approvazione specifica del rinnovo automatico (artt. 1341-1342 c.c.). Stesso cancello dell'accettazione con spunta: servono token pubblico **e** token di accettazione. La RPC `sign_public_quote_contract` e' eseguibile **solo dal service role**, perche' IP e user-agent li legge la rotta: esposta ad `anon`, chiunque potrebbe scriverli a piacere. L'immagine non esce mai dal CRM: `get_public_quote` espone solo `has_signature`, nome e data; il PNG si legge da `GET /api/quotes/[id]/signature` (RLS ereditata da `quotes`)
- **Webhook** (`/api/integrations/stripe/webhook`, firma verificata a mano in `src/lib/server/stripe.ts`, nessun SDK): `checkout.session.completed` → preventivo pagato, contatto Paid, trattativa vinta (`markQuotePaidFromStripe` + `applyQuotePaidToContact`, lo stesso effetto del PATCH manuale); `invoice.paid` → rinnovo registrato, `current_period_end` aggiornato e task «Emettere fattura elettronica» (le ricevute Stripe non sono fatture SDI); `invoice.payment_failed` → `past_due` + chiamata ad alta priorita'; `customer.subscription.updated/deleted` → stato e disdetta. I `mode=payment` si ignorano. Idempotenza su due livelli: `stripe_webhook_events` e update condizionato `status <> 'paid'`, cosi' riconsegne, `invoice.paid` arrivato prima del checkout e la verifica della sessione sulla pagina di ritorno (`?session_id=`) non raddoppiano mai attivita' e passaggio a Paid. Le versioni API recenti hanno spostato l'id dell'abbonamento in `invoice.parent.subscription_details`: le letture accettano entrambi i formati
- **Configurazione Stripe**: endpoint `https://<APP_BASE_URL>/api/integrations/stripe/webhook` con gli eventi `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`, versione API uguale a `STRIPE_API_VERSION`; il segreto va in `STRIPE_WEBHOOK_SECRET`
- **Link vendita** (`/vendita/<token>`): ogni membro del team ha un link personale, generato/rigenerato/revocato da Impostazioni → Team (solo admin). Si salva solo lo SHA-256 del token (tabella `sales_links`, non `team_members`, che i collaboratori leggono): il link si vede una volta, poi si rigenera. Il commerciale compila i dati dell'attivita' davanti al cliente; il server (service role) trova o crea il contatto per email (scope crm, stato Quote, `responsible` = il commerciale), crea il preventivo con `createQuoteRecord` (`src/lib/server/quote-create.ts`, lo stesso di `POST /api/quotes`) e reindirizza a `/preventivo?id=…&accept=…`, senza email. Tetto di 10 preventivi l'ora per link; un reinvio entro 10 minuti riusa il preventivo. Pagina `noindex` e `no-referrer`, perche' il token sta nel percorso
- **Reclutamento commerciali** (pagina su **guides.speaqi.com/diventa-commerciale**, repo speaqi, `apps/web/src/app/diventa-commerciale`; qui `/diventa-commerciale` è un redirect permanente in `next.config.ts`, e `SALES_RECRUIT_URL` è il link che Impostazioni → Team e `/vendita` mostrano): il CRM resta la fonte di provvigioni e candidature. Le provvigioni stanno **solo** in `SALES_PROGRAM` (`src/lib/sales-program.ts`, oggi 20% del primo anno e 10% di ogni rinnovo sul netto, per ogni video); il prezzo viene dal pacchetto `video_map`. La pagina su Guides le legge da `GET /api/programma-commerciali` (pubblico, `publicSalesProgram()`, cache 5 minuti), quindi cambiare listino o percentuali aggiorna la pagina senza toccare il web. La candidatura (`POST /api/candidature-commerciali`, inoltrata dal server di Guides, workspace da `AUTOMATION_WORKSPACE_USER_ID`, mai dal corpo) crea un contatto **personal** — fuori dalla pipeline clienti — con categoria «Candidato commerciale», `source = 'candidatura_commerciale'`, un'attività con le risposte e una chiamata per il giorno dopo; un'email gia' presente riceve solo attivita' e chiamata. Honeypot `website` (risposta 200 finta, nessuna scrittura) e tetto di 30 candidature l'ora. I messaggi d'errore di questa rotta arrivano a schermo così come sono (400/429/503): vanno scritti per il candidato. Chi viene scelto riceve il link vendita da Impostazioni → Team
- **Fattura elettronica (Aruba)** (`/fatture`, solo il titolare): la ricevuta Stripe non è una fattura. A ogni incasso con carta (primo pagamento e ogni rinnovo) il webhook prepara una **bozza** (`createInvoiceDraftFromQuote`, idempotente); per i bonifici e per un lavoro nato fuori dal CRM si registra il preventivo, lo si segna pagato e lo si fattura da «Da fatturare». **Nessun automatismo invia**: l'invio allo SDI lo conferma sempre una persona (`POST /api/invoices/[id]/send`). Logica in `src/lib/server/invoices.ts`, XML in `src/lib/fatturapa.ts`, client in `src/lib/server/aruba-fe.ts` (accesso, `services/invoice/upload` con l'XML non firmato: firma e consegna le fa Aruba, `getByFilename` per lo stato). Regole:
  - **Il numero si prende all'invio, dopo i controlli** (`validateFeInput`: P.IVA con cifra di controllo, CF, CAP, codice destinatario o PEC, natura per le righe a 0): una fattura che non partirebbe non brucia un numero. Se Aruba rifiuta, il numero resta a quella fattura e la si reinvia (progressivo di invio nuovo a ogni tentativo). La data non può precedere quella dell'ultima fattura dell'anno
  - **La serie continua quella di Aruba**: in «Dati fiscali» si scrive l'ultimo numero emesso sul pannello; il formato (`{n}`, `{n}/{yyyy}`…) è un'impostazione
  - **Esito incerto** (rete, timeout, 5xx): la fattura va in errore con l'invito a controllare sul pannello prima di reinviare; un doppione verrebbe comunque scartato dallo SDI. Un invio rimasto «in invio» per 10 minuti torna in errore
  - **IdTrasmittente è Aruba, non chi emette**: `ARUBA_ID_TRASMITTENTE` = 01879020517 (Aruba PEC), controllato da Aruba in modo sincrono: con un altro codice il caricamento viene rifiutato
  - **Quote Aruba** (documentazione API, ottobre 2026): un accesso al minuto per IP, 30 invii e 12 ricerche al minuto, e per account al livello base 60 richieste l'ora e 10.000 l'anno; una richiesta rifiutata con 429 fa ripartire l'attesa. Per questo il token si tiene in memoria fino alla scadenza (30 minuti) e la lettura degli stati è parca
  - **Stato SDI** ogni ora dalle 7:45 alle 21:45 (job `invoices-sdi` → `/api/automation/invoices-sync`): solo fatture ancora «inviate» degli ultimi 20 giorni, al massimo 8 per giro a 6 secondi l'una dall'altra, ognuna non prima di due ore dall'ultimo controllo, e al primo 429 il giro si ferma
  - **Ambiente demo**: indirizzi `demoauth.`/`demows.fatturazioneelettronica.aruba.it`, ma serve un accreditamento apposito: le credenziali di produzione lì non valgono
  - **Bozza dal preventivo**: alternative non scelte escluse, sconto come riga negativa, «P.IVA / CF» del preventivo riconosciuto dalla forma, provincia letta da «Sorrento (NA)». Un rinnovo con importo diverso dal preventivo diventa una riga netta dall'incasso. Preventivi con acconto e saldo: la bozza fattura l'intero, e lo dice
  - Test: `tests/fatturapa.unit.test.ts`, `tests/invoices.unit.test.ts` (giro completo con Aruba finto). Endpoint, campi e stati controllati sulla documentazione API di Aruba (v1, `apidoc/docs.html`); **non ancora chiamati con credenziali vere**: prima fattura di prova in demo (o, senza accreditamento demo, una fattura reale controllata a mano)
- **Firma in presenza dal CRM**: sulla scheda di un abbonamento non firmato, «Firma in presenza» chiede a `send-acceptance-email` il link con `link_only: true` e lo apre senza mandare email. Rigenera il token: un link inviato prima smette di valere

## Collaborator / Workspace Access

- Collaborators see only contacts assigned to them (by `responsible` or `assigned_agent`)
- Admin sees all contacts by default; toggle `workspace=all` to see everything
- Filter logic in `src/lib/server/collaborator-filters.ts` and `src/lib/data.ts` (contact visibility helpers)
- Team members linked via `auth_user_id` on `team_members` table
- `team_members` table has `name`, `email`, `color`, `auth_user_id`, `is_current_admin`
- **Accesso dei collaboratori** (`src/lib/server/team-login.ts`): «Rimuovi» cancella solo la riga `team_members`, l'utente di login resta in `auth.users`. Ricreando il collaboratore con la stessa email, `createUser` rispondeva "already been registered" e il CRM non andava avanti: ora `ensureMemberLogin` ritrova quell'utente e lo riusa con la password scelta. «Cambia password» / «Crea accesso» sulla riga (`PATCH /api/team-members/[id]` con `password`, min. 8 caratteri) fa lo stesso. Riusare un utente vuol dire poterne cambiare la password, quindi `assertAuthUserBelongsToWorkspace` rifiuta il titolare di un altro spazio di lavoro (righe sue in `team_members`/`contacts`) e un collaboratore di un altro team; anche il collegamento per sola email lo rispetta. Test: `tests/team-login.unit.test.ts`
- **Area permissions**: the workspace owner is the super admin (always every area). For each collaborator, `team_members.allowed_areas` (text[], `null` = defaults Pipeline/Contatti/Follow-up) lists the visible areas, edited via checkboxes in `/impostazioni/team`. Areas, defaults and path mapping live in `src/lib/areas.ts` (single source of truth, tested by `node --test scripts/areas.test.mjs`). Enforcement: sidebar + settings cards filtered and blocked URLs redirected to `/dashboard` in `(app)/layout.tsx`; area-specific API routes call `requireArea(auth, '<area>')` right after `requireRouteUser`. Acumbamail, Hospitality, Commerciale, Da incassare, Wine Project, WhatsApp settings and Team management are super-admin only (`SUPER_ADMIN_PATHS`, `auth.isAdmin`) and not delegable. To Do and Navigazione are areas (off by default); `/api/todo/columns` stays ungated because `useCRM` loads it for everyone. New area-specific routes must add a `requireArea` guard.

## Presentazioni per destinazione (Tourism Intelligence)

Il tasto **Crea la presentazione** (scheda di un ente, o tab **Presentazioni** di `/tourism`) genera la «Proposta destinazioni» personalizzata per un ente o un DMC: dodici slide, nello stesso ordine della presentazione di riferimento di ottobre 2026 — apertura, territorio, problema, risposta, prova (le mappe vere di Napoli e Roma), contenuti, lingue, visitatore, metodo, prezzo, area riservata, demo. Si rivede, si approva e si condivide con un link (o si salva in PDF dal browser). Tutto riservato al proprietario del workspace (`requireTourismOwner`), come il resto del modulo.

- **Il modello è generico e si modifica dal CRM** («Modifica il modello» nel tab): per ogni slide tipo (`cover`, `statement`, `cards`, `steps`, `closing`), titolo, testo, voci, riga in fondo e **istruzione per l'agente** (cosa si personalizza). Nei testi valgono i segnaposto `{{destinazione}} {{ente}} {{paese}} {{prezzo}} {{contatto}}`. La proposta di partenza sta in `DEFAULT_DECK_TEMPLATE` (`src/lib/tourism-deck.ts`, da `company/profile.md` di speaqidesign): «Ripristina la proposta di base» la rimette. Modificarla non cambia le presentazioni già create, vale per le nuove e per le rigenerazioni. **Un modello già salvato resta quello vecchio** (`tourism_deck_templates` si scrive solo alla prima apertura): per passare alla proposta nuova si usa il ripristino e si salva. Le slide da 5-6 schede (contenuti, prezzo) vanno su due righe da tre, compatte (`.compact` in `deck.module.css`)
- **Il form** chiede destinazione, ente, paese, prezzo proposto, contatto, testo libero (appunti, mail, testo del sito), **documenti** (PDF, Word, TXT/MD/CSV: max 4, 12 MB) e **foto** (JPG/PNG/WebP: max 8, 8 MB). Il tipo si decide dai byte, non dal nome (`sniffUpload`). Il bucket privato `tourism-deck-assets` si crea alla prima richiesta, come quello dei backup.
- **L'agente** (`tourism-deck-agent.ts`, API Responses, JSON strict) riceve il modello con i segnaposto già riempiti, la scheda dell'ente e i **soli luoghi approvati** di Tourism Intelligence, il testo, i documenti (Word/testo estratti senza dipendenze; i PDF li legge il modello) e le foto (ridimensionate a 1280 px con `sharp`). Riscrive i testi e sceglie la foto per copertina/messaggio. **Il modello propone, il codice decide** (`mergeGenerated`, `guardGenerated`): tipo, numero di voci e istruzioni restano quelli del modello; un importo in € che non sta nel modello, nei valori inseriti o nei materiali diventa `[DA VERIFICARE]`; un altro numero senza riscontro si segnala; una foto non del deck si toglie. Tutto ciò che sta nei documenti è dato, mai istruzione (prompt injection).
- **Condizioni, numeri e contatto non si indovinano.** La mappa è gratuita: il campo «prezzo» porta le condizioni, e senza un valore inserito resta quello del modello («in cambio garantite almeno 100.000 accessi all’anno: QR in ogni luogo, sulle mappe e sui materiali, link sul sito e sui social…»). I tre numeri del territorio nascono `[DA VERIFICARE: quanti]` e il contatto `[DA VERIFICARE]`. **Non si approva finché restano segnaposto** (`setApproval`). Il video di presentazione non è fra gli inclusi finché non è confermato.
- **Se l'agente fallisce** il deck resta con le slide del modello e stato `failed` col motivo: si corregge a mano. Una generazione alla volta per deck (UPDATE condizionato; una ferma da oltre 6 minuti si riprende). Salvataggi con `version` (409 su conflitto); modificare una presentazione approvata la riporta in revisione e il link smette di funzionare.
- **Vista pubblica** `/presentazione/<token>` (fuori da `(app)`): solo presentazioni `approved`, token di 64 caratteri, `noindex` e `no-referrer`, foto con URL firmati a 6 ore. Stesse slide dell'anteprima dell'editor (`DeckPlayer`, palco 1920×1080 scalato). `?print=1` apre la stampa del browser: ogni slide è una pagina 16:9.
- **PDF generato dal server** (`tourism-deck-pdf.ts`): Chromium apre la pagina pubblica sullo stesso server (`127.0.0.1:$PORT`) e la stampa, 1920×1080 per pagina. Il Chromium è **`@sparticuz/chromium`** (binario autonomo da ~67 MB, con `puppeteer-core`): niente apt, perché sull'immagine Ubuntu di Railway il pacchetto `chromium` è solo uno stub di snap. Un Chromium alla volta (coda in processo, 90 s di tetto), un PDF per versione in `tourism-deck-assets/<utente>/<deck>/deck-v<versione>.pdf` (le versioni vecchie si tolgono), una richiesta sola per file anche con cento aperture insieme. Si prepara all'approvazione; `GET /presentazione/<token>/pdf` (pubblico, solo approvate) e `GET /api/tourism/decks/<id>/pdf` (proprietario) lo servono. Se Chromium non risponde, la rotta pubblica ripiega sulla stampa del browser. `next.config.ts` lo tiene fuori dal bundle (`serverExternalPackages`) e copia i binari nello standalone (`outputFileTracingIncludes`, solo per le rotte che lo usano): senza, in produzione manca il file. `CHROMIUM_PATH` indica un Chromium di sistema al posto di quello incluso. Memoria: 300-500 MB per qualche secondo a ogni PDF; con un container stretto è il punto da guardare. Test: `npm run test:tourism:pdf` (Chromium vero, a parte perché lento).
- **Numeri e funzioni della proposta** vengono solo dalla presentazione di riferimento e dal profilo Speaqi: nessuna funzione, tempo o prezzo in più. Cambiando le condizioni si cambia il modello (`vars.prezzo`), non il codice.
- File: `src/lib/tourism-deck.ts` (puro), `src/lib/server/tourism-deck-{agent,assets}.ts`, `tourism-decks.ts`, API `src/app/api/tourism/decks/**` e `deck-template`, UI `src/components/tourism/deck/`, migration `20261019190000_tourism_decks.sql`. Test: `tourism-deck*.unit.test.ts`, `tourism-deck-pdf.unit.test.ts`, `tourism-deck.db.test.ts` (PGlite, RLS), `npm run test:tourism:decks:ui` (a video, API finte).
- **Non c'è ancora l'invio.** Il passo successivo del giro commerciale è la bozza email con il link della presentazione approvata, nel motore di `email_drafts`.
- **La presa in carico della generazione non usa `.or()`** (vale anche per Agency): con PostgREST un filtro `or` su un UPDATE si applica anche alla risposta, cioè alla riga già passata a `generating`, quindi una presa riuscita tornava vuota — e con `select('id')` la richiesta falliva con `42703` (colonna non selezionata). Si fa con due UPDATE condizionali (`neq('status','generating')`, poi `eq` + `lt('updated_at', stale)`). Provato su PostgREST 12 vero (`tests/agency.stack.test.ts`, "regressione Tourism").

## Speaqi Agency (`/agency`)

Proposte commerciali su misura — siti premium, branding, SEO/GEO e motori AI, marketing, campagne, consulenza, software, automazioni e AI, social, progetti digitali — dal brief alla presentazione, collegata al preventivo. **Non è un secondo CRM**: il cliente è un contatto (`contacts`), la trattativa resta in `deals`, il prezzo resta in `quotes`. Riservata al proprietario del workspace (come Tourism, `requireAgencyOwner`, `'/agency'` in `SUPER_ADMIN_PATHS`).

Flusso: **Cliente → Opportunità → Brief → Analisi AI → Presentazione → Preventivo → Proposta**.

- **Nuova proposta in un gesto** (`NewProposalDialog`): cliente dal CRM (ricerca su `/api/contacts`) o nuovo (creato con `POST /api/contacts`, quindi pipeline, trattativa e follow-up come ogni lead), servizi, brief, sito, documenti (PDF, Word, **PowerPoint**, testo), foto e logo. `POST /api/agency/projects` crea l'opportunità, salva i materiali (tutto o niente), legge il sito e avvia l'agente. L'opportunità aggancia la trattativa aperta del contatto (`getOpenDeal`) e scrive un'attività nella sua timeline.
- **Materiali** (`agency-assets.ts`): il tipo si decide dai byte (riuso di `sniffUpload` di Tourism, più il riconoscimento `.pptx`); il testo di un PowerPoint si estrae slide per slide senza dipendenze (`extractPptxText`); il sito si legge con il fetch sicuro della ricerca Tourism (`fetchResearchPage`: solo indirizzi pubblici), redirect seguiti a mano e ricontrollati, e si salva come documento `website`. Bucket privato `agency-assets`, creato alla prima richiesta.
- **Agente** (`agency-agent.ts`, API Responses, JSON strict). Due compiti, una chiamata ciascuno: `generate` (analisi con **fatti verificati con la fonte, ipotesi, dati mancanti**, strategia, titolo, stile e slide — numero e tipo decisi dal progetto) e `revise` (un'istruzione in linguaggio naturale → solo le operazioni `update`/`insert`/`delete`/`move` necessarie: le altre slide restano identiche). Lavora **dopo la risposta** (`inBackground`), la pagina segue lo stato "In generazione".
- **Il modello propone, il codice decide** (`lib/agency.ts`, puro e testato): 20 tipi di slide (copertina, indice, capitolo, messaggio, contesto, problemi, opportunità, soluzione, servizi, metodo, roadmap, deliverable, benefici, numeri, grafico, prima/dopo, citazione, investimento, prossimi passi, chiusura); importi e percentuali senza riscontro nei materiali → `[DA VERIFICARE]` (una percentuale vale solo se nei materiali c'è la stessa percentuale: "40 ettari" non giustifica "+40%"); i valori di "numeri" e "grafico" pure; foto solo del progetto, mai due volte; copertina in testa e chiusura in fondo. In revisione le guardie valgono **solo per le slide toccate**: una cifra scritta a mano altrove resta.
- **Nessun importo nelle slide.** La slide "investimento" non ha righe: legge il preventivo collegato (`quote_id`) quando si mostra, si stampa o si esporta. Presentazione e preventivo non possono dire cifre diverse. Una slide investimento senza preventivo conta come `[DA VERIFICARE]`.
  - La slide mostra solo le righe a prezzo; le righe a 0 € sono "comprese nel prezzo" (elencate nel preventivo). Con acconto manuale (`payment_terms_mode: 'manual'`) scrive "Alla firma / Saldo + IVA" (`deposit_net`, `balance_net`, mai per gli abbonamenti annuali) con `payment_terms_note` e `public_note`. `QUOTE_FIELDS` deve contenere `deposit_amount`, `payment_terms_note`, `public_note`: senza, la slide perde acconto e note in silenzio.
  - Una scheda con `value` di una o due cifre ("6") si disegna numerata a mano (`numberedMark`), per elenchi di interventi 1-10.
- **Preventivi**: il costruttore resta `/preventivi`. `?agency_project=<id>` precompila cliente e titolo e il preventivo nasce collegato (`quotes.agency_project_id`, controllato in `POST /api/quotes`: stesso workspace, stesso cliente); `?edit=<id>` apre un preventivo. Da un'opportunità si collega anche un preventivo esistente dello stesso cliente. Un trigger impedisce di agganciare progetti, preventivi o contatti di un altro proprietario (una foreign key non guarda la RLS).
- **Presentation Studio** (`/agency/presentazioni/<id>`): elenco slide (aggiungi per tipo, sposta, duplica, elimina), campi della slide, modello (Speaqi / Chiaro / Navy) con accento Speaqi o del cliente e logo del cliente, preventivo mostrato, revisione AI con suggerimenti, rigenerazione da capo, **versioni** (ogni salvataggio, generazione e revisione è una versione; il ripristino è una versione nuova), anteprima dal vivo. Approvazione bloccata finché restano `[DA VERIFICARE]`; una modifica a una presentazione approvata la riporta in revisione e spegne il link.
- **Disegno: "colour chapters"** (ottobre 2026, dalla taste-skill). Ogni slide è un campo di colore pieno da bordo a bordo, come una serie di manifesti: il campo lo decide il tipo di slide e due slide vicine non hanno mai lo stesso (`deckFields` + `fieldIsDark` in `lib/agency.ts`, usati dalla pagina e dal PDF). Heuvel Grotesk 400 per titoli e cifre (`font-synthesis: none`), Inter per il resto; crema, sabbia, navy e l'accento. Regole del disegno: niente etichetta maiuscola sopra il titolo (il `kicker` va nella testata corrente in alto a sinistra, con `02 / 14` a destra), niente schede con bordo, filetti sottili, ombre o sfumature; si separa con lo spazio, la scala e un campo di tono. Le voci stanno in colonne con il numero enorme quando c'è (`numberedMark`), oppure in fasce di tono; contesto, soluzione, deliverable e prossimi passi in righe grandi; una foto prende metà slide da bordo a bordo (`image_left` la mette a sinistra) su messaggio, contesto, soluzione, deliverable, prossimi passi, capitolo e chiusura; la copertina mette la foto a destra con un taglio netto. Il titolo sale alla comparsa della slide (solo a schermo, `prefers-reduced-motion` rispettato). Tre modelli: **Speaqi** (`editorial`: alterna crema e navy, accento su capitoli e chiusura), **Chiaro** (`institutional`: crema e sabbia), **Navy** (`bold`: navy e blu notte). Gli importi si scrivono "5.500 €" (`formatMoney`, separatore a mano: Node e Chromium non concordano). I file dei caratteri stanno in `public/deck/`. Cambiando il disegno si alza `AGENCY_DESIGN_VERSION` (`agency-pdf.ts`), così i PDF in cache si rifanno.
- **Consegna: la pagina HTML, non un file.** Una proposta approvata si consegna col link `/proposta/<token>` (a schermo intero, tastiera e tocco, animata); il PDF si scarica dalla stessa pagina, ed è la pagina stampata, quindi uguale. Non c'è un'esportazione PowerPoint (tolta a ottobre 2026: se serve di nuovo, si rimette `pptxgenjs` e una rotta `…/pptx`; resta la **lettura** di un `.pptx` caricato come materiale).
- **PDF**: dallo stesso Chromium delle presentazioni Tourism (`renderPdf`), **anche in bozza** (Chromium apre `/proposta/<token>?render=<hmac>` con una chiave valida per quella sola versione, `AGENCY_RENDER_SECRET`; ogni pagina porta "Bozza"); un PDF per versione + preventivo + identità, in cache su Storage.
- **Vista pubblica** `/proposta/<token>`: solo approvate, `noindex`, `no-referrer`; il pulsante "Apri il preventivo e accetta" porta al preventivo pubblico solo se il preventivo è `sent`/`accepted`/`paid`.
- **Sezioni** di `/agency`: Dashboard (pipeline per stato, valore dai preventivi), Progetti e opportunità, Clienti (rimandano alla scheda CRM), Presentation Studio, Preventivi, Documenti (archivio dei materiali e delle presentazioni), Template (galleria dei 20 layout nei tre stili, identità dell'agenzia, categorie di servizio).
- File: `src/lib/agency.ts`, `src/lib/server/agency*.ts`, API `src/app/api/agency/**`, pagine `src/app/(app)/agency/**` e `src/app/proposta/[token]`, componenti `src/components/agency/`, migration `20261020130000_agency.sql`.
- Test: `tests/agency.unit.test.ts` (in `test:unit`); `tests/agency.stack.test.ts` contro Postgres 16 con **tutte** le migration + PostgREST 12 vero + storage del gateway (`npm run agency:stack`, poi `source <(tests/agency-stack/stack.sh env)` e `npm run test:agency:stack`); `tests/agency.browser.ts` (`npm run test:agency:ui`) sull'app buildata contro lo stesso stack, con l'AI vera.

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
- **Presentazione del mittente**: ogni email si apre con saluto + “sono Massimo Morgante, fondatore di Speaqi.”. La regola vive in `src/lib/email-ai-framework.ts` (`EMAIL_SENDER_*`, sezione “## Chi scrive” del prompt) ed è garantita a valle da `ensureDraftRequiredAssets`, che inserisce la riga dopo il saluto quando il modello la dimentica. La stessa riga è nei modelli Wine e nell'outreach Hospitality; per le sequenze Wine Project i testi salvati in `wine_project_automation_settings.sequence_templates` vincono sui default, quindi la presentazione viene garantita da `normalizeSequenceTemplates` (`ensureSenderIntroInText`) a ogni lettura e salvataggio. La firma completa resta solo in fondo (firma Gmail)
- Messaging baseline in `src/lib/email-ai-framework.ts` (`DEFAULT_EMAIL_AI_FRAMEWORK`); every field is overridable per user in `user_settings`
- **Wine Project — riga-pulsante verso la demo**: nel corpo di uno step una riga nella forma `→ [ETICHETTA]` diventa il bottone verso la demo personalizzata della cantina (`*|WINE_URL|*`, un link firmato per evento). Prima il bottone era agganciato a una frase fissa, quindi riscrivere il testo lo faceva sparire in silenzio; la vecchia frase resta riconosciuta. I merge tag Acumbamail entrano **dopo** la formattazione, altrimenti un `**{{azienda}}**` in grassetto produce `***|COMPANY|***` e il tag non viene piu' sostituito
- **Wine Project — modifica dei testi e filtro reazioni** (`/impostazioni/wine-project`): ogni email della sequenza ha un pulsante di salvataggio proprio (`PATCH /api/wine-project/automation` con `sequence`), oltre al salvataggio completo in fondo alla pagina. La sezione "Chi ha reagito" elenca le cantine filtrate per reazione (`GET /api/wine-project/contacts?engagement=opened|clicked|landing|form|demo|interested|replied|unsubscribed|excluded|silent|all`); lo stesso filtro esiste in `/contacts` ("Email: qualsiasi reazione", client-side su `email_open_count` / `email_click_count`)
- **Wine Project — gli interruttori si salvano da soli**: «Sequenza attiva» e «Invio email reali» in cima a `/impostazioni/wine-project` scrivono subito (`PATCH /api/wine-project/automation` con `enabled` / `campaign_send_enabled`), con stato ottimistico e rollback se la scrittura fallisce. Prima vivevano nello stato del browser fino al pulsante «Salva automazione» in fondo a una pagina lunghissima: spegnere l'invio reale e uscire non spegneva niente, e al rientro la pagina rileggeva il database e mostrava l'interruttore di nuovo acceso — sembrava che si riaccendesse da solo, mentre non era mai stato spento. Il PATCH riparte sempre dalle impostazioni lette dal database, così non porta con sé i testi non ancora salvati; la risposta ri-applica in pagina solo i due booleani, per non sovrascrivere una sequenza in corso di modifica. Il pulsante in fondo resta per cadenza, tetti e riferimenti Acumbamail
- **Wine Project — demo pronta: email alla cantina e notifica subito**: `wine_demo_contact` su `/api/speaqi/leads` scriveva contatto, activity e task chiamata e finiva lì — nessuna email alla cantina e nessun avviso a chi doveva richiamarla. `deliverWineDemo` manda l'email col link (`sendContactEmail`, quindi `email_logs` + activity + coda WhatsApp arrivano gratis) e registra l'evento immediato `wine_demo_ready`. Le due cose sono indipendenti apposta: la notifica parte **anche** quando l'email non parte (Gmail scollegato, `demo_project_url` assente), perché è proprio il caso in cui serve intervenire a mano — e il messaggio dice quale dei due è successo. Nulla di tutto questo può far fallire la rotta: contatto e task sono già scritti. Interruttore: `WINE_DEMO_EMAIL_ENABLED=false`
- **Acumbamail: un 429 è una richiesta di aspettare, non un errore**: `src/lib/server/acumbamail-http.ts` è l'unico punto da cui il CRM parla con Acumbamail. Coda **per endpoint** (il tetto è per endpoint, `policy: 10/m`) più attesa sul `retry_after_seconds` e ritentativo. Prima i due client chiamavano `fetch` direttamente: il 13/09/2026 una raffica di `addMergeTag` ha lasciato a terra 46 email della sequenza, senza secondo tentativo. Gli invii caduti per un motivo temporaneo rientrano in coda da `reviveFailedWineProjectFollowups` (dentro `/api/automation/wine-project-followups`), al massimo `WINE_MAX_DELIVERY_RETRIES` volte: `failed` non è più uno stato terminale, ma un errore permanente non gira in eterno
- **Fallimento isolato, ovunque**: un gruppo di invio che fallisce non ferma gli altri (`wine-project-campaigns`), una campagna che non si sincronizza non ferma le altre (`wine-project-engagement`, che avanza comunque `last_synced_at` perché una campagna rotta non affami la rotazione), un contatto che non si sincronizza non ferma il giro (`wine-project-replies`, che ora **riporta** l'errore invece di ingoiarlo con un `catch {}`). Nel pianificatore un passo fallito non ferma i successivi: la catena Wine è seriale, e quando girava su n8n un 500 su `wine-project-engagement` teneva fermo `wine-project-replies` — per due settimane nessuna risposta delle cantine è stata letta
- **Supabase che non risponde**: sul piano Free il REST restituisce 504 a intermittenza anche su una select da una riga, e ogni volta un cron saltava il giro. `withSupabaseRetry` (in `src/lib/server/supabase.ts`) ritenta **solo** i transitori — un permesso negato o una colonna assente escono al primo colpo — ed è applicato dove il 504 mordeva davvero: impostazioni WhatsApp, riepilogo, letture d'apertura del reply monitor
- **Wine Project — stop su risposta**: il blocco della sequenza si cerca sull'**indirizzo**, non sulla singola scheda contatto (`wineSequenceBlockReason` in `src/lib/server/wine-project-automation.ts`). Ogni re-import della lista Acumbamail crea una scheda nuova con la stessa email: la risposta resta attaccata alla scheda vecchia e la sequenza girava su quella nuova. Il controllo guarda `gmail_messages.from_email` (non `contact_id`, e senza finestra temporale) e lo stato/disiscrizione di tutte le schede gemelle; `stopWineProjectFollowups` ferma gli eventi di tutte le schede con quell'indirizzo. La sincronizzazione delle risposte (`POST /api/automation/wine-project-replies`) copre solo i contatti dentro la sequenza, dal meno recentemente sincronizzato: il bacino è di migliaia di cantine e un `limit` senza ordinamento ripescava sempre le stesse cento
- **Wine Project — la storia di ogni cantina, non solo il conteggio**: la tabella di "Chi ha reagito" mostra per riga l'ultima email della sequenza uscita (numero + data e ora), il percorso datato — invii, prima apertura, primo click, arrivo sulla landing, form compilato, demo pronta, risposta, disiscrizione — e il prossimo passo (email programmata, "Da chiamare", o il motivo per cui e' fuori dal giro). "Ha cliccato" da solo non dice se poi e' successo qualcosa. I riquadri statistici in cima sono pulsanti: aprono la lista sul gruppo corrispondente (`openEngagement`), perche' un numero che non si puo' aprire non e' lavorabile. Due gruppi nuovi rispondono a "chi e' uscito": **Disiscritte** (`email_unsubscribed_at`) ed **Escluse dalla sequenza**, che riusa gli stessi tre motivi di `wineSequenceBlockReason` (disiscritta, trattativa chiusa, ha gia' risposto) — la risposta si cerca anche per indirizzo, cosi' le schede gemelle da re-import non risultano ancora arruolabili. Le date arrivano da `activities` (`wine_followup_sent`, `email_open`, `email_click`, `landing_clicked`, `demo_form_submitted`, `demo_ready`, `reply_interested`), da `wine_project_followup_events` (sequenza inviata/programmata) e da `gmail_messages` inbound
- **Wine master message** (`email_wine_core_message`): the single concept behind every email to a cantina — "raccontate la cantina una volta, Speaqi la fa parlare con il mondo". Injected by `buildEmailSegmentGuidance` for both cold and high-interest wine contacts; QR, traduzioni, video e AI Concierge non sono mai il prodotto
- `validateGeneratedDraft` (`src/lib/server/email-draft-context.ts`) runs the institutional checks (blocking) plus the Wine guardrails (correction pass only) on every generated draft
- **Wine email models**: reference emails injected by `buildEmailSegmentGuidance` for wine contacts as a structure/rhythm/CTA model, never as text to copy. Editable in `/impostazioni/email-ai` ("Modelli email — Speaqi Wine", stored in `user_settings.email_wine_templates`); the defaults live in `src/lib/email-wine-templates.ts` — A "Esempio gratuito" (preferred), B "Novità dal progetto", C "Partiamo da una bottiglia", D "Prova sociale". Text format: one `### ID | Etichetta` block per model with optional `Quando:` / `Oggetto:` lines then the body; models can be added, renamed or removed without code changes (empty or unparseable text falls back to the code defaults). `pickWineEmailTemplate` rotates deterministically by contact id — the **first model in the list** is the preferred one and weighs 2× — so one list doesn't get identical emails; the chosen variant is stored in `email_drafts.wine_template` and shown/switchable in `/email` (regenerating with `wine_template: '<ID>'`). The models reference a previous email, so the guidance drops that opening when the contact has no previous contact (`followupMode` / high-interest)
- **Open tracking (MailSuite) requires sending from Gmail**: browser extensions inject their pixel in the Gmail compose window, so a CRM API send is never tracked. The tracked path is: "📥 Prepara tutte in Gmail" in `/email` (`POST /api/automation/prepare-gmail-drafts`, one Gmail token/signature for the whole batch, 25 drafts per call, skips drafts already in Gmail unless `include_existing`) → "Apri in Gmail ↗" per draft (`email_drafts.gmail_draft_message_id` builds `mail.google.com/mail/u/<account>/#drafts?compose=<id>`) → send by hand from Gmail → reconciliation closes the draft in the CRM
- **Sent-from-Gmail reconciliation** (`src/lib/server/draft-reconcile.ts`, `POST /api/automation/reconcile-drafts`): a draft saved to Gmail ("Salva in bozza") and then sent by hand from Gmail used to stay `pending` forever. The reconciler compares pending drafts with the account's sent mail — a message to that contact after the draft's `created_at` closes the draft as `sent` with `sent_via = 'gmail'` and `provider_message_id` = the Gmail message (unique index: one message can never close two drafts), copying the subject/body actually sent, then delegates activity + follow-up to `syncContactGmailMessages`. Runs automatically when `/email` loads, on the "Controlla invii Gmail" button, and every 30 min from the `replies` job. `email_drafts.sent_via` records the path: `crm` / `automation` / `gmail`

## WhatsApp Notifications (OpenWA)

Il CRM riporta su WhatsApp cosa succede alle email. Ponte: [OpenWA](https://github.com/rmyndharis/OpenWA),
gateway self-hosted che pilota un numero WhatsApp vero via REST — **non** l'API
ufficiale Meta, quindi numero dedicato e solo traffico interno: mai outreach.
Guida operativa e deploy Railway in `docs/WHATSAPP-OPENWA.md`.

- **Due velocità, per una ragione precisa**: risposte email e demo Wine pronte
  escono subito (sono poche e chiedono una mano umana entro pochi minuti: a
  cui replicare la prima, da richiamare la seconda), invii/aperture/click/
  disiscrizioni confluiscono in un riepilogo. Su una lista da migliaia di
  cantine un messaggio per apertura riempirebbe il telefono e farebbe segnalare
  il numero come bot.
- **Agganci**: `sendContactEmail` (invii CRM e automazioni),
  `handleOutboundSyncedMessages` (inviate a mano da Gmail),
  `handleInboundReplies` (risposte), `applyEventToContact` del webhook
  Acumbamail (aperture, click, disiscrizioni), più i due invii di campagna via
  Acumbamail (`/api/automation/commercial-outreach` e `-wine-project-campaigns`).
  Le due finestre di 72 h nel sync Gmail evitano che il primo sync di un
  contatto notifichi email di mesi fa. Le aperture e i click delle campagne
  Wine entrano da due strade che convivono: il webhook della lista Acumbamail
  (agganciato alla creazione della lista da `attachWebhookToWineList`) e, come
  rete di sicurezza, `/api/automation/wine-project-engagement`, che notifica
  **solo l'incremento** del contatore — rileggendo gli stessi apritori a ogni
  giro, notificare sul valore assoluto rimanderebbe la stessa apertura ogni
  mezz'ora.
- **Un invio di massa è un fatto solo con una quantità**: le campagne registrano
  una riga per batch con `quantity` = destinatari, non una riga per
  destinatario — centoventi insert a ogni giro del cron per dire una cosa sola.
  `buildDigestMessage` **somma** `quantity`, non conta le righe, e ripartisce
  gli invii per provenienza solo quando ce n'è più di una (altrimenti
  ripeterebbe il totale). L'etichetta porta **anche lo step della sequenza**
  (`Wine Project — Vinitaly · Email 1/5: 98`): due email della stessa campagna
  partite nella stessa mezz'ora sono due fatti distinti, e un totale unico non
  dice quale passo è avanzato.
- **La coda è la garanzia**: `recordWhatsappEvent` scrive su
  `whatsapp_notification_events` e non lancia mai — il gateway è un servizio
  esterno e un invio email non deve fallire per colpa sua. `notified_at` si
  valorizza solo dopo un invio riuscito, quindi un gateway spento non perde
  eventi, li rimanda. Con gateway non configurato o kill switch spento non si
  registra nulla: altrimenti al primo collegamento arriverebbe un riepilogo di
  settimane.
- **Numero e interruttore stanno nel CRM**, non nelle env
  (`whatsapp_notification_settings`, pagina `/impostazioni/whatsapp`): cambiare
  numero non deve voler dire aprire Railway e riavviare. Nelle env restano le
  credenziali del gateway, `WHATSAPP_NOTIFY_TO` come valore di partenza al primo
  avvio e `WHATSAPP_NOTIFY_ENABLED=false` come freno di emergenza che vince su
  tutto. `loadWhatsappSettings` mette in cache 30 s per workspace: sta sul
  percorso di ogni invio email e non deve costargli una query.
- **Un numero italiano senza prefisso prende il +39** (`normalizeChatId`):
  scritto come lo si scrive di solito finirebbe altrimenti su un destinatario
  inesistente, e WhatsApp non segnala l'errore.
- **L'agente nel messaggio** è il `responsible` del contatto (o
  `assigned_agent`), lo stesso campo delle analytics di `/attivita`. Oggi c'è un
  solo destinatario; la coda porta già il nome dell'agente, quindi instradare
  per agente è un'aggiunta, non una riscrittura.
- **Telegram vince su OpenWA** (`notificationChannel` in `whatsapp.ts`): con
  `TELEGRAM_BOT_TOKEN` + `TELEGRAM_NOTIFY_CHAT_ID` coda, risposte immediate e
  riepilogo escono sul bot Telegram, e il numero salvato nel CRM non serve. Il
  motivo è il costo: OpenWA tiene acceso un Chromium da ~1 GB (≈10 $/mese su
  Railway) per restare agganciato a WhatsApp Web, e quando la sessione cade
  tace finché qualcuno non riscansiona il QR — a ottobre 2026 era scollegato e
  generava un QR ogni 20 secondi. Telegram è un'API ufficiale: una notifica è
  una chiamata HTTPS. Il grassetto WhatsApp (`*testo*`) diventa HTML
  (`toTelegramHtml`); se Telegram rifiuta la formattazione si rimanda in testo
  semplice invece di perdere il messaggio. Tabelle e nomi restano `whatsapp_*`:
  rinominarli non comprava niente.
- **Superfici**: `POST /api/automation/whatsapp-digest` (job `notifications-digest`), `GET|POST /api/whatsapp/status` (stato, messaggio di
  prova, riepilogo forzato) e la pagina `/impostazioni/whatsapp`.

## Voice Commands

- Voice FAB on dashboard for quick access to `/voice`
- `POST /api/voice/command` — process voice commands via OpenAI (pipeline: solo `schedule_followup` su un contatto)
- `POST /api/ai/transcribe` — trascrizione di un vocale dal browser; la logica vive in `src/lib/server/transcribe.ts` ed è condivisa con il bot Telegram
- **Telegram → To Do**: `POST /api/integrations/telegram/webhook` (registrazione con `POST /api/integrations/telegram/setup`, protetta da `AUTOMATION_SECRET`). Scrive solo attività standalone, mai sulla pipeline: per i contatti resta `/voice`, che ha la ricerca della scheda giusta

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
| `/vendita/<token>` | Area del commerciale senza login (link personale): dati del cliente → firma e pagamento |
| `/diventa-commerciale` | Redirect permanente a guides.speaqi.com/diventa-commerciale (la pagina vive lì) |
| `/api/programma-commerciali` | Provvigioni e prodotto letti da quella pagina |
| `/api/candidature-commerciali` | Candidature inoltrate dal server di Guides |
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

## Automazioni pianificate (ex n8n)

Fino a ottobre 2026 le lanciava n8n, un servizio a parte (~5 $/mese più il suo Postgres) i cui workflow chiamavano soltanto, a orario, gli endpoint `/api/automation/*`. Ora le lancia il CRM stesso: `src/instrumentation.ts` avvia `startAutomationScheduler()` (`src/lib/server/automation-scheduler.ts`) quando `AUTOMATION_SCHEDULER_ENABLED=true`, e ogni minuto chiama gli endpoint dovuti su `127.0.0.1:$PORT` con `AUTOMATION_SECRET`. Stesse rotte, stessa autenticazione di prima.

- **Orari e parametri** stanno in `AUTOMATION_JOBS` (`src/lib/automation-schedule.ts`, puro e coperto da test): aggiungere un'automazione è aggiungere una riga. Fuso `AUTOMATION_TIMEZONE` (Europe/Rome): "alle 8" sono le 8 italiane anche dopo il cambio dell'ora. Sono gli orari e i corpi dei workflow attivi in produzione, letti dai log delle chiamate: follow-up ogni 10 min; `replies` (reply-monitor + reconcile-drafts), `wine-project` (followups → campaigns → engagement → replies) e `commercial-outreach` (`dry_run`) ogni 30; riepilogo notifiche a :05/:35 dalle 7 alle 21; manutenzione ogni ora; `reconcile-sends` a :20; backup alle 3; punteggio lead alle 6; qualificazione Acumbamail alle 7; recap il lunedì alle 7:30; orchestratore alle 8 nei feriali; lead fermi alle 9; invii holding alle 9 nei feriali (`dry_run`).
- **Una corsa per minuto, con qualunque numero di repliche**: prima di partire il job inserisce `(job, slot)` in `automation_job_runs`; la chiave primaria fa vincere una replica sola. Con il database irraggiungibile il giro si salta: due backup o due invii costano più di un giro perso. Senza la tabella (migration non applicata) si corre senza prenotazione.
- **Un passo fallito non ferma i successivi**. L'errore resta nella riga della corsa e arriva via email (`/api/automation/error-alert`, l'avviso che mandava n8n), al massimo una volta ogni sei ore per job. Un job ancora in corso salta il turno invece di accavallarsi.
- **Storico**: `select * from automation_job_runs order by slot desc` è l'ex pagina "Executions" di n8n.
- **Il webhook lead di n8n** (`/webhook/speaqi-lead` → `/api/speaqi/leads`) non lo chiamava nessuno: chi deve mandare lead li manda direttamente a `/api/speaqi/leads`.

**Backup**: the Supabase Free plan has no daily backups and no PITR. `POST /api/automation/backup` (logic in `src/lib/server/backup.ts`) dumps every table in `BACKUP_TABLES`, gzips it and uploads it to the private `backups` Storage bucket. The Resend email copy is attached only under 8 MB: the dump is now ~14 MB, so it is skipped (`skipped_too_large`). The off-Supabase copy is the **R2 upload** (`src/lib/server/r2.ts`, SigV4 by hand, no SDK; result field `r2`): without the `R2_BACKUP_*` variables it is `not_configured` and the only copy lives inside Supabase — keep a local one with `npm run backup`. `BACKUP_TABLES` lists what is saved (everything that cannot be regenerated: contacts, Tourism Intelligence, shipping, fairs, drafts, campaigns); `tourism_revisions` (36 MB of history) and `gmail_accounts` (secrets) are left out on purpose. Paginates at 1000 rows (PostgREST truncates there), aborts if `contacts` fails, and only prunes old backups after an intact run. `send_email: false` in the body verifies dump + Storage without sending. Local equivalent: `npm run backup`.

All automation endpoints require `AUTOMATION_SECRET` (including `/api/email/reminder`): the scheduler only decides *when*, the logic lives in `/api/automation/*`.

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
| `scripts/import_shipping_companies.ts` | Catalogo compagnie di navigazione (`scripts/data/shipping-companies.json`) → `shipping_companies` + contatti holding (`npm run shipping:import`, dry-run di default) |
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
- **Da dove arrivano i contatti**: due strade che convivono. (1) `/import` con
  **Tag evento** uguale all'`event_tag` della campagna: i contatti entrano nel
  CRM e il motore li pesca da li. (2) `acumbamail_list_id` sulla campagna: l'id
  di una lista **gia esistente** su Acumbamail, che il motore rilegge a ogni
  giro. Il CRM le liste Acumbamail le legge, non le crea.
- **Idoneita al marketing**: `applyEnrollableContactFilter()` e la definizione
  unica di "contatto arruolabile" — la usano sia il motore sia la scheda, cosi
  la pagina non puo mostrare un bacino che il motore non riconosce. L'import CSV
  **non** imposta `marketing_eligibility`, quindi i contatti nascono `review` e
  non vengono arruolati: la scheda mostra *col tag / arruolabili / da abilitare*
  e `POST /api/commercial/campaigns/[id]/audience` fa il passaggio a `eligible`
  su richiesta esplicita, scrivendo il motivo sul contatto. Non tocca mai chi e
  `excluded` o `suppressed`.
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
  `campaign_id` o `vertical` per limitare il giro. Job `commercial-outreach` (ogni 30 min, `dry_run: true`).

### Test

Nessuna dipendenza di test oltre `tsx`: si usa `node:test`.

```bash
npm run test:unit   # pianificatore automazioni, motore campagne, Wine Project, WhatsApp, lavagna To Do, Telegram, abbonamenti/firma/link vendita, programma commerciali, Da incassare, compagnie di navigazione, itinerari e mappa rotte
npm run test:db     # integrazione e concorrenza su un Postgres locale usa-e-getta
npm run test:postgrest # Navigazione su Postgres + PostgREST veri dopo il passaggio dei porti in tourism_hubs (scarica PostgREST la prima volta)
npm test            # entrambi
```

`tests/db.sh` crea il cluster (`initdb`), applica `tests/sql/fixture.sql` e le
migration `commercial_*`. `tests/db.sh stop` lo spegne.

## Ufficio Speaqi — base comune (Prompt 0)

- `/ufficio` e le API `/api/office/*` sono solo del titolare (`SUPER_ADMIN_PATHS`,
  `requireWorkspaceOwner`). Sidebar **Solo admin**, riepilogo **Ufficio** in prima
  pagina; le uscite `pending` entrano anche in **Aspetta te** (`buildWaiting`).
- Migration **`20261022160000_office_agents.sql`**, da applicare **prima del codice**.
  Tabelle: `office_agents` (registro, impostazioni e tre budget in centesimi EUR),
  `office_agent_runs` (corse, esiti, log e costi), `office_agent_outputs` (bozze e
  proposte da decidere), `office_budget_ledger` (riserve e consumi). RLS di lettura
  per `auth.uid() = user_id`; scritture tramite le API autorizzate/service role.
  Gli slug degli agenti sono identificatori unici del registro; ogni riga ha
  comunque un proprietario, verificato anche sui legami fra tabelle.
- `runAgent` (`src/lib/server/office-agents.ts`) prende un lock sull'agente tramite
  `claim_office_agent_run`: una sola corsa, deduplica sulla chiave di idempotenza.
  Dopo 30 minuti una corsa si considera interrotta; il vecchio processo non puo'
  prenotare o aggiungere uscite. Le sue riserve non vengono liberate alla cieca.
  Errori del compito -> `failed`; budget finito -> `skipped_budget`, oppure
  `partial` se ha gia' preparato uscite. Senza database ci si ferma.
- `reserve_agent_budget` controlla **speso + ancora prenotato** contro **tutti** i
  tetti (giorno, settimana da lunedi', mese, fuso fisso `Europe/Rome`). Zero blocca
  la spesa. Lock e inserimento sono nella stessa transazione; gli aggregati non
  passano da una lista REST soggetta al limite di 1000 righe. La RPC richiede anche
  `p_run_id` per attribuire la riserva a una corsa attiva dello stesso agente.
  `settle_agent_budget` sostituisce la riserva col costo reale; ripetere lo stesso
  saldo e' innocuo, cambiarlo dopo il saldo e' rifiutato. RPC solo `service_role`,
  `search_path` fisso e nessun privilegio per `anon`/`authenticated`.
- `callModel` usa la stessa API OpenAI Responses e `OPENAI_API_KEY` gia' presenti,
  solo testo e senza strumenti esterni. Prenota il massimo stimato prima della
  chiamata e salda con i token restituiti. Il listino puro `office-pricing.ts`
  comprende `gpt-5-mini` (USD 0,25 ingresso / 2 uscita per milione di token,
  verificato sul sito OpenAI il 22/10/2026). Modello sconosciuto -> stop.
  `OFFICE_USD_TO_EUR` converte in EUR (default prudente 1, non cambio live, fino a sei decimali), ogni
  chiamata arrotondata al centesimo superiore; cache prenotata al prezzo pieno e saldata a USD 0,025 per milione di token. Timeout,
  errore HTTP o usage assente lasciano la riserva impegnata e la corsa in errore:
  il fornitore potrebbe avere gia' fatturato. Da riconciliare manualmente prima
  di liberarla; nessun ritentativo automatico di chiamate dall'esito incerto.
- Il contesto del compito espone solo `reserve`, `settle`, `addOutput`, `log` e
  metadati: nessun invio email, social, fattura o pubblicazione di mappe.
  `addOutput` scrive solo nella coda `pending`, con chiave unica per corsa.
  Approvare/rifiutare aggiorna solo la decisione e la data. Non pubblica, non
  invia e non modifica il record indicato da `target_table`/`target_id`.
- API titolare: `GET /api/office` (spesa reale e riservata, ultima corsa per agente,
  ultime 30 corse, coda paginata con `offset`, 50 uscite per pagina),
  `PATCH /api/office/agents/[id]` (interruttore, budget, settings),
  `POST /api/office/agents/[id]/run-now` (header `Idempotency-Key`, una chiave per
  clic), `PATCH /api/office/outputs/[id]` (`approved`/`rejected`, solo da `pending`).
  Se una pagina della coda si svuota dopo le decisioni, il GET restituisce una
  lista vuota e il conteggio aggiornato; la pagina torna indietro. Il messaggio
  della corsa conserva il riepilogo reale oppure segnala il turno saltato.
- API macchina: `POST /api/automation/agents/[id]/run`, con `AUTOMATION_SECRET`;
  workspace solo da `AUTOMATION_WORKSPACE_USER_ID`, mai dal corpo. Chiave di
  idempotenza dall'header oppure dal minuto UTC del pianificatore.
- Al termine del Prompt 0 il registro `src/lib/server/office-agents/registry.ts`
  era vuoto. I prompt successivi aggiungono soltanto gli handler documentati nelle
  sezioni seguenti, senza accenderli. Gli agenti
  futuri nascono `enabled=false`; installarli richiede un handler nel registro,
  una riga di configurazione e una riga in `AUTOMATION_JOBS` col percorso di run.
- Tenuta corse **90 giorni**: job `office-maintenance` alle 03:15 italiane,
  `POST /api/automation/office-maintenance`. Uscite ancora da decidere e ledger
  si conservano, col legame alla corsa eliminata messo a null. Come gli altri job
  parte solo col pianificatore acceso; se `AUTOMATION_SCHEDULER_JOBS` e' una lista,
  aggiungervi anche questo job. Nessuna chiamata alle mappe di Napoli.
- Test: `tests/office.unit.test.ts` in `test:unit`; `tests/office.db.test.ts` in
  `test:db`, Postgres vero con `tests/db.sh`, database separato `office_test`.
  Le suite DB sono seriali per non far partire due cluster insieme. Il runner
  supporta Linux e Postgres.app su Mac, propaga gli errori SQL e non cancella
  directory. `PGDIR`, `PGPORT`, `PGHOST`, `PGBIN` sono configurabili.

`npm run test:office:ui` verifica la pagina buildata con API simulate (desktop e telefono);
`OFFICE_TEST_URL`, `OFFICE_TEST_OUTPUT` e `CHROMIUM_PATH` scelgono server, screenshot e browser.
Le quattro tabelle dell’ufficio sono incluse nel backup server e nello script locale.

### Agente 11 — Finanza

- Handler `office-agents/finance.ts`, regole pure in `lib/office/finance.ts`.
  Job `office-finance` ogni giorno alle 08:30 nel fuso del pianificatore.
- Registrazione idempotente da `OFFICE_AGENT_DEFINITIONS`, soltanto per
  `AUTOMATION_WORKSPACE_USER_ID`, quando il titolare apre `/ufficio` o si chiama
  una corsa. Nasce **spento**, budget 20 cent/giorno, 140/settimana, 620/mese;
  leggere il registro non riscrive mai interruttori o budget già salvati.
- Prepara le fatture dei preventivi pagati con `createInvoiceDraftFromQuote`,
  elenca problemi con `invoiceProblems`, propone dati fiscali già presenti
  nel contatto e spiega gli esiti SDI registrati. Non prenota numeri e non chiama
  upload, autenticazione o sincronizzazione Aruba.
- Solleciti per `past_due` e bonifici accettati non pagati oltre 15 giorni:
  solo righe `email_drafts` in attesa. Migration additiva
  `20261022170450_office_finance.sql`: `office_agent_id`, `office_key`,
  `office_note` e RPC `create_office_email_draft` riservata al service role.
  Il lock sul contatto e la chiave persistente evitano doppioni; una bozza già
  in attesa blocca una seconda bozza. Il vincolo impone `source='office'`,
  incompatibile con il motore automatico che accetta solo `source='auto'`.
  La nota del motivo è visibile in `/email` e il sollecito in «Aspetta te».
- Report giornaliero con fonti e proposte; il primo giorno italiano del mese,
  report del mese precedente con importi IVA compresa in centesimi, scostamento
  fra incassato registrato e fatturato e rinnovi previsti nel mese corrente.
  I rinnovi Stripe usano la data di registrazione della bozza: il limite è
  dichiarato nel report, insieme agli id delle fonti. Non è una riconciliazione
  bancaria e non stima ricavi per utente/contatto o MRR da dati incompleti.
- Nessuna chiamata a un modello è necessaria: il budget resta disponibile.
  Nessuna nuova env. Le migration si consegnano, non si applicano a DB operativi.
- Test: `office-finance.unit.test.ts` (mese nel fuso italiano, fonti, esclusioni,
  bozze/report idempotenti, nessuna rete Aruba), `office-finance.db.test.ts`
  (migration e RPC su database PGlite usa-e-getta, vincoli e permessi).

### Agente 10 — Commerciale

- `sales_followup`, reparto Commerciale, feriali alle 08:00 Europe/Rome
  (`office-sales-followup`), nasce spento. Budget iniziali 100/700/3100 centesimi
  giorno/settimana/mese; nessuna nuova env. Usa il modello configurato nel registro.
- `src/lib/office/sales-followup.ts` sceglie i contatti CRM: follow-up di oggi o
  scaduti (task/prossimo passo/SLA), preventivi inviati da oltre 5 giorni senza
  firma, firme vere da `quote_signatures` da oltre 3 giorni senza pagamento,
  rinnovi annuali nei prossimi 30 giorni e trattative aperte ferme da oltre 14.
  Rinnovi inclusi anche per clienti Paid. Ordine per valore, massimo 15 al giorno.
  Holding, nascosti, disiscritti, email mancanti, risposte successive all'ultima
  uscita e bozze pendenti sono esclusi; email normalizzate per le schede duplicate.
- Il server riusa `createEmailDraftRecord` e i suoi controlli esistenti. I dati
  arrivano dal solo set CRM con query per id e pagine. La chiamata al modello
  passa da `callModel` (prenota prima e salda dai token); la ricerca pubblica
  opzionale del generatore viene saltata per evitare chiamate fuori budget.
  Numeri e link senza riscontro vengono rifiutati; HTML ricostruito dal testo
  escapato. La nota spiega il motivo e le fonti; la bozza compare in `/email` e
  come uscita in Aspetta te. Solo `source=office`, stato `pending`, nessun invio.
- Migration `20261022175856_office_sales_followup.sql`, dopo Finanza, da applicare
  prima del codice. `office_agent_daily_quotas` conserva la quota anche dopo
  invio/eliminazione di una bozza. La RPC delle bozze serializza per agente e
  indirizzo, controlla di nuovo risposte Gmail, scope, proprietario e bozza già
  pendente prima di creare. Il contatore cresce solo su una nuova bozza.
  RLS di lettura del proprietario, scritture service role; tabella nei backup.
- Test: selezione, esclusioni, finestre, valore, duplicati, numeri, budget prima
  del modello e pipeline esistente in `office-sales.unit.test.ts`; quota e
  idempotenza concorrenti, risposte e permessi su Postgres vero in
  `office-sales.db.test.ts`. Nessun consumo OpenAI reale, Gmail o invio esterno.
