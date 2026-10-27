# CLAUDE.md — Speaqi CRM

## Ufficio — registro persistente approvato (#78)

- `OFFICE_WORKER_ENABLED=true` passa ordini, avvii e deleghe al registro dei lavori; il valore predefinito è spento. Il job `office-work` usa il pianificatore esistente ogni minuto. Non aggiungere un secondo consumatore delle code.
- La migration additiva `20261025172333_office_persistent_work.sql` deve precedere l'attivazione. In assenza di schema gli ordini restano salvati e riprendibili; il worker segnala il blocco. Nessun fallback all'esecuzione volatile in questa modalità.
- Claim, lease, dipendenze, tentativi, revisioni, ricevute ed eventi sopravvivono ai riavvii. Un effetto o una spesa incerti richiedono riconciliazione; non liberare riserve o ritentare alla cieca. Stato della corsa e risultato del lavoro sono distinti.
- Primo percorso: ordine Tourism → verifica puntuale con fonti → clic del titolare → presentazione valida. La proposta non verifica l'ente prima del clic; preparare il deck non lo approva e non invia email. Napoli resta protetta.
- **Primo giorno in produzione (26/10)**:
  - **Telegram riceve solo ciò che serve** (`officeWorkNotice` in `src/lib/office-work.ts`): esiti, blocchi da risolvere e decisioni. Il blocco di una domanda chiude con «Rispondimi qui». Non partono «pronto», «in esecuzione», «in attesa», i blocchi già superati o dovuti al lavoro precedente fallito, né «ordine compreso» quando l'esito arriva dai lavori assegnati. Questi avvisi restano nello storico come `failed` con `SKIPPED_NOTICE`: la migration non ha uno stato «saltato». Dopo «Ricevuto, ci lavoro» non parte più «Ordine salvato…».
  - **Ente già verificato**: un ente con prove proprie e una destinazione legata da una prova verificata (`verifiedPresentationSource`) passa diretto alla presentazione, senza rileggere il sito. Per questi enti la città non si chiede mai: vale il nome della destinazione legata (prima si calcolava dal nome dell'ente e, se non ne usciva una — «Costa dei Borghi» —, il Direttore chiedeva «Per quale città…?» anche se la destinazione c'era già). Un'etichetta VERIFIED senza prove proprie si verifica come prima.
  - **Ordine con il solo nome di un paese** («presentazione per Venezuela»): non crea un ente nuovo (`isCountryName`). Usa l'ente nazionale del turismo (`nto`/`ministry`) se ce n'è uno solo, altrimenti chiede quale.
  - **Presentazione fallita richiesta con un ordine**: si rifà una volta per versione (`checkpoint.regenerated`, `generateIntoDeck` con `onlyIfUnchanged`). Il compito torna `ready` e il PDF va su Telegram. Una seconda volta il lavoro si ferma con il motivo (`presentation_failed`), senza rigenerare.
  - **Risposte alle domande del Direttore**: «lascia perdere il sito, fammi la presentazione» riprende l'ordine com'era (`SKIP_SITE`). Se non c'è un lavoro da correggere, la richiesta completa si lavora nel nuovo ordine e i lavori fermi di quello vecchio si annullano.
  - **Ricerca web del sito**: ha 1200 token invece di 300. Una risposta interrotta vale «nessun sito trovato» e non è un guasto.
- Le istruzioni storiche sugli avvii in memoria qui sotto descrivono il percorso precedente, valido soltanto con il flag spento e prima del passaggio. Dopo la migrazione non tornare a consumare le stesse vecchie code.
- Per ambito, collaudo e rilascio leggere `docs/AI-SYSTEM-AUDIT.md`, `docs/UFFICIO-TEST-REPORT.md`, `docs/UFFICIO-OPERATING-GUIDE.md` e `docs/UFFICIO-RELEASE-2026-10-25.md`. La migration è applicata in produzione; attivazione del worker e verifica del deploy restano distinte.

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
| `OPENAI_API_KEY` | OpenAI API key (oggi: funzioni AI del CRM fuori dall'Ufficio e trascrizione dei vocali) |
| `OPENROUTER_API_KEY` / `OPENROUTER_API_KEY_OFFICE` | OpenRouter per gli agenti dell'Ufficio (`callModel`). La seconda, facoltativa, separa i consumi dell'Ufficio; senza nessuna delle due gli agenti che scrivono col modello si fermano col motivo |
| `OPENAI_MODEL` | Model ID (e.g. `gpt-5-mini`) |
| `OPENAI_AGENCY_MODEL` | Modello dell'agente Speaqi Agency (analisi del brief, presentazioni, revisioni). Default `gpt-5.1`, indipendente da `OPENAI_MODEL`: con `gpt-5-mini` i titoli tornavano etichette d'argomento. Deve leggere immagini e PDF |
| `AGENCY_RENDER_SECRET` | Segreto della chiave con cui Chromium stampa in PDF una proposta Agency non ancora approvata. Senza, si usa `SUPABASE_SERVICE_ROLE_KEY`; senza nessuno dei due il PDF di una bozza non si genera (quello di una approvata sì) |
| `OPENAI_TOURISM_DECK_MODEL` | Modello dell'agente che personalizza le presentazioni per destinazione (default `OPENAI_MODEL`, poi `gpt-5-mini`). Deve leggere immagini e PDF |
| `APP_BASE_URL` | Base URL pubblico del CRM (e.g. `https://crm.speaqi.com`) |
| `UFFICIO_PASSWORD` | Password dell'Ufficio (`/ufficio`, `/ufficio/agenti` e tutte le API `/api/office` e `/api/ufficio/scena`), sopra il login del titolare. Vuota = Ufficio aperto come prima. Si cambia solo da Railway: cambiarla chiude fuori tutti i browser. Non va mai scritta nel codice né in chat |
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
| `deals` | Trattative/opportunità per contact: `pipeline` vendite/tourism/distribuzione/agency, al massimo una aperta per (contatto, pipeline); responsabile (`owner`), prossimo passo con scadenza, prove, `signed_at` ≠ `activated_at` |
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
| `trade_fair_exhibitors` | Espositori di una fiera (scheda «Fiere» di Tourism Intelligence, oggi TTG 2026): punteggio 0-100 e motivi, priorità, stato (`new`→`contacted`→`replied`→`interested`→`meeting`, `not_interested`), `next_followup_at`, registro `notes` jsonb, `contact_id` opzionale. Unico per `(user_id, fair, slug)` |
| `receivables` | Soldi da ricevere, personali e fuori da Speaqi (sezione «Da incassare» di `/fatture`): nome, cifra, `collected_at` (null = da incassare). Riga di chi l'ha scritta (`auth.uid()`), non del workspace |
| `commercial_campaigns` | Motore campagne generico: un verticale = una riga (`slug`, `event_tag`, mittente, `landing_url`, filtri import, tetti) |
| `commercial_campaign_steps` | Fino a 20 email per campagna; uno step gia inviato e immutabile (trigger) |
| `commercial_enrollments` | Un contatto in sequenza per campagna |
| `commercial_messages` | Un messaggio programmato/inviato per step |
| `commercial_suppressions` | Disiscrizioni, reclami e blacklist (per struttura o per email) |
| `commercial_campaign_daily_counters` | Contatore giornaliero per campagna dietro il tetto arruolamenti atomico |
| `office_director_orders` | Un ordine al Direttore (dal CRM o da Telegram): testo, foto nel bucket privato `office-director`, intenzione capita, risposta, proposte create e code passate agli agenti |
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
│   │   ├── incassi/            # Redirect a /fatture#da-incassare (la sezione sta in components/incassi)
│   │   ├── scheda/[id]/        # Scheda completa del cliente (solo titolare)
│   │   ├── ufficio/            # L'ufficio degli agenti in 3D (solo titolare)
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
- **Cursore operativo**: la query su `scope=crm,personal` usa l'indice parziale `(user_id, id)` `contacts_working_set_cursor_idx`, incluse le righe legacy con scope null.
- **Liste separate on demand**: `loadHoldingContacts({ search, list, limit })` interroga `/api/contacts?scope=holding&...` con ricerca lato database; la pagina `/contacts` la chiama (debounce 300 ms) solo quando la tab attiva è `holding` o `all`. `loadMoreHoldingContacts()` allarga la finestra di `HOLDING_PAGE_SIZE` (1000).
- **Conteggi**: badge sidebar, contatori tab e chip cartella arrivano da `GET /api/contacts/summary` (RPC `contact_workspace_summary`, un solo scan con RLS). Non contare mai gli scope filtrando array in memoria.
- **Un solo caricamento**: `loadAll` parte una volta per sessione e a ogni mutazione, con tutte le richieste in parallelo. L'apertura aspetta team, stage, contatti e task; badge, cartelle e To Do arrivano senza bloccarla. Il set vuoto aspetta anche la verifica dell'import legacy. Non è più legato al `pathname` — cambiare pagina non ricarica nulla (`workspace=all` non cambia il payload: il server ignora già il filtro assegnatario per l'admin).
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
- **Ufficio** (`/ufficio`, voce nel gruppo Solo admin, in `SUPER_ADMIN_PATHS`): gli agenti Speaqi in 3D, un **campus** su un'isola: la **sede Speaqi** in cima alla scalinata e sette padiglioni (Mappe e Sviluppo a sinistra della sede, Ricerca a destra, Commerciale/Finanza e Marketing/Operazioni ai lati della piazza), con fontana e il totem «Aspetta te» al centro. La sede è un palazzo di vetro a sei piani con la grande insegna Speaqi sul coronamento (leggibile anche da dietro, luce di segnalazione), finestre accese di sera, ascensore di vetro che sale e scende e bandiere Speaqi sul piazzale; si vede sempre, perché entra nell'inquadratura d'insieme (`HQ`, `buildHQ`). **La Direzione non è un padiglione: è l'ultimo piano della sede** (`buildDirectionFloor`), un open space vetrato con il logo sulla parete, lo schermo con le barre che si muovono e il tavolo riunioni. Lì ci sono il **CEO** (il titolare, l'unica persona che non è un agente: giacca scura sulla maglia Speaqi, cartellino «Tu · CEO», ogni tanto parla e indica) e davanti alla sua scrivania il **Direttore**, l'agente vero; il clic sulla Direzione inquadra il piano quasi in orizzontale, attraverso la vetrata. **Sviluppo** (`sviluppo` in `OFFICE_DEPARTMENTS`, cubo «</>» sul tetto) oggi non ha agenti e mostra una scrivania vuota: quando arriverà il primo agente di sviluppo, il vincolo `office_agents.department` della migration `20261022160000_office_agents.sql` va esteso a `'sviluppo'` con una migration nuova. Le persone sono gli agenti veri di `/api/office` (proiezione `officeSceneSnapshot`, `src/lib/office-scene.ts`), con la maglia Speaqi (logo intero sulla schiena, icona sul petto): **in corso** scrive al computer e manda pacchetti di luce verso «Aspetta te», **disponibile** alterna scrivania e caffè, **da verificare** è in piedi con il «!», **spento** dorme alla scrivania; sopra ogni testa c'è sempre un pallino del colore dello stato, così dalla vista d'insieme si contano. Un reparto senza agenti ha una scrivania vuota: nessuna persona inventata. **Il clic avvicina la camera, non nasconde niente**: gli altri padiglioni e le loro etichette restano (la torre di ChatGPT isolava il reparto scelto e faceva sparire il resto). Si inquadra con `fitDistance`, che misura i punti proiettati, quindi va bene in ogni formato; i padiglioni in alto si guardano passando sopra la piazza, non attraverso quelli davanti, e davanti a ogni padiglione non nascono alberi. Ogni tetto ha il suo segno che si muove (globo, parabola, cubo del codice, bandiera, moneta, megafono con i cuori, ingranaggi), più nuvole che fanno ombra, gabbiani, fontana e giorno/sera (di default l'ora di Roma). Sul prato davanti a Marketing camminano un cane e un gatto, davanti a Operazioni un unicorno con la criniera arcobaleno (`pavilionPets`, `moveCritter`). Il pavimento dei padiglioni sta 6 cm sopra il prato: alla stessa quota il verde traspariva a chiazze (z-fighting). Con «riduci movimento» del sistema la scena resta ferma. Il campus si ricostruisce solo se cambiano reparti, agenti o stati (`structureKey`), non a ogni aggiornamento dei 30 secondi. Sorgenti: `scripts/ufficio/scena.html` (pagina e pannello) e `scripts/ufficio/scene.js` (three.js incluso nel bundle, niente CDN); `node scripts/ufficio/build.mjs` (o `npm run build:office`, anche in `prebuild`) li impacchetta in `src/lib/server/ufficio-scene.ts` (generato, non si tocca a mano), `GET /api/ufficio/scena` lo serve solo al titolare e la pagina lo monta in un iframe `srcDoc` con `sandbox="allow-scripts"`. **Una pagina sola** (ottobre 2026, `OfficePanel.tsx` + `ufficio.module.css`): la scena arriva in modalità incorporata (`office:embed`: niente barra né pannello interni, campus a tutta larghezza) e a destra c'è il pannello della pagina, da cui si fa tutto senza cambiare pagina — «Scrivi al Direttore» (testo, foto, voce, risposte; `DirectorOrders compact`), poi tre schede: **Aspetta te** (proposte con «Leggi», Approva/Rifiuta, Telegram per la rassegna), **Squadra** (agenti del reparto scelto: pallino di stato come nel 3D, interruttore, «Fai girare adesso», ultima corsa ed errore, «Budget e impostazioni →») e **Piano di oggi** (`/api/opportunities/plan`). Scena e pannello si parlano: un clic su un padiglione manda `office:focus` e apre la sua squadra; scegliere il reparto dal pannello muove la camera; il totem e le schede del 3D aprono il pannello invece di cambiare pagina; Esc nella scena manda `office:escape`. **⛶ Schermo intero** mette a schermo intero scena **e** pannello (`requestFullscreen` sul contenitore; dove il browser non lo permette la stanza copre la finestra). «Aspetta te» in prima pagina porta a `/ufficio?uscita=<id>`. **Password dell'Ufficio** (`UFFICIO_PASSWORD`, `src/lib/server/office-lock.ts`): se c'è, `OfficeLockGate` (layout di `/ufficio`) chiede la password prima di montare scena e pannello, e `officeOwnerRoute` più `/api/ufficio/scena` rispondono 423 senza il cookie `speaqi_ufficio` (httpOnly, `path=/api`, 30 giorni). Il cookie è «ora di emissione.HMAC» di titolare, password e ora (scade comunque dopo 30 giorni, anche copiato) con `AGENCY_RENDER_SECRET` o `SUPABASE_SERVICE_ROLE_KEY`, mai la password; `POST|DELETE /api/ufficio/sblocca` apre e chiude («🔒 Chiudi l'Ufficio»), dieci tentativi sbagliati in un quarto d'ora fermano il titolare per quel processo. Telegram, Direttore, pianificatore e agenti non passano dalle API `/api/office` e non ne sono toccati. Test: `tests/office-lock.unit.test.ts`. `/ufficio/agenti` resta per budget, impostazioni JSON, storico delle corse e coda oltre le 50 proposte; non è più in barra laterale, come `/opportunita` (si apre da «Tutte le opportunità →» nel piano). Test: `tests/office-scene.unit.test.ts`, `npm run test:office:ui` (scena incorporata, reparto ↔ pannello, totem, schermo intero, errore e ripresa, telefono, senza WebGL)
- **Da incassare** (sezione in fondo a `/fatture`, `components/incassi/ReceivablesSection.tsx`; `/incassi` rimanda lì; `GET|POST|PATCH|DELETE /api/receivables`): prima «Da incassare sicuro», poi «Prossimi» (categoria `prospective`), poi i già incassati. Soldi personali da ricevere, che con Speaqi non c'entrano — solo nome, cifra e se è già incassato. Non tocca contatti, preventivi o finanza. Ogni riga è di chi l'ha scritta (`user_id = auth.uid()`, anche in RLS), non del workspace: un collaboratore non vede quelle del proprietario e viceversa. L'importo si scrive come viene (`parseReceivableAmount`: "1.250,50", "300 €", "12.5") e i totali si sommano in centesimi
- **Fiere** (dentro Tourism Intelligence: scheda «Fiere» in `/tourism` e filtro «Fiera» nella directory, che è il «tag»; `/fiere` rimanda a `/tourism?tab=fiere`; nessuna area a parte, solo titolare; `GET|POST|PATCH|DELETE /api/trade-fair-exhibitors`; l'elenco delle fiere è `TRADE_FAIRS` in `src/lib/trade-fair.ts`, il filtro usa `trade_fair_exhibitors.entity_id`): gli espositori di una fiera da valutare e riprendere dopo l'evento. L'elenco si importa incollando una tabella CSV/TSV (`parseExhibitorsText` in `src/lib/trade-fair.ts`, puro e coperto da test); un reimport aggiorna i dati e il punteggio ma **non** tocca stato, priorità manuale, note e follow-up. Il punteggio (`scoreExhibitor`) misura quanto un espositore somiglia a un cliente di Speaqi Maps (enti del turismo, crociere, musei, esperienze, ospitalità) ed è solo un ordinamento: la priorità scelta a mano vince. L'ordine in pagina porta prima i follow-up scaduti. Per cambiare fiera si cambia `FAIR` in `components/fiere/shared.ts` e si aggiunge la riga a `TRADE_FAIRS`
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

- Pipeline position lives on `contacts.status` (mirror cache read by dashboard/kanban/automations), but each contact has a history of `deals` — at most ONE open **per pipeline** (partial unique index `deals_one_open_per_contact_pipeline`, migration `20261024120000_opportunities.sql`). Only `pipeline = 'vendite'` mirrors the contact status; see «Opportunità» below.
- `src/lib/server/deal-ops.ts`: `syncDealWithContactStatus` keeps the open deal aligned on every status change (hooked in contacts POST/PATCH, bulk, lead-ops, Gmail reply outcome); `reopenWithNewDeal` re-enters a closed/paid contact into the pipeline with a new opportunity.
- `POST /api/deals` = "Nuova opportunità" (button in contact detail page); `GET /api/deals?contact_id=X` = history.
- Each deal has an optional `counterparty` (the entity the deal is with — a person can carry deals for different organizations).
- Quote paid → contact `Paid` + open deal closed as won; new quotes attach to the open deal via `quotes.deal_id`.

## Opportunità (`/opportunita`)

Un solo percorso per tutte le opportunità, dentro `deals` (non un secondo CRM). Solo titolare (`SUPER_ADMIN_PATHS`, `requireWorkspaceOwner`); non sta in barra laterale: il piano si vede nell'Ufficio e l'elenco completo si apre da lì; piano in `docs/UFFICIO-OPPORTUNITA.md` (fasi A e B fatte, C/D/E da fare).

- **Quattro pipeline**: `vendite` (le 1.060 trattative di sempre: fasi New→Paid, specchio di `contacts.status`, mai cambiate da qui), `tourism`, `distribuzione`, `agency` con fasi proprie (`scoperta`→`qualificata`→`proposta`→`trattativa`→`firmato`→`attivazione`→`attiva`, più `persa`/`ferma`) che **non** toccano lo stato del contatto. `deal-ops.ts`, il riquadro Vendite della prima pagina e `getOpenDeal` leggono solo `vendite`.
- **Regole in un posto** (`src/lib/opportunities.ts`, puro e testato): `opportunityPatch` (campi ammessi, fase rifiutata su vendite, firma e attivazione scritte dal codice: `firmato` scrive `signed_at`, `attiva` scrive `activated_at`, tornare prima della firma le toglie entrambe, `persa` chiude), `newOpportunityRow` (mai `vendite`: quelle nascono dal contatto), `nextStepOf` (le vendite ereditano il follow-up del contatto), `stuckReason` (senza passo, passo scaduto da più di 3 giorni, fase ferma da 14).
- **Un responsabile per opportunità** (`owner`: nome di un membro del team o `agent:<id>`). È la regola che chiude la sovrapposizione fra generatori email: l'agente Commerciale salta i contatti con un'opportunità affidata ad altri (`selectSalesCandidates`), il vecchio orchestratore salta quelli con un responsabile e si ferma del tutto quando `sales_followup` è acceso. `email_drafts.deal_id` lega una bozza alla sua opportunità.
- **Database**: vincoli su pipeline, fasi, ruolo, responsabile, prove (array ≤ 50), `activated_at` solo dopo `signed_at`; trigger `deals_same_owner` (ente Tourism e progetto Agency dello stesso workspace, `stage_changed_at` scritto a ogni cambio fase). Test: `tests/opportunities.unit.test.ts`, `tests/opportunities.db.test.ts` (Postgres vero, migration applicata due volte).
- **In gioco** (`inPlay`): il piano guarda solo le opportunità che qualcuno sta lavorando. Tourism, distribuzione e agency ci sono sempre; una trattativa di vendita entra solo con un movimento negli ultimi 90 giorni (trattativa o `contacts.last_contact_at`) o un preventivo `sent`/`accepted`, e mai con il contatto fuori pipeline (scope non `crm` o `hidden`). Le altre restano nel CRM e nell'elenco `/opportunita`, contate a parte (`dormant`, «fuori dal piano»): senza filtro il piano dava 1.057 ferme su 1.061. Su Telegram e nella risposta allo «stato» va il formato corto (`directorPlanBrief`: numeri, prime tre da lavorare e da sbloccare, partner da attivare; `directorStatusLines(…, { brief: true })` solo i numeri) con il link all'Ufficio; il report completo resta nell'Ufficio.
- **Il piano di oggi** (`src/lib/office/director-plan.ts`, puro, nessun modello): punteggio = (1 + prove) × log10(valore + 10) × urgenza / (1 + 0,5 × lavoro mancante); tre liste — da lavorare, da sbloccare, partner da attivare (firmati non attivi) — più le guide che servono a un'opportunità. In testa alla pagina, nel report del Direttore e nella risposta allo «stato» del Direttore. `GET /api/opportunities` (filtri pipeline/owner/view/q), `POST`, `PATCH /api/opportunities/[id]`, `GET /api/opportunities/plan`.
- **Direttore** ogni mattina feriale alle 7:30 (`office-director`): report «Piano di oggi» (una volta al giorno), mandato anche su **Telegram** quando nasce (`directorPlanMessage`, `sendNotificationText` con `requiredChannel: 'telegram'`, mai ripiego su WhatsApp; rilanciare il Direttore non lo rimanda; un invio fallito resta scritto nel riepilogo della corsa e non la ferma); il lunedì le priorità mappe diventano proposte **solo se un'opportunità aperta le chiede** (`mapPrioritySupported`: `map_ref`, ente o nome della città), le altre restano nel report come «investimento», senza chiamare il modello. Un contatto approvato dagli ordini al Direttore apre l'opportunità della sua pipeline (destinazione → tourism, partner → distribuzione, agenzia → agency).
- **Ordine di deploy**: prima la migration, poi il codice (il codice filtra su `deals.pipeline`).

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
  - **Invio a mano** («Numera e scarica XML», `POST /api/invoices/[id]/send` con `{ manual: true }`): stessi controlli e stesso numero dell'invio, ma niente chiamata ad Aruba e niente credenziali necessarie. La fattura resta `sent` con `aruba_env = 'manual'` e senza `aruba_filename`, quindi il giro dello stato SDI la salta; l'XML definitivo si carica a mano sul pannello Aruba. Serve per la prima fattura, da controllare prima di affidarsi all'invio automatico
  - **La serie continua quella di Aruba**: in «Dati fiscali» si scrive l'ultimo numero emesso sul pannello; il formato (`{n}`, `{n}/{yyyy}`…) è un'impostazione
  - **Esito incerto** (rete, timeout, 5xx): la fattura va in errore con l'invito a controllare sul pannello prima di reinviare; un doppione verrebbe comunque scartato dallo SDI. Un invio rimasto «in invio» per 10 minuti torna in errore
  - **IdTrasmittente è Aruba, non chi emette**: `ARUBA_ID_TRASMITTENTE` = 01879020517 (Aruba PEC), controllato da Aruba in modo sincrono: con un altro codice il caricamento viene rifiutato
  - **Quote Aruba** (documentazione API, ottobre 2026): un accesso al minuto per IP, 30 invii e 12 ricerche al minuto, e per account al livello base 60 richieste l'ora e 10.000 l'anno; una richiesta rifiutata con 429 fa ripartire l'attesa. Per questo il token si tiene in memoria fino alla scadenza (30 minuti) e la lettura degli stati è parca
  - **Stato SDI** ogni ora dalle 7:45 alle 21:45 (job `invoices-sdi` → `/api/automation/invoices-sync`): solo fatture ancora «inviate» degli ultimi 20 giorni, al massimo 8 per giro a 6 secondi l'una dall'altra, ognuna non prima di due ore dall'ultimo controllo, e al primo 429 il giro si ferma
  - **Ambiente demo**: indirizzi `demoauth.`/`demows.fatturazioneelettronica.aruba.it`, ma serve un accreditamento apposito: le credenziali di produzione lì non valgono
  - **Bozza dal preventivo**: alternative non scelte escluse, sconto come riga negativa, «P.IVA / CF» del preventivo riconosciuto dalla forma, provincia letta da «Sorrento (NA)». Un rinnovo con importo diverso dal preventivo diventa una riga netta dall'incasso. Preventivi con acconto e saldo: la bozza fattura l'intero, e lo dice
  - Test: `tests/fatturapa.unit.test.ts`, `tests/invoices.unit.test.ts` (giro completo con Aruba finto). Endpoint, campi e stati controllati sulla documentazione API di Aruba (v1, `apidoc/docs.html`); **non ancora chiamati con credenziali vere**: prima fattura di prova in demo (o, senza accreditamento demo, una fattura reale controllata a mano)
- **Genera fattura dal preventivo**: sulla scheda di un preventivo pagato o accettato, solo per il titolare, «🧾 Genera fattura» chiama `POST /api/invoices` (idempotente: un preventivo già fatturato ritrova la sua fattura) e apre `/fatture?invoice=<id>` con la bozza aperta. Non invia nulla: l'invio allo SDI si conferma in Fatture
- **Firma in presenza dal CRM**: sulla scheda di un abbonamento non firmato, «Firma in presenza» chiede a `send-acceptance-email` il link con `link_only: true` e lo apre senza mandare email. Rigenera il token: un link inviato prima smette di valere

## Collaborator / Workspace Access

- Collaborators see only contacts assigned to them (by `responsible` or `assigned_agent`)
- Admin sees all contacts by default; toggle `workspace=all` to see everything
- Filter logic in `src/lib/server/collaborator-filters.ts` and `src/lib/data.ts` (contact visibility helpers)
- Team members linked via `auth_user_id` on `team_members` table
- `team_members` table has `name`, `email`, `color`, `auth_user_id`, `is_current_admin`
- **Accesso dei collaboratori** (`src/lib/server/team-login.ts`): «Rimuovi» cancella solo la riga `team_members`, l'utente di login resta in `auth.users`. Ricreando il collaboratore con la stessa email, `createUser` rispondeva "already been registered" e il CRM non andava avanti: ora `ensureMemberLogin` ritrova quell'utente e lo riusa con la password scelta. «Cambia password» / «Crea accesso» sulla riga (`PATCH /api/team-members/[id]` con `password`, min. 8 caratteri) fa lo stesso. Riusare un utente vuol dire poterne cambiare la password, quindi `assertAuthUserBelongsToWorkspace` rifiuta il titolare di un altro spazio di lavoro (righe sue in `team_members`/`contacts`) e un collaboratore di un altro team; anche il collegamento per sola email lo rispetta. Test: `tests/team-login.unit.test.ts`
- **Area permissions**: the workspace owner is the super admin (always every area). For each collaborator, `team_members.allowed_areas` (text[], `null` = defaults Pipeline/Contatti/Follow-up) lists the visible areas, edited via checkboxes in `/impostazioni/team`. Areas, defaults and path mapping live in `src/lib/areas.ts` (single source of truth, tested by `node --test scripts/areas.test.mjs`). Enforcement: sidebar + settings cards filtered and blocked URLs redirected to `/dashboard` in `(app)/layout.tsx`; area-specific API routes call `requireArea(auth, '<area>')` right after `requireRouteUser`. Acumbamail, Hospitality, Commerciale, Da incassare, Wine Project, WhatsApp settings and Team management are super-admin only (`SUPER_ADMIN_PATHS`, `auth.isAdmin`) and not delegable. To Do and Navigazione are areas (off by default); `/api/todo/columns` stays ungated because `useCRM` loads it for everyone. New area-specific routes must add a `requireArea` guard.

## Tourism Intelligence — scheda snella e attivazione di un ente

- **La scheda serve a una cosa**: avere l'ente nel database, con sito ed email, e portarlo nei contatti. In alto (`EntityEssentials.tsx`): tipo, paese, stato («da confermare» / «verificato, non ancora nei contatti» / «nei contatti»), sito, email, telefono, contatto CRM, e i pulsanti **Conferma e aggiungi ai contatti**, Crea la presentazione, Modifica, Archivia. Se sito o email mancano si scrivono lì. Le corrispondenze CRM da confermare restano visibili; fonti, punteggio, legami, duplicati e storico stanno in «Altri dettagli» (`<details>`, chiuso).
- **«Chiudiamo noi»**: il pulsante chiama `POST /api/tourism` con `action: 'activate'` → RPC **`tourism_activate`** (migration `20261024150000_tourism_activate.sql`, solo service role, eseguita col proprietario come `auth.uid()`). In una transazione: riempie solo i campi vuoti (sito, email, telefono), scrive **una** prova verificata a nome del titolare (fonte = sito, campi nome/paese/tipo + i recapiti presenti), mette l'ente `VERIFIED`, con una città crea o ritrova il luogo verificato e la relazione, e lo porta nel CRM con `tourism_promote`. **Un rifiuto del CRM** (nome ambiguo, possibile doppione, email già usata) **non annulla la verifica**: torna come `crm_error`, tradotto da `crmErrorText` (`src/lib/office/entity-activation.ts`), e si sistema dalla scheda (es. «Conferma collegamento»). La revisione fonte per fonte (`tourism_review`) e il vecchio «Add to CRM» non servono più per entrare nel CRM.
- **«Prepara la presentazione per X» non si ferma**: se X non è verificato o non ha una destinazione con legame verificato (`verifiedDestination`), il Direttore lo attiva lui (`activateEntityForOrder`, `src/lib/server/office-entity-activation.ts`), perché l'ordine del titolare è l'autorizzazione: città da `plan.city` se si ritrova nel nome o nell'ordine, altrimenti dal nome dell'ente senza «Visit», «Comune di»… (`cityForEntity`); sito dalla scheda, dall'ordine («…, sito visitbergamo.net», `websiteFromText`) o dalla **ricerca web** (`callModel` con `webSearch`: plugin `web` di OpenRouter, motore Exa, ~0,007 $ più i token, prenotati con `WEB_SEARCH_RESERVE_CENTS`; vale solo un sito letto che nomina tutte le parole distintive dell'ente, `siteMatchesEntity`; mai social, Wikipedia o portali); lettura del sito ed estrazione di email d'ufficio, telefono e frasi di prova (`validateEnrichment`, che ora restituisce anche i pezzi validi in `parts`); poi `tourism_activate` con `origin: 'director'` (Napoli esclusa) e la presentazione accodata con `destination_id`. Si ferma **solo per chiedere** il sito o la città che non trova, con la frase da rimandare. `presentationEntities` accetta come destinazione un legame COVERS, MANAGES o PROMOTES verificato. Test: `tests/entity-activation.unit.test.ts`, `tests/tourism-activate.db.test.ts`, `npm run test:tourism:ui` (aggiornato al pulsante nuovo).
- **Prova del legame ente → città**: se il sito non dà una frase che li leghi, la prova è l'ordine (Direttore) o la conferma (scheda) del titolare, scritta come prova di copertura (`20261025080000_tourism_activate_coverage.sql`): il catalogo rifiuta una relazione con la sola prova d'identità («Relationship evidence required»).
- **Ordine di deploy**: prima le migration `20261024140000_office_queue_update.sql` e `20261024150000_tourism_activate.sql` (e la correzione `20261025080000_tourism_activate_coverage.sql`), poi il codice.

## Presentazioni per destinazione (Tourism Intelligence)

Il tasto **Crea la presentazione** (scheda di un ente, o tab **Presentazioni** di `/tourism`) genera la presentazione «Speaqi Guides · Destinazioni» per un ente o un DMC: le quattordici slide della presentazione base di ottobre 2026, con il nome e le foto della destinazione. Si rivede, si approva e si condivide con un link (o si salva in PDF dal browser). Tutto riservato al proprietario del workspace (`requireTourismOwner`), come il resto del modulo.

- **La base è la presentazione «Speaqi Guides · Destinazioni»** (PDF di ottobre 2026, rivista il 26/10), in `DEFAULT_DECK_TEMPLATE` (`src/lib/tourism-deck.ts`, `base: 'destinazioni-2026-10-v2'`): quattordici slide con gli stessi testi — copertina, punto di partenza, proposta, cosa ottiene, lingue, catalogo (foto di Napoli, Roma, Lisbona, Pompei, Capri e la fascia «In produzione», **senza più numeri di luoghi**), prova (QR della mappa di Napoli), Speaqi Guides in azione, modello di collaborazione, **servizi aggiuntivi** («Il modello di Speaqi»: attività, visitatori, sponsor, chi paga), **cosa ci guadagna la destinazione** (sei vantaggi), **«Chi scegliamo»**, domande frequenti (sei), chiusura con contatti e QR di `guides.speaqi.com/destinations`. «Chi scegliamo» sta prima dei passi per candidarsi e li assorbe: tre cifre (250.000 presenze, 2 canali, 1 referente) e, in una fascia sotto, «Come si parte» in tre passi (primo incontro, accordo, mappa online); non c'è più una slide «come candidarsi» a parte. In una slide `figures` le voci con `value` sono le cifre, quelle senza sono i passi, in ordine, e `body` è la riga sopra la fascia. In una slide `showcase` una voce può avere `art` (chiave di `DECK_ART`, foto a tutta scheda con il nome in basso) e `body`/`note` fanno la fascia sotto le schede (elenco/etichetta). La mappa è gratuita per le destinazioni selezionate: nessun importo, nessun `[DA VERIFICARE]`, quindi si approva subito. **Della destinazione entrano il nome** (etichetta della copertina, «Cosa ottiene X.», «Facciamo la mappa di X.») **e le foto** (copertina, punto di partenza, proposta: una foto caricata sostituisce quella di esempio; le tre foto di esempio portano «Immagine generata con AI», `DECK_AI_ART`). Le immagini fisse sono ritagli del PDF in `public/deck/destinazioni/` e una slide (o una voce) le nomina per chiave (`DECK_ART`), mai per indirizzo. **Un modello già salvato con la base di prima (`destinazioni-2026-10`) passa alla nuova una volta sola, ma solo se è tale e quale al codice** (`isUneditedPreviousDestinations`, impronta SHA-256 di variabili, slide e preventivo in `src/lib/server/tourism-decks.ts`, prova con `tests/fixtures/tourism-deck-destinazioni-2026-10.json`): se il titolare l'ha corretto a mano non si tocca. Cambiando di nuovo la base: nuovo id in `DESTINATIONS_BASE`, quello vecchio in `DESTINATIONS_BASE_PREVIOUS`, impronta e fixture aggiornate.
- **Presentazione in inglese** («la presentazione di Sibiu la devi fare in inglese»): `input.lingua = 'en'` (`deckLanguage`) sceglie la base inglese `DEFAULT_DECK_TEMPLATE_EN` (`src/lib/tourism-deck-en.ts`: stessa struttura, immagini e icone della base italiana, solo le parole, per id di slide; `templateForDeck` la dà per un deck inglese, **non** il modello salvato dal titolare, che è in italiano). L'agente riceve la regola «scrivi in inglese» (`DECK_ENGLISH_RULE`) e il lettore (`DeckPlayer lang`, anche nella vista pubblica e nel PDF) dice «Image generated with AI». **È un deck a parte**: il Direttore (`englishPresentation`, nel suo budget, id fisso per ente) lo crea con titolo «… (EN)» e quello italiano resta com'è; chiederlo di nuovo rimanda quello che c'è. La lingua entra nel piano (`plan.language`) solo se l'ordine la nomina davvero (`ENGLISH_ORDER`): il modello da solo non la cambia. Col worker acceso l'inglese non passa dal compito dell'agente Presentazioni (ha un lavoro solo per ente): `interpretOrderWork` lo lascia a `executePlan`. Per ora solo per le destinazioni, non per la base partner. Test: `tests/tourism-deck-en.unit.test.ts`.
- **Le tre foto sono della destinazione** (copertina, punto di partenza, proposta: `DECK_PHOTO_ART`, `photoSlots`). Alla generazione, se il deck non ha già foto trovate, `addDestinationPhotos` le cerca su **Wikimedia Commons** (`src/lib/tourism-deck-photos.ts` puro, rete in `src/lib/server/tourism-deck-photos.ts`): prima le immagini della voce Wikipedia (it, poi en), poi la ricerca per nome su Commons, dove vale solo un file che nomina la città. Solo JPEG orizzontali da almeno 1400×800, **solo licenze libere** (CC BY, CC BY-SA, CC0, pubblico dominio; NC e ND no), niente cartine, stemmi, loghi; scaricate solo da `upload.wikimedia.org`, ridotte a 1920 px (`photoForDeck`) e salvate fra i materiali con `source: 'wikimedia'`, credito (autore · licenza · Wikimedia Commons) e pagina del file. Il credito si vede sulla foto (`DeckPlayer`, `credits`), anche nella vista pubblica e nel PDF. **Il codice assegna le foto, non il modello** (`assignPhotos`): una diversa per slide, prima quelle caricate da una persona, poi quelle trovate; una scelta già fatta resta, un doppione si toglie. Wikimedia giù o niente di libero: restano le immagini di esempio e il motivo va negli avvisi. Rigenerare non riscarica.
- **Foto da Telegram** (o allegate a un ordine al Direttore nel CRM): «foto per la presentazione di Bibione» con le foto. Se la presentazione esiste, `addPhotosToDeck` le aggiunge subito al posto di quelle di Commons e di esempio (una approvata torna in revisione, il link si spegne finché non la si riapprova); se non esiste, i percorsi delle foto (`office-director/<utente>/<ordine>/<foto>.jpg`, `isDirectorPhotoPath`) viaggiano nella voce di coda delle Presentazioni (`photos`, validati da `presentationQueue`) e l'agente le mette nei materiali prima di generare. La stessa foto non entra due volte (`source_url` = percorso nel bucket del Direttore). Massimo 8 foto per presentazione. Test: `tests/tourism-deck-photos.unit.test.ts`, `tests/tourism-decks.unit.test.ts`.
- **Slide fisse** (`fixed`): sono il testo approvato della base. `mergeGenerated` ne prende solo la foto scelta dall'agente; l'agente le vede marcate `testo_fisso`. Si personalizza solo «Il punto di partenza» (da dove arrivano i visitatori e i canali dell'ente, solo se lo dicono i materiali). A mano si può sempre correggere tutto dall'editor del deck.
- **Tipi di slide** (`DeckPlayer`, `deck.module.css`, palco 1920×1080): `cover`, `statement`, `list` (elenco con foto a tutta altezza; chiaro con filetti, scuro con icone), `cards` (icone, etichetta sopra il titolo via `value`, scheda evidenziata via `highlight`; 4 schede = 2×2), `steps` (01/02/03), `languages`, `showcase` (una colonna per mappa, numero in basso), `figures` (numeri grandi con il filetto), `compare` (due colonne, righe separate da a capo), `demo` (fondo arancione, QR e telefoni), `media`, `closing` (contatti con icone e QR). Campi nuovi: `kicker`, `footnote`, `tone` (`light`/`dark`/`deep`/`accent`), `art`, `qr`, `fixed`; per le voci `value`, `icon` (elenco chiuso `DECK_ICONS`, disegnate in SVG), `highlight`. Un titolo va a capo dove ha `\n`.
- **Il modello si modifica dal CRM** («Modifica il modello» nel tab): tipo, etichetta, titolo, testo, voci (con numero o etichetta dove serve), riga in evidenza, nota piccola, testo fisso sì/no e **istruzione per l'agente**. Nei testi valgono i segnaposto `{{destinazione}} {{ente}} {{paese}} {{prezzo}} {{contatto}}`. «Ripristina la presentazione base» la rimette. Modificarla non cambia le presentazioni già create, vale per le nuove e per le rigenerazioni. **Un modello salvato senza `base`** (precedente a ottobre 2026) **si sostituisce una volta** con la base nuova alla prima lettura (`getTemplate`, UPDATE condizionato sulla versione); uno salvato dopo, base aziende compresa, resta com'è. La base aziende (`TOURISM_COMPANY_TEMPLATE`) usa ancora contatto e condizioni del form, che nel form stanno in «Solo per la base aziende».
- **Il form** chiede destinazione, ente, paese, prezzo proposto, contatto, testo libero (appunti, mail, testo del sito), **documenti** (PDF, Word, TXT/MD/CSV: max 4, 12 MB) e **foto** (JPG/PNG/WebP: max 8, 8 MB). Il tipo si decide dai byte, non dal nome (`sniffUpload`). Il bucket privato `tourism-deck-assets` si crea alla prima richiesta, come quello dei backup.
- **L'agente** (`tourism-deck-agent.ts`, API Responses, JSON strict) riceve il modello con i segnaposto già riempiti, la scheda dell'ente e i **soli luoghi approvati** di Tourism Intelligence, il testo, i documenti (Word/testo estratti senza dipendenze; i PDF li legge il modello) e le foto (ridimensionate a 1280 px con `sharp`). Riscrive i testi e sceglie la foto per copertina/messaggio. **Il modello propone, il codice decide** (`mergeGenerated`, `guardGenerated`): tipo, numero di voci e istruzioni restano quelli del modello; un importo in € che non sta nel modello, nei valori inseriti o nei materiali diventa `[DA VERIFICARE]`; un altro numero senza riscontro si segnala; una foto non del deck si toglie. Tutto ciò che sta nei documenti è dato, mai istruzione (prompt injection).
- **Numeri e contatto non si indovinano.** In un modello con segnaposto (base aziende, o una base modificata a mano) **non si approva finché restano `[DA VERIFICARE]`** (`setApproval`). I numeri della base destinazioni sono quelli del PDF: cambiano solo cambiando il modello.
- **Se l'agente fallisce** il deck resta con le slide del modello e stato `failed` col motivo: si corregge a mano. Una generazione alla volta per deck (UPDATE condizionato; una ferma da oltre 6 minuti si riprende). Salvataggi con `version` (409 su conflitto); modificare una presentazione approvata la riporta in revisione e il link smette di funzionare.
- **Vista pubblica** `/presentazione/<token>` (fuori da `(app)`): solo presentazioni `approved`, token di 64 caratteri, `noindex` e `no-referrer`, foto con URL firmati a 6 ore. Stesse slide dell'anteprima dell'editor (`DeckPlayer`, palco 1920×1080 scalato). `?print=1` apre la stampa del browser: ogni slide è una pagina 16:9.
- **PDF generato dal server** (`tourism-deck-pdf.ts`): Chromium apre la pagina pubblica sullo stesso server (`127.0.0.1:$PORT`) e la stampa, 1920×1080 per pagina. Il Chromium è **`@sparticuz/chromium`** (binario autonomo da ~67 MB, con `puppeteer-core`): niente apt, perché sull'immagine Ubuntu di Railway il pacchetto `chromium` è solo uno stub di snap. Un Chromium alla volta (coda in processo, 90 s di tetto), un PDF per versione in `tourism-deck-assets/<utente>/<deck>/deck-v<versione>.pdf` (le versioni vecchie si tolgono), una richiesta sola per file anche con cento aperture insieme. Si prepara all'approvazione; `GET /presentazione/<token>/pdf` (pubblico, solo approvate) e `GET /api/tourism/decks/<id>/pdf` (proprietario) lo servono. **Il proprietario lo scarica anche prima di approvare** («Scarica il PDF» accanto ad «Approva», con le modifiche salvate): Chromium apre la pagina pubblica con `?render=<chiave>` (`deckRenderKey`, HMAC con `AGENCY_RENDER_SECRET` o `SUPABASE_SERVICE_ROLE_KEY`, valida per quella sola versione), quindi il link pubblico di una bozza resta chiuso a tutti gli altri. Niente scritta «Bozza» sulle pagine: il PDF è quello che si manda. Mentre l'agente lavora non si genera. Se Chromium non risponde, la rotta pubblica ripiega sulla stampa del browser. `next.config.ts` lo tiene fuori dal bundle (`serverExternalPackages`) e copia i binari nello standalone (`outputFileTracingIncludes`, solo per le rotte che lo usano): senza, in produzione manca il file. `CHROMIUM_PATH` indica un Chromium di sistema al posto di quello incluso. Memoria: 300-500 MB per qualche secondo a ogni PDF; con un container stretto è il punto da guardare. Test: `npm run test:tourism:pdf` (Chromium vero, a parte perché lento).
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
- **PDF**: dallo stesso Chromium delle presentazioni Tourism (`renderPdf`), **anche in bozza** (Chromium apre `/proposta/<token>?render=<hmac>` con una chiave valida per quella sola versione, `AGENCY_RENDER_SECRET`; ogni pagina porta "Bozza"); un PDF per versione + preventivo + identità, in cache su Storage. Il download inizializza il bucket privato `agency-assets` anche senza allegati: altrimenti la prima esportazione fallisce con `Bucket not found`. `scripts/check-agency-pdf.mjs <token>` nell'immagine di produzione avvia un server temporaneo senza automazioni e verifica due download del documento approvato, inclusi formato, pagine 16:9 e cache Storage; il test sintetico di Chromium durante il build non verifica questa catena completa.
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

- **PDF Agency e Tourism**: il Dockerfile installa `libnspr4`, `libnss3`, `libexpat1` e i certificati nello stage `pdf-runtime`, ereditato dal runner. Il binario Chromium incluso nel pacchetto non porta queste librerie nell'immagine Debian slim; la loro assenza causa `Code: 127` e il download restituisce 500. Lo standalone finale esegue `scripts/check-pdf-runtime.mjs` durante il build: deve generare un PDF 16:9. I binari della prova vengono decompressi in una cartella temporanea dedicata e rimossi nello stesso RUN; Railway non supporta mount tmpfs durante il build.

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

- `/ufficio` (la scena 3D) e `/ufficio/agenti` (registro, budget, corse e coda delle uscite da decidere) e le API `/api/office/*` sono solo del titolare (`SUPER_ADMIN_PATHS`,
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
- `callModel` passa da **OpenRouter** (chat completions, `openai/gpt-5-mini`), non da OpenAI:
  la chiave e' `OPENROUTER_API_KEY_OFFICE` se c'e' (su OpenRouter, Activity filtrata per
  chiave, si leggono i consumi dell'Ufficio da soli), altrimenti `OPENROUTER_API_KEY`. Solo
  testo e immagini, senza strumenti esterni; con uno schema JSON `require_parameters`, cosi'
  risponde solo un fornitore che lo rispetta. Prenota il massimo stimato dal listino puro
  `office-pricing.ts` prima della chiamata (`gpt-5-mini`, USD 0,25 ingresso / 2 uscita per
  milione di token, verificato il 22/10/2026; modello sconosciuto -> stop) e salda col
  **costo dichiarato da OpenRouter** (`usage.cost`, crediti in dollari), o col listino se
  manca. `OFFICE_USD_TO_EUR` converte in EUR (default prudente 1, fino a sei decimali), ogni
  chiamata arrotondata al centesimo superiore. Una richiesta respinta prima di generare
  (400/401/402/403/404/413/422/429: chiave, credito finito, moderazione, modello, limiti) non
  e' fatturata: riserva saldata a zero e motivo leggibile (401/403 → controlla
  `OPENROUTER_API_KEY`, 402 → ricarica il credito). Timeout, 5xx o usage assente lasciano la
  riserva impegnata e la corsa in errore: il fornitore potrebbe avere gia' fatturato. Da
  riconciliare manualmente prima di liberarla; nessun ritentativo automatico. La
  trascrizione dei vocali (`transcribe.ts`) resta su OpenAI (`OPENAI_API_KEY`): OpenRouter non
  ha un endpoint di trascrizione e non accetta il WebM che registra il browser.
- Il contesto del compito espone solo `reserve`, `settle`, `addOutput`, `log` e
  metadati: nessun invio email, social, fattura o pubblicazione di mappe.
  `addOutput` scrive solo nella coda `pending`, con chiave unica per corsa.
  La decisione non pubblica e non invia. Per gli output ordinari aggiorna solo
  decisione/data; gli agenti successivi aggiungono effetti interni espliciti
  (per il Direttore, la coda del destinatario). Nessuna esecuzione generica del
  record indicato da `target_table`/`target_id`.
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
  `AUTOMATION_WORKSPACE_USER_ID`, quando il titolare apre `/ufficio/agenti` o si chiama
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

### Agente 01 — Direttore

- `director`, reparto Direzione, feriali alle 07:30 Europe/Rome (`office-director`: piano del giorno sulle opportunità, vedi «Opportunità»; priorità mappe il lunedì),
  nasce spento. Budget 100/100/500 centesimi giorno/settimana/mese; modello
  configurabile in `settings.model`, altrimenti quello del registro.
- Priorità deterministiche in `src/lib/office/director.ts`: destinazioni previste
  con priorità uno e volumi misurati (anno e fonte obbligatori, stime escluse),
  assenti da un catalogo effettivamente letto; poi mappe pronte non su Speaqi;
  poi guide online con copertura testi inferiore al 90%. Napoli/Naples/napolimap
  escluse anche per alias e slug. Senza cataloghi non si deduce un'assenza.
- `directorHandler` legge destinazioni, porti (`tourism_hubs mode=sea`), finanza
  tramite `summarizeMoney`, trattative aperte e corse degli ultimi sette giorni
  con query paginate e fonti allegate. Passeggeri e arrivi non si sommano.
  `SPEAQI_API_KEY` è la nuova env facoltativa del CRM: chiave del proprietario
  Speaqi per il solo GET `/maps/:id/studiomap/translations`, sul base URL esistente
  `SPEAQI_PUBLIC_API_URL`. Senza chiave o conteggi completi, copertura dichiarata
  non verificata e nessuna proposta lingue da dati mancanti. Nessun fill/sync.
- `callModel` scrive soltanto tre-cinque righe per punto. Ordine, target e azioni
  restano nel codice; numeri senza riscontro e link nel testo fanno usare una
  descrizione deterministica senza numeri. Un report per settimana, proposte
  pendenti non duplicate e rifiuti soppressi per 28 giorni dalla decisione.
- Migration `20261022183327_office_director.sql` prima del codice, dopo le
  migration precedenti. `decide_office_output` è una RPC service role: decisione
  e coda interna sono atomiche, con lock e chiavi stabili; il destinatario resta
  spento e non viene avviato dal clic. Rifiutare registra data/stato senza coda.
  Target e destinatari sono un elenco chiuso; nessun SQL dinamico o azione esterna.
- «Costruire» accoda a `mymaps_builder`, «Completare le lingue» a `languages_voice`.
  «Pubblicare» accoda `publication_review` a `maps_quality`: il roster non ha un
  agente che pubblichi, quindi la pubblicazione resta manuale. Prima di installare
  i prompt successivi, approvare una proposta con destinatario mancante risponde
  409 e la lascia pending. La coda conserva id sorgente, città, azione e target.
- Test unit su priorità, fonti, Napoli, soglia lingue, numeri, rifiuti e pipeline
  senza spesa ripetuta; HTTP sulla RPC autorizzata; Postgres vero per decisioni
  concorrenti, coda, workspace, permessi, Napoli e assenza di effetti sui target.
  Le prove non generano mappe né pubblicano e non chiamano modelli a pagamento.


### Agente 07 — Osservatorio novità

- `news_watch`, Ricerca, ogni giorno alle 07:00 (`office-news-watch`), nasce
  spento; budget iniziali 30/210/930 centesimi giorno/settimana/mese.
  Gestione in `/ufficio/agenti`. La scena `/ufficio` non è modificata.
- `settings.feeds` è una lista di massimo 20 URL pubblici (RSS, Atom o pagine
  con data esplicita). Vuota vale `DEFAULT_NEWS_FEEDS` (`src/lib/office/news.ts`,
  scelte il 25/10/2026 su richiesta del titolare: stampa turistica italiana e
  internazionale, musei, crociere, AI); una fonte che non risponde finisce negli
  avvisi del rapporto e non ferma la rassegna. Scritta a mano, vince sulle predefinite. I concorrenti
  predefiniti sono STQRY, Cuseum, SmartGuide, VoiceMap, Locatify e si possono
  cambiare in `settings.competitors`. Nessun nuovo segreto o feed inventato.
- Il fetch riusa `fetchResearchPage` con controllo degli indirizzi privati,
  DNS fissato alla connessione, limiti di tempo/dimensione e senza redirect.
  Solo pubblicazioni delle ultime 48 ore, mai una data dedotta da `updated`.
  Link canonici, titoli normalizzati/simili e `office_news_seen` evitano doppioni.
- `office_news_batches` prenota un solo tentativo per giorno e workspace prima
  del modello; un timeout non ripaga e non marca gli articoli come visti.
  `callModel` prenota budget prima della richiesta e salda dai token restituiti.
  Il codice conserva massimo otto notizie, con link letto e cifre nelle fonti.
  Report e inserimento dei visti sono atomici, con vincoli e lock PostgreSQL.
- Telegram non parte dal job: la regola comune del clic umano prevale sul
  testo del Prompt 7. `settings.telegram=true` abilita **Approva e invia su
  Telegram** nella coda di `/ufficio/agenti`. Solo il titolare autenticato
  può chiamare `POST /api/office/outputs/[id]/telegram`; workspace/destinatario
  non sono accettati nel corpo. Riusa il bot/configurazione esistenti e impone
  il canale Telegram, senza ripiego su WhatsApp. Una prenotazione persistente
  precede l'invio: esiti incerti o doppio clic non vengono ritentati.
- Migration nuova **20261023055356_office_news_watch.sql**, dopo le migration
  00/11/10/01 già in main; non dipende dal 12. Tabelle nuove: batches, seen,
  deliveries; RLS di lettura del proprietario, scritture e RPC solo service role,
  tutte incluse nei backup. Nessuna applicazione al database operativo.
- Test nuovi e Finanza/Commerciale caricano DDL reali da `supabase/migrations`
  tramite `tests/office-schema.ts`, non copie di email_drafts/gmail_messages.
  L'unico confine simulato è Supabase Auth; CHECK, NOT NULL, FK e RLS restano.
  Il runner `reset-office` crea solo un DB locale usa-e-getta; non contatta
  Supabase. Le prove includono concorrenza, rollback, fonti, RLS e invio simulato.

### Agente 12 — Social

- `social`, Marketing, lunedì alle 09:00 (`office-social`), nasce spento;
  budget iniziali 100/100/500 centesimi giorno/settimana/mese. Gestione in
  `/ufficio/agenti`, nessuna modifica alla scena `/ufficio`.
- Riusa `loadMapsStatus`; solo guide online confermate dal catalogo Speaqi.
  Legge il catalogo pubblico e `GET /public/maps/:slug`, senza credenziali
  social o API di pubblicazione. Napoli è esclusa prima di leggere il payload
  e nuovamente nel controllo dei testi/SQL; nessuna nuova bozza su di essa.
- Dati: punti del catalogo, itinerari espliciti del payload completo, elenco
  delle lingue effettivamente disponibili solo se esposto, minuti audio solo
  se presenti. `target_languages` non prova traduzioni completate; un dato
  assente o dietro paywall resta null, non zero. Foto solo URL HTTPS ricevuti
  nella mappa/catalogo. Senza guida e foto verificate si prepara un avviso,
  senza spendere o inventare contenuti.
- `office_social_batches` prenota una sola generazione per settimana italiana
  prima del modello; `callModel` riserva budget e salda i token. Timeout o
  esito incerto non vengono ripagati automaticamente. Il codice lega ogni
  cifra alla propria unità/dato: avere tre itinerari non autorizza tre lingue.
  Testi con cifre estranee, link inventati, Napoli, superlativi o promesse
  non consentite sono scartati. La sostituzione è una bozza deterministica
  diversa, ricostruita solo dai dati, con avviso della proposta AI scartata.
- Tre-cinque `office_agent_outputs kind=draft_post`, sempre pending; ogni
  bozza contiene testo/hashtag (max 5) per Instagram, LinkedIn, Facebook,
  foto suggerita reale e link con UTM source=piattaforma, medium=social,
  campaign=office_social. Approvare registra la decisione, non pubblica.
- `office_social_snapshots` conserva i fatti settimanali: si parla di mappe
  nuove solo con published_at degli ultimi sette giorni e di lingue aggiunte
  solo con un confronto fra elenchi disponibili. I luoghi più aperti non
  sono esposti da queste fonti: nessuna classifica inventata.
- Migration nuova **20261023060654_office_social_drafts.sql**, dopo le
  migration 00/11/10/01 già in main. Indipendente dal 07; nessuna nuova env.
  Tabelle nuove nei backup, RLS proprietario e RPC solo service role. Salvataggio
  atomico delle bozze con controlli di foto e UTM contro le fonti prenotate.
  Nessuna migration applicata a database operativi durante lo sviluppo.
- Test con DDL reali delle migration tramite `tests/office-schema.ts`, compresi
  CHECK su source/status di email_drafts. Le prove usano solo Postgres locale
  isolato e servizi simulati; nessuna pubblicazione o invio.
## Ufficio — Costruttore My Maps (Prompt 02)

- `mymaps_builder` nasce spento. Il job `office-mymaps` controlla alle 01:30
  Europe/Rome; un turno persistente di due giorni impedisce doppi import tra
  mesi e repliche. Una sola mappa per corsa, massimo 150 nuovi candidati.
- `settings.queue`: `[ {"slug":"marsiglia","city":"Marsiglia","source":"URL o id My Maps"} ]`.
  Accetta anche le proposte approvate del Direttore: senza URL usa solo una
  fonte già collegata nel catalogo StudioMap; se manca lo dichiara e si ferma.
- Il CRM registra corse, riserva e saldo. Questo import costa **0 centesimi**:
  riusa parser, categorie e schede candidate, senza Google Places a pagamento,
  scrittura testi, traduzioni, sync o pubblicazione. Il tetto resta 300
  centesimi/corsa; nessun provider può spendere da questo handler.
- StudioMap espone `POST /api/office/mymaps/run`, autenticato con segreto forte
  anche senza login dashboard. `OFFICE_BRIDGE_SECRET` (almeno 32 caratteri)
  identico su CRM/StudioMap; `OFFICE_STUDIOMAP_URL` nel CRM (origine HTTPS,
  default `https://studiomap.speaqi.com`). Nessuna env Speaqi API nuova.
- Matching per place_id, poi nome simile entro 30 metri. Solo campi vuoti
  completati; testi esistenti intatti. Le descrizioni KML restano fonti.
  Napoli è rifiutata per input e identità risolta. Le prove usano storage isolato.
- Ricevuta persistente con id richiesta e impronta: richieste ripetute non
  aggiungono altri candidati. Un import interrotto resta incerto e richiede
  verifica manuale. Il gate di readiness viene soltanto letto; se superato
  si prepara una proposta `Pubblicare <città>` senza eseguirla.
- Nessuna nuova migration: usa le tabelle della base e i documenti StudioMap.
  Prerequisiti CRM: migration Prompt 0, 11, 10 e 1 già presenti nel branch base.
  Nessuna migration operativa o deploy viene eseguito dalle prove.


## Ufficio — Controllo qualità mappe (Prompt 04)

- `maps_quality` nasce spento, job `office-maps-quality` alle 04:00 italiane,
  budget 200/1400/6200 centesimi al giorno/settimana/mese. Coda vuota: tutte le
  mappe StudioMap; `settings.queue` può limitare a slug o proposte approvate
  del Direttore. Il 04 parte dal 02 e non dipende dal 03 assegnato a Claude.
- Bridge `POST /api/office/quality/read` su StudioMap, stesso segreto forte
  del 02. Solo letture di metadata e luoghi: niente audit mutante, cache,
  snapshot, aggiornamento lingue, richieste di generazione o pubblicazione.
- Controlli puri StudioMap: foto mancanti/ripetute, coordinate impossibili/0,0
  e distanza dal centro, testi vuoti/sotto 300 caratteri/identici, telefoni e
  orari impossibili, chiusura dal dato Google salvato, alfabeti e lunghezze
  delle traduzioni salvate. Nessuna chiamata Google a pagamento.
- Il raggio città predefinito è 50 km (euristica dichiarata, non confine
  amministrativo); può essere esplicitato con `settings.radius_km_by_map`.
  Senza centro o per regioni senza raggio, la verifica viene dichiarata assente.
- StudioMap non conserva normalmente i testi tradotti e l'API attuale espone
  conteggi: i controlli delle traduzioni usano solo testi realmente salvati
  nelle fonti (`extracted_data.translations`, array language/text). Il rapporto
  dichiara quanti luoghi sono coperti; nessuna copertura viene inventata.
- Campione globale di massimo 20 luoghi per corsa, a rotazione giornaliera,
  su mappe/luoghi ordinati. Il modello riceve testo e fonti salvate in lotti di
  quattro, con JSON Schema strict. Il codice scarta citazioni assenti dal
  testo, riferimenti estranei, altri luoghi e doppioni; non inventa spiegazioni.
- Tutti i rapporti gratuiti e i `data_fix` sono scritti prima delle chiamate
  al modello. La riserva precede ogni chiamata tramite `callModel` esistente.
  Il rapporto persistente per mappa/giorno impedisce una seconda spesa dopo
  errori o timeout. Stato e campione incompleto restano visibili; gli esiti
  incerti richiedono riconciliazione, mai un retry automatico a pagamento.
- Napoli può comparire solo in un rapporto di lettura, senza `data_fix`.
  Altrove coordinate sospette generano una richiesta di verifica con valore
  null: nessuna posizione corretta viene inventata. Approvazione/rifiuto
  registra la decisione nel CRM, l'applicazione della correzione resta manuale.
- Nessuna nuova migration o env rispetto al 02. Test puri e con modello
  simulato, snapshot dei dati immutati su fs e pg isolati. Nessun deploy.


## Ufficio — Presentazioni (Agente 09)

- `presentations`, Commerciale, nasce spento; job `office-presentations` lunedì
  alle 10:00 Europe/Rome e corsa manuale in `/ufficio/agenti`. Budget iniziali
  300/300/1500 centesimi giorno/settimana/mese, massimo due generazioni per corsa.
  La scena `/ufficio` non è modificata.
- `settings.queue`: `[{"entity_id":"UUID ente","destination_id":"UUID luogo"}]`.
  Ammesso anche il solo UUID ente: la destinazione si risolve soltanto da una
  singola relazione `COVERS` con evidenza verificata. Identità verificate nel
  workspace, enti/luoghi disabilitati e Napoli esclusi. Nessun ente indovinato.
- **La richiesta dell'ufficio è solo testo** (`officeDeckInput`): foto (Wikimedia, Telegram) e PDF restano fuori. Nel JSON il base64 delle foto superava i 250.000 caratteri e il controllo dei costi fermava la generazione con «Testo troppo lungo o non valido», prima di spendere. Le foto le assegna il codice (`assignPhotos`). Una presentazione rimasta `failed` richiesta di nuovo al Direttore viene rigenerata da lui nel suo budget (`retryFailedDeck`), non rimandata con le slide del modello: la richiesta del titolare è la decisione, nessun ritentativo automatico. Si rigenera solo la riga letta (`generateIntoDeck(..., { onlyIfUnchanged: true })`: stesso stato e stessa versione), così una modifica fatta nel frattempo dall'editor non viene sovrascritta; se arrivano foto per una presentazione `failed`, prima si aggiungono e poi si rifà. I PDF caricati restano fuori dalla richiesta dell'Ufficio (lo erano anche prima: il base64 dentro il testo non era leggibile dal modello).
- Riusa `createDeck`, `generateIntoDeck`, modello salvato, JSON Schema e guardie
  di `tourism-deck-agent.ts`. Il callback del modello passa da `callModel` con
  riserva prima del costo e saldo dai token; nessuna seconda pipeline o retry
  automatico. L'ufficio usa solo testo e nessun file multimediale.
- `office_presentation_tasks` prenota una volta per ente/destinazione prima
  della creazione e della spesa. Il suo UUID è l'id del deck: un crash non
  crea un altro deck. Un tentativo incerto va riconciliato manualmente prima
  di riprovare; il cron non rigenera da solo. Rapporti deduplicati fra corse
  per deck/versione, pronti anche nel riquadro Tourism di «Aspetta te».
- Segnaposto elencati per slide/campo. Le proposte `data_fix` richiedono un
  valore in `details`, campo attestato, evidenza `VERIFIED`, fonte pubblica e
  valore presente nell'estratto. Valori discordanti restano da verificare.
  Per i tre conteggi del territorio: `place_count`, `route_count`, `service_count`.
  I segnaposto espliciti `[DA VERIFICARE: campo]` usano quel campo. Nessuna
  correzione automatica: si copia la proposta nell'editor e si approva lì.
- Il trigger di approvazione prepara una sola email per deck, **solo dopo il
  clic in Tourism**, con `source='office'`, stato `pending`, link pubblico del
  deck e nessun invio. `APP_BASE_URL` deve essere una origine HTTPS pubblica
  (default `https://crm.speaqi.com`). L'approvazione del rapporto Ufficio non
  approva il deck. Servono email verificata e contatto CRM collegato allo stesso
  ente/email, visibile e non disiscritto; una bozza già pendente blocca la nuova.
  Il cron riprova solo questa preparazione gratuita dopo il completamento dei
  dati e segnala i blocchi, senza ripagare la generazione.
- Migration **`20261023090100_office_presentations.sql`**, dopo le migration
  Tourism Intelligence/ricerca/deck e Ufficio 00/11/10/01 già presenti in main.
  Il timestamp segue il 05, che non viene modificato. Nessuna dipendenza da 07/12.
  Tabella privata con RLS e RPC riservate al service role; inclusa nei backup.
  Nessuna applicazione a database operativi durante lo sviluppo.
- Test nuovi con DDL originali Tourism/Ufficio/email_drafts e CHECK reali,
  PostgreSQL locale, concorrenza, retry fra corse, fonte obbligatoria, Napoli,
  mancata approvazione automatica, approvazione umana e bozze mai inviate.

## Ufficio — Pulizia database (Agente 05)

- `db_cleaner`, reparto Operazioni, la domenica alle 04:30 Europe/Rome (`office-db-cleaner`),
  nasce spento. Nessun modello: costo zero, budget 10/50/200 centesimi solo come tetto.
- **L'agente non modifica niente.** Trova e propone; l'unione parte solo quando il titolare
  approva, dentro `decide_office_output` (stessa transazione della decisione, come la coda
  del Direttore). **Nessun DELETE**: il doppione resta, `hidden = true`, con la nota
  «[Unito in <id> il …]», e sul contatto tenuto si scrive un'attività `note` con cosa è stato spostato.
- Chiavi calcolate dal database (`office_email_key`, `office_phone_key` con +39/0039 e numeri
  ripetuti scartati, `office_company_key` = azienda + città), gruppi da 2 a 20 schede visibili
  (`office_cleaner_duplicate_keys`), pesi per scegliere chi tenere (`office_cleaner_contacts`):
  i 60 mila contatti non passano dalla memoria del server. Logica pura in `src/lib/office/db-cleaner.ts`:
  union-find sulle chiavi, si tiene chi ha più storia (trattative, preventivi, email, attività,
  pipeline), a parità il più vecchio.
- **Proposte**: i gruppi *sicuri* (stessa email o telefono, fuori pipeline, senza trattative né
  preventivi) in lotti da 20 (`data_fix`, `action: merge_contacts`); gli altri uno per uno, da
  guardare (in pipeline, con trattative/preventivi, o solo stessa azienda e città). **Bloccati**
  e solo nel resoconto: chi è in una sequenza in corso (`commercial_enrollments` pending/active,
  eventi Wine scheduled/queued/processing) e i gruppi con più di una trattativa aperta.
  Un gruppo già in attesa o rifiutato negli ultimi 90 giorni non si ripropone.
- **Unione** (`office_merge_contacts`): lock in ordine di id, stesso proprietario e schede ancora
  visibili, al massimo una trattativa aperta in tutto. Sposta attività, task, trattative,
  preventivi, fatture, bozze (una automatica per contatto e orario: quella in conflitto resta),
  Gmail, transizioni, log AI, progetti Agency, espositori, compagnie, notifiche, legami Tourism
  (solo verso enti verificati, come vuole il trigger) e mappe collegate (senza doppioni). Restano
  sulla scheda vecchia sequenze, iscrizioni, memoria AI, abbinamenti Tourism e tentativi di invio.
  Sul tenuto si riempiono **solo i campi vuoti**; le email diverse vanno in `alternative_emails`,
  la disiscrizione passa sempre. Un gruppo che fallisce si salta col motivo (`body.result.skipped`);
  se non se ne unisce nessuno la proposta resta in attesa e la pagina mostra il perché.
- Altri controlli (`office_cleaner_scan`, sola lettura): email scritte male, noreply, PEC,
  pipeline ferma da 90 giorni senza prossimo passo, preventivi in bozza da 60 giorni, trattative
  aperte su contatti chiusi, enti Tourism con nomi quasi uguali. Diventano elenchi da rivedere
  (`action: review_list`): approvarli segna solo che sono stati visti.
- Migration `20261023090000_office_db_cleaner.sql`, dopo quella del Direttore (ridefinisce
  `decide_office_output` tenendo identico il suo ramo). RPC solo `service_role`.
- Test: `office-db-cleaner.unit.test.ts` (regole, handler che non unisce e non duplica),
  `office-db-cleaner.db.test.ts` (Postgres vero: unione completa, vincoli di produzione,
  trattative aperte, gruppo estraneo saltato, otto clic concorrenti, permessi, scan senza effetti).


### Agente 06 — Ricercatore eventi

- `events_scout`, Ricerca, nasce **spento**. Budget iniziali 100/350/1500 centesimi
  giorno/settimana/mese. Job `office-events-scout`, path
  `/api/automation/agents/events_scout/run`, alle 06:30 Europe/Rome a giorni alterni.
  Il cron controlla ogni giorno; `everyDays:2` conta i giorni locali dal 1 gennaio
  1970, senza ripartire a ogni mese. La gestione resta in `/ufficio/agenti`.
- `settings.sources`: massimo 30 URL pubblici, lista iniziale vuota. Riusa
  `fetchResearchPage`: verifica DNS/reti private, GET senza redirect, timeout e
  limite dimensione esistenti. Massimo cinque fetch contemporanei, nessun modulo.
  `settings.queries` accetta fino a 20 query fisse ma **non le esegue**: la discovery
  Tourism presente cerca enti, senza connettore eventi con costi prenotabili nel
  ledger Ufficio. Il limite alle fonti configurate è esplicito in ogni report.
- Prima JSON-LD Event, iCal VEVENT e RSS/Atom con date evento esplicite. `pubDate`
  non è la data dell'evento. Soltanto le pagine senza struttura passano a
  `callModel` con JSON Schema strict, riserva e saldo del budget. Nessuna ricerca
  web o costo di strumenti aggiuntivi. Finestre, slug e punteggio sono codice.
- Nome, città e organizzatore devono apparire nella pagina; inizio/fine e ogni
  scadenza devono corrispondere alle date lette; URL ufficiale ammesso soltanto
  fra i link realmente presenti. Nessuna deduzione di dati mancanti. iCal DTEND
  conserva la data esclusiva pubblicata; una LOCATION libera non viene spacciata
  per una città (solo X-CITY esplicito). Date passate, oltre sei mesi di calendario,
  tipi estranei e fatti senza riscontro sono scartati. Doppioni per slug/data.
- `office_event_batches` prenota una sola corsa giornaliera per workspace prima
  del modello, congelando pagine, link e date. Timeout, errori o budget esaurito
  restano segnalati; nessuna seconda spesa per le stesse pagine in quel giorno.
  Analisi del modello limitata a 12 minuti complessivi (più l'ultima richiesta).
  Fino a 100 candidati strutturati per pagina, 20 dal modello, 200 eventi/corsa.
- `office_events` conserva solo nuovi eventi e fonti, con unicità, CHECK su tipi,
  date, score e scadenze. `report` «Eventi e bandi», ordinato per scadenza; una
  proposta `task` per evento con scadenza nei prossimi 30 giorni, anche se già
  noto da una corsa precedente. Non ripropone decisioni approvate/rifiutate. Il clic di
  approvazione crea **una sola** attività standalone: contact_id null, type todo,
  area speaqi, data locale della scadenza e chiave `office-event:<id evento>`.
  Rifiutare non crea attività; una scadenza ormai trascorsa non si approva.
- Migration **`20261023120100_office_events.sql`**, dopo
  `20261023120000_office_entity_enricher.sql`, `20261023090000_office_db_cleaner.sql`
  e i prerequisiti To Do già presenti. La funzione `decide_office_output` conserva
  il testo dei rami Direttore/05/08, aggiungendo solo il ramo del 06. RLS proprietario
  di sola lettura, scritture solo via RPC service role con search_path fisso;
  eventi e batch inclusi in entrambi i backup. Nessuna applicazione a DB operativi.
- Nessun invio, iscrizione o modifica a trade_fair_exhibitors. Nessuna chiamata
  alle mappe e nessuna prova su dati di produzione. Test su due pagine salvate,
  modello simulato e PostgreSQL locale con DDL originali, compresi i prerequisiti
  del vero merge 05. Le decisioni si provano anche con otto clic concorrenti.
## Ufficio — Arricchimento enti (Agente 08)

- `entity_enricher`, reparto Ricerca, ogni mattina alle 06:00 Europe/Rome (`office-entity-enricher`), nasce spento.
  Budget 200/1000/4000 centesimi giorno/settimana/mese, modello del registro via `callModel`. Nessuna nuova env.
- **Da dove parte**: le città con la superguida da fare e priorità 1-2. Oggi la priorità sta sui porti
  (`tourism_hubs`, ~325 righe, nessuna ancora collegata a una destinazione), più le `tourism_destinations` quando
  ci saranno. Città = `destination` del porto, altrimenti il nome o quello fra parentesi («Pireo (Atene)» → Atene),
  con i nomi locali di `EXONYMS` (Marsiglia → Marseille) e gli alias del luogo nel catalogo. Napoli esclusa ovunque.
- **L'ente lo cerca solo nel catalogo** Tourism Intelligence (`matchOrganization`): stesso paese, tipo dmo/cvb/
  local_office/rto/municipality, la città come parola intera nel nome o negli alias («Valenciana» non è «Valencia»),
  un sito, non disabilitato. Una città senza ente finisce nel resoconto («va aggiunto a mano»): nessuna ricerca web,
  nessun ente inventato. Esclusi gli enti già nel CRM, quelli con una proposta in attesa o approvata, rifiutati da
  meno di 90 giorni, o letti negli ultimi 30. Massimo 10 enti per corsa.
- **Legge il sito** con il fetch sicuro della ricerca (`fetchResearchPage`, redirect ricontrollati): la home e al più
  due pagine di contatti dello stesso sito, piè di pagina compreso (`pageTextFromHtml`). Il modello (JSON strict)
  propone identità, legame con la città (COVERS/MANAGES/PROMOTES), email, telefono e il **ruolo** di chi decide (mai
  il nome della persona), ciascuno con la frase.
- **Il codice decide** (`validateEnrichment`, puro): una frase vale solo se sta alla lettera in una pagina letta,
  il valore deve stare nella frase, l'identità deve nominare l'ente e il legame la città. Solo caselle d'ufficio
  (`isInstitutionalEmail`: info@, turismo@…; niente nome.cognome, niente PEC). **Un campo già pieno non si propone.**
  Pronto = identità + legame + un recapito (nuovo o già presente).
- **Nessuna scrittura prima del clic**: l'agente prepara solo `proposal` (`action: enrich_entity`) e il resoconto.
  Approvando, `office_enrich_entity` (dentro `decide_office_output`, una transazione) agisce **a nome del titolare**
  (`request.jwt.claim.sub` = chi approva: le prove sono quelle che ha letto nella proposta): riempie solo i campi
  ancora vuoti (`kept` dice cosa è stato trovato pieno), scrive le prove VERIFIED (`method = 'ai'`, `verified_by` =
  titolare), mette l'ente VERIFIED, trova o crea il luogo (verificato con la stessa frase), scrive la relazione,
  porta l'ente nel CRM con **`tourism_promote`** (stesse regole del pulsante: nome ambiguo, email già usata, match da
  rivedere fermano tutto) e lo accoda alle Presentazioni (`{entity_id, destination_id}`). Se qualcosa fallisce non
  resta niente: la proposta torna in attesa con il motivo (409 `enrich_failed`). Il guard del catalogo toglie la
  verifica alle prove vecchie quando cambia un campo: valgono le nuove.
- Migration **`20261023120000_office_entity_enricher.sql`**, dopo pulizia e presentazioni: `office_enrich_entity` e
  `decide_office_output` ridefinita con i rami Direttore e Pulizia identici. RPC solo `service_role`. Nessuna tabella nuova.
- Test: `office-entity-enricher.unit.test.ts` (città, ente, email d'ufficio, dato senza prova scartato, campo pieno
  non sovrascritto, handler senza scritture, Napoli mai letta, budget) e `office-entity-enricher.db.test.ts`
  (migration vere del catalogo: approvazione completa, campo riempito nel frattempo, rollback se il CRM rifiuta,
  otto clic insieme, permessi).

## Ufficio — Lingue e voce (Agente 03)

- `languages_voice`, reparto Mappe, ogni notte alle 02:00 Europe/Rome (`office-languages-voice`),
  nasce spento. Budget 15 €/giorno (6.000/20.000 centesimi settimana/mese): la voce è circa l'80% del costo.
- **Non riscrive la pipeline: la chiama.** Solo tre chiamate a Speaqi con `SPEAQI_API_KEY` su
  `SPEAQI_PUBLIC_API_URL`: `GET /maps/:id/studiomap/status`, `GET …/translations` e
  `POST …/translations/fill` (prima `dry_run`, poi il lancio). Mai sync, pubblicazione o
  "rigenera audio". Senza la chiave l'agente non fa niente e lo dice.
- **Coda** in `settings.queue`: la riempie il Direttore (proposte «Completare le lingue» approvate,
  `target_id` = id della mappa Speaqi) o il titolare (`{ "map_id": "<uuid>" }`). Al massimo 6 mappe
  per notte. **Napoli è esclusa** su nome, slug e slug StudioMap (`officeIsNaples`), sia in coda sia
  dopo aver letto la mappa da Speaqi: se ci arriva con un altro nome non parte nessuna chiamata di lancio.
- **Decisione** (`launchOptions`, puro): `dry_run` con `include ['missing','failed','stuck']` →
  stima in dollari → euro con `settings.usd_to_eur` (poi `OFFICE_USD_TO_EUR`, default 1, prudente).
  Si prova a prenotare tutto; se non ci sta, solo i testi (che costano poco, e sono in differita
  se la mappa lo prevede) e l'audio aspetta la notte dopo, scritto nel riepilogo. Senza stima non si
  lancia niente. `request_id` deterministico (corsa + mappa + tipo): un ritentativo non raddoppia il lavoro.
- **Costo**: si salda la **stima** di Speaqi al lancio, dichiarato nel resoconto. Il costo vero dei
  testi in differita sta in `translation_batches.cost_usd` su Speaqi e l'API non lo espone ancora.
- **Le traduzioni da aggiornare (outdated) non partono mai da sole**: diventano una `proposal`
  (`action: refresh_outdated`) col costo stimato; approvata, la notte dopo l'agente le lancia una
  volta sola entro il budget (segno `languages:outdated-launched:<proposta>`).
- **Controllo dei progressi**: il resoconto della notte (`languages:night:<giorno>`) salva per mappa
  le percentuali. Se una mappa online lanciata ieri non è salita e su Speaqi non c'è niente in
  lavorazione, non si rilancia: si segnala da controllare. Una mappa con un'esecuzione già in corso
  si salta. Riga tipo «Capri: 11 lingue, testi 1.240/1.260, audio 980/1.260, speso 9,40 € (stima)».
- Nessuna migration. Test: `office-languages.unit.test.ts` (coda e Napoli, budget tutto/solo
  testi/niente, outdated solo su approvazione e una volta, niente rilancio senza progressi, installazione).

## Ufficio — Ordini al Direttore (Prompt 14 e 15)

- **Dove si scrive**: la casella «Scrivi al Direttore» in testa al pannello di `/ufficio` (e di `/ufficio/agenti`) (testo, fino a 4 foto, microfono che passa da `POST /api/ai/transcribe`) e il bot Telegram. `POST /api/office/director/orders` (solo titolare) salva l'ordine **prima** di qualunque lavoro e risponde 202; il lavoro parte dopo e la pagina segue lo stato ogni 3 secondi. `GET` dà gli ultimi 20.
- **Il lavoro è una corsa del Direttore** con chiave `order:<id>` (`processDirectorOrder`, `src/lib/server/office-director-orders.ts`): interruttore del Direttore rispettato (spento = l'ordine risponde «accendilo»), budget prenotato da `callModel`, una sola elaborazione per ordine (passaggio condizionato `received → working`). `callModel` accetta ora immagini (`images`, data URL JPEG ridotte a 1280 px): ognuna si prenota con `OFFICE_IMAGE_RESERVE_TOKENS`.
- **Il modello propone, il codice decide** (`src/lib/office/director-orders.ts`, puro e testato): JSON Schema strict con un'intenzione fra `new_contact`, `build_map`, `check_map`, `presentation`, `status`, `task`, `unknown`. Un dato del contatto entra solo se sta scritto nell'ordine o nella trascrizione del bigliettino (senza foto la trascrizione non vale), email/telefono/sito validati, il tipo (destinazione / partner / agenzia / cliente mappe / dubbio) lo decidono regole scritte (`decideCategory`), un link My Maps vale solo se è nell'ordine, **Napoli rifiutata** per mappe e presentazioni. Le risposte al titolare le scrive il codice, non il modello.
- **Cosa fa ogni intenzione**: `new_contact` → solo una proposta `create_contact` in «Aspetta te», con la riga del bigliettino accanto a ogni dato, i possibili doppioni (email, telefono, azienda) e l'ente del catalogo Tourism se è una destinazione; `build_map`/`check_map` → coda di `mymaps_builder`/`maps_quality`; `presentation` → coda di `presentations` se l'ente (o l'azienda del contatto) è nel catalogo, altrimenti di `agency`; `task` → una o più attività To Do standalone (al massimo 10, `idempotency_key director-order:<id>:<n>`), e quelle con un giorno anche in **Google Calendar** (vedi sotto); `status` → pipeline, preventivi in attesa, follow-up scaduti, ultime attività, agenti e spesa, **numeri calcolati dal codice** (`directorStatusLines`).
- **Code** (`office_director_queue`, RPC solo service role): elenco chiuso `mymaps_builder`, `maps_quality`, `presentations`, `agency`; voce con la stessa chiave non si ripete; Napoli rifiutata anche qui. Un agente **acceso** che riceve lavoro parte subito in background (`startQueuedAgents`, nel suo budget); uno spento resta in coda e la risposta lo dice. `agency` (prompt 13) finché non esiste risponde «non installato».
- **Il clic su «Inserisci il contatto»** (`approveDirectorContact`, intercettato in `PATCH /api/office/outputs/[id]` prima di `decide_office_output`): `office_director_contact_claim` fa lavorare una richiesta sola, il contatto nasce con `createLeadFromInput` (trattativa, primo follow-up, attività «Arrivato dal Direttore») e `legacy_id = office-director:<id uscita>` (unico per workspace: un nuovo tentativo lo ritrova), poi la coda secondo il tipo (destinazione → Presentazioni, agenzia → Agenzia, partner → `is_partner`), infine `office_director_contact_done` segna l'uscita approvata. `decide_office_output` non è stato toccato: approvare da lì una proposta `create_contact` viene rifiutato. Nessuna email parte.
- **Il lavoro passato agli agenti non resta un «parte adesso»**: `startQueuedAgents` ora aspetta le corse e `reportQueuedWork` scrive sull'ordine un blocco «Esito:» (riepilogo della corsa e uscite create, `queuedWorkReport` in `src/lib/office/director-orders.ts`, puro e testato) e lo manda su Telegram (`requiredChannel: 'telegram'`, un invio fallito non rompe niente). La pagina continua a rileggere gli ordini per 4 minuti dopo la chiusura per mostrarlo. Una presentazione per un ente **non verificato** non viene nemmeno accodata: il Direttore risponde subito `waiting_you` con il motivo (`unverifiedEntity`), invece di dire «parte adesso» e fermarsi in silenzio
- **Correzioni dall'audit del 24/10** (`docs/UFFICIO-AUDIT-2026-10-24.md`, analisi esterna): la rotta `/api/automation/agents/[id]/run` risponde **502** quando la corsa è `failed` (prima 200, e il pianificatore la registrava riuscita senza avviso); il bridge StudioMap riporta il motivo dell'errore; `runAgentWhenFree` fa aspettare (fino a 3 minuti) un ordine o un lavoro quando l'agente è occupato, invece di farlo fallire; un'approvazione in «Aspetta te» che accoda lavoro (proposte mappe del Direttore, ente arricchito → Presentazioni) avvia subito il destinatario acceso (`startAfterApproval`) con esito su Telegram; l'intenzione `events` («quali sono le prossime fiere?») risponde con `office_events` o dice perché non ci sono (`directorEventsReply`), invece di creare un To Do; la spesa degli agenti mostra i centesimi. Migration **`20261024140000_office_queue_update.sql`**: riaccodare lo stesso lavoro con un dato nuovo (il link My Maps che mancava) aggiorna la voce (`reason: 'updated'`, `revisions`), un campo null non cancella quello di prima. Il codice funziona anche prima della migration (risponde «già in coda» come prima). My Maps fa un import **per mappa** e per turno (`nextMapToImport`, chiave `mymaps:<turno>:<mappa>`); Lingue prende sei mappe a rotazione (`nightWindow`), così la settima non resta fuori per sempre
- **«Fammi la fattura per PREV-…»** (intenzione `invoice`): non è più un To Do. Il numero del preventivo lo legge il codice dall'ordine (`directorQuoteNumber`), altrimenti si cerca per cliente fra i preventivi non annullati. Su un preventivo **pagato o accettato** (`quoteIsInvoiceable`, la stessa regola di Fatture) prepara la bozza con `createInvoiceDraftFromQuote` (idempotente: ritrova quella che c'è) e risponde con quello che manca per lo SDI (`invoiceProblems`) e il link a `/fatture?invoice=<id>`. Su uno inviato e non approvato non fa niente: dice lo stato e la frase da scrivere. **«SNAV ha approvato PREV-…, fai la fattura»**: il modello propone `quote_approved`, ma vale solo se l'ordine contiene davvero una parola di approvazione (`QUOTE_APPROVAL`); allora il preventivo passa da bozza/inviato ad **accettato** (UPDATE condizionato, riconosciuto rileggendo `accepted_at`, attività sul contatto) e subito dopo nasce la bozza. Mai «pagato», mai annullato. Un nome capito male da un vocale mostra i preventivi in attesa. Gli abbonamenti con carta no: la loro bozza nasce dal pagamento (Stripe), farla prima la raddoppierebbe. **Non invia mai allo SDI.**
- **Bozza della fattura all'accettazione** (`invoiceOnAcceptance`, `src/lib/server/quote-acceptance-invoice.ts`): quando un preventivo diventa accettato — firma o spunta del cliente sul link pubblico (`/api/quotes/public/sign`, `accept-contract`) o stato cambiato nella scheda (`PATCH /api/quotes/[id]`) — la bozza si prepara da sola e il titolare la riceve su Telegram con quello che manca per lo SDI. Idempotente (una bozza per preventivo), mai per gli abbonamenti con carta, non lancia mai: la firma o il salvataggio restano riusciti anche se la bozza non nasce. Migration `20261025120000_office_director_intents.sql` (vincolo con `events` e `invoice`: prima un ordine «events» non riusciva a salvare l'esito e restava «in lavorazione»); senza migration l'esito si salva comunque, senza intenzione.
- **Comandi aggiunti a ottobre 2026** (elenco completo per il titolare in `docs/DIRETTORE-COMANDI.md`, e il Direttore lo ripete con l'intenzione `help`, «cosa posso chiederti?», testo in `directorHelpText`):
  - **`find_partners`** («trovami 5 partner per Venezia», max 10, `findPartners`): prima il catalogo (tipi partner più `accommodation`/`transport`, città nel nome, nella descrizione o in `hq_city`, anche col nome straniero di `EXONYMS`), poi la ricerca web (`partnerSearchPrompt` + `PARTNER_SEARCH_SCHEMA`) per quelli che mancano. Un sito proposto dal modello vale solo se letto e se nomina l'azienda (`siteMatchesEntity`); l'email solo del suo dominio (`emailFromSite`). Saltati chi è già nei contatti, collegato in `tourism_crm_links` o già proposto. Ogni partner è una proposta `create_contact` con `category: 'partner'`: il contatto nasce solo col clic (`approveDirectorContact`, opportunità di distribuzione).
  - **`add_entity`** («aggiungi Venezuela Tourism a Tourism Intelligence e ai contatti»): ritrova l'ente o lo inserisce (paese ISO e tipo dal modello, validati; sito solo se scritto nell'ordine), poi `activateEntityForOrder`. Per un ente nazionale la «città» è il paese (`countryName`).
  - **Più presentazioni** (`targets`, al massimo 5, Napoli tolta) e **«preparami 5 presentazioni di destinazioni»** (`count` senza nomi → `autoDestinationPresentations`: enti dmo/nto/cvb/rto con un sito e senza deck, prima la priorità, solo con una città leggibile dal nome o già verificati, fino a tre tentativi per posto). L'agente Presentazioni ora genera fino a `settings.max_per_run` deck per corsa (default 5, era 2 fisso).
  - **Presentazione partner** (`audience: 'partner'`, `partnerPresentation`): base `PARTNER_DECK_TEMPLATE` (`partner-2026-10`: QR con commissione, codici a tempo, vetrina, portale, condizioni da `{{prezzo}}`), scelta per deck con `input.modello = 'partner'` (`templateForDeck`, anche dal modulo «Crea la presentazione» → «Per chi è»). La genera il Direttore nel suo budget (`officeDeckAgent`), id fisso per ordine e nome; le condizioni restano `[DA VERIFICARE]` e bloccano l'approvazione finché il titolare non le scrive.
  - **Presentazione per un ente che non c'è** («la presentazione di Sibiu, il contatto è Simina Manea, Sibiu County Tourism Association»): il target è l'organizzazione, non la persona; se l'organizzazione (scritta o del contatto) non è nel catalogo e ha un nome da ente del turismo (`looksLikeTourismBody`) o il modello ne dà il tipo, `presentationTarget` la aggiunge (`ensureCatalogEntity`, la stessa di `add_entity`) e la attiva. Il paese: dall'ordine, dal contatto o dal dominio nazionale dell'email (`emailCountry`, `.ro` → RO, i domini generici no); senza, lo chiede. Prima andava all'agente Agenzia, che non è installato. **Il contatto che c'è già si collega all'ente, non se ne crea un altro**: `activateEntityForOrder` passa `contact_id` a `tourism_activate` (migration `20261025150000_tourism_activate_link_contact.sql`: contatto dello stesso workspace, collegamento in `tourism_crm_links` come «Conferma collegamento», attività sul contatto, `contact_linked` nella risposta; un ente già collegato a un altro contatto torna come `crm_error`). Vale anche per `add_entity` quando nel CRM c'è un solo contatto con quell'organizzazione (`contactOfOrganization`). Senza la migration il `contact_id` si ignora e si torna al vecchio comportamento.
  - **`rename_entity`** («rinomina X in Y», anche «…e fammi la presentazione, sito …»; campo `new_name` dello schema): `renameEntity` ritrova l'ente, cambia il nome con un UPDATE condizionato su `version` come la PATCH di `/api/tourism`, mette il vecchio nome fra gli `aliases` e riempie il sito solo se vuoto. Il trigger `tourism_entity_guard` toglie la verifica a un ente che cambia nome: la risposta lo dice, e con `then_presentation` `presentationFor` lo riattiva subito (per `nto`/`ministry` la «città» è il paese). Stesso nome nello stesso paese → 23505 → «c'è già». Napoli no. Migration `20261025170000_office_director_rename.sql` (vincolo dell'intenzione), prima del codice; senza, l'esito si salva senza intenzione.
  - Il link `/tourism?entity=<id>` apre la scheda dell'ente. Migration `20261025140000_office_director_intents_more.sql` (vincolo con le tre intenzioni nuove), prima del codice.
- **Le domande del Direttore si riprendono** (ottobre 2026): quando l'attivazione di un ente si ferma per un dato che non trova (sito, città, paese), l'ordine resta `waiting_you` e salva in `interpretation.awaiting` cosa manca e la frase da completare (`{ need: 'site'|'city'|'country', resume: 'presentazione per X' }`; per `add_entity` senza presentazione `resume` è «aggiungi X a Tourism Intelligence e ai contatti»). Il messaggio dopo, dalla stessa parte (stessa chat Telegram, o la pagina), se è la risposta (`directorFollowUp`: un indirizzo per il sito, una parola o due per città e paese, niente che sembri un altro lavoro) diventa «<resume>, sito …» e si lavora così (`pendingDirectorQuestion`, solo l'ultimo ordine, entro `AWAITING_TTL_MS` = 24 ore); l'ordine di prima passa a `done` e il nuovo porta `resumed_from`. Su Telegram la risposta va al Direttore anche senza «Direttore» davanti, e il messaggio della domanda finisce con «Rispondimi qui» invece del rimando all'Ufficio. Prima la risposta era un ordine nuovo senza contesto, e il Direttore chiedeva «cosa vuoi che faccia con questo sito?». Anche le domande «per chi?» si riprendono (`need: 'target'`, `resume` con `{}` al posto della risposta): «Per chi devo preparare la presentazione?» → «Ministerio del Turismo de Venezuela» diventa «presentazione per Ministerio del Turismo de Venezuela»; lo stesso per la città dei partner, l'ente da aggiungere, il suo paese e il preventivo da fatturare. Un `unknown` con `awaiting` resta `waiting_you`, senza il resto è `failed` come prima. Nessuna migration: `interpretation` è jsonb. Con `add_entity` il nome dell'ente non tiene la persona del bigliettino (`organizationName` toglie `contact.name` in testa o in coda) e `then_presentation` fa partire anche la presentazione appena l'ente è attivo.
- **Telegram** (`/api/integrations/telegram/webhook`): va al Direttore un messaggio che comincia con `/direttore` o «Direttore», **ogni foto** (al To Do non serve) o tutto se `office_agents.settings.telegram_mode = 'director'` del Direttore (`telegramDirectorRoute`). Il vocale si trascrive prima. Restano le garanzie del bot: 200 sempre, `update_id` unico prima del lavoro, chat fuori elenco ignorate. Risposta immediata «Ricevuto, ci lavoro», poi quella del Direttore con il link a `/ufficio/agenti` quando serve un clic: un «sì» in chat non approva niente.
- **Pulsanti e PDF su Telegram** (ottobre 2026): le proposte nate da un ordine Telegram arrivano una per una con «✅ Approva / ✖️ Rifiuta» (`sendProposalsToTelegram`, `proposalMessage`); ogni presentazione generata (agente Presentazioni, presentazione partner del Direttore, o una già esistente richiesta di nuovo) arriva **in PDF anche in bozza** (`sendDeckToTelegram`, `src/lib/server/office-deck-telegram.ts`: stesso PDF di «Scarica il PDF», ripiego sul link se Chromium o Telegram non rispondono; `settings.telegram_pdf=false` sull'agente lo spegne) con «✅ Approva» solo se non restano `[DA VERIFICARE]`. Il tocco arriva come `callback_query` al webhook: segreto del webhook, chat in `TELEGRAM_ALLOWED_CHAT_IDS` e, fuori da una chat privata, anche chi tocca deve essere nell'elenco. Il dato del pulsante è una forma chiusa con UUID (`parseTelegramAction`, `src/lib/office/telegram-actions.ts`, puro e testato) e la decisione passa da `decideOfficeOutput` (`src/lib/server/office-output-decision.ts`), la stessa della rotta `PATCH /api/office/outputs/[id]`, o da `setApproval` del deck: regole e transazioni identiche al clic in pagina, decisioni condizionate quindi un doppio tocco trova «già decisa». Deciso, i pulsanti si tolgono dal messaggio. Un tocco vale come un clic; il testo libero no. `setWebhook` chiede ora `message` e `callback_query`; un webhook registrato prima si aggiorna da solo al primo messaggio (`ensureTelegramCallbacks`, legge `getWebhookInfo` e rifà la registrazione sullo stesso indirizzo). Le notifiche con pulsanti vanno a `TELEGRAM_NOTIFY_CHAT_ID`, altrimenti alla prima chat autorizzata (`telegramDeliveryConfig`). Test: `tests/telegram-actions.unit.test.ts`.
- **Cose da fare → To Do e Google Calendar** (ottobre 2026): «domani alle 15 chiamo Rossi, giovedì alle 10 riunione con SNAV per un'ora» è un ordine `task` con più voci (`tasks`: titolo, giorno, ora, durata). Il modello propone, `directorTaskItems` (`src/lib/office/director-orders.ts`, puro e testato) decide: giorno fra oggi e due anni e che esista davvero (il 30 febbraio no), ora `HH:MM` solo con un giorno, durata fra 5 minuti e 12 ore, doppioni tolti, al massimo `MAX_ORDER_TASKS` (10) e la risposta dice quante ne ha lasciate. Al modello si dà anche il giorno della settimana di oggi (`weekdayIt`), altrimenti «giovedì» si sbaglia. Ogni voce diventa una riga di `tasks` e, se ha un giorno, un evento sul calendario principale dell'account Google collegato al CRM (`addTaskToCalendar`, stessa connessione e stesso permesso `calendar.events` del pulsante «Calendar» del To Do; `calendar_event_id`/`calendar_event_link` sul task): all'ora detta nel fuso di Roma (`romeDateTimeToIso`, giusto anche al cambio d'ora), con la durata detta o 30 minuti; senza ora è un evento di **tutto il giorno** con promemoria alle 18 del giorno prima. Il task con l'ora salva l'istante in `due_date`; quello senza, il giorno, come le attività scritte a mano. Rilavorare l'ordine ritrova le righe e non ricrea un evento che c'è già. Calendar non collegato o che non risponde non toglie niente al To Do: la risposta lo dice (📅 in Calendar, 📝 solo To Do). **Nel To Do**: `calendarEventPayload` (`src/lib/server/gcal.ts`) fa di una data senza ora (`allDayOf`: «AAAA-MM-GG» o la mezzanotte UTC) un evento di tutto il giorno, anche per il pulsante «Calendar» — prima diventava un evento alle 01:00 di notte; in modifica la forma vecchia si azzera (`patch`), e se la scadenza non cambia (titolo, nota, avanzamento) l'evento tiene orario e durata (`keepTiming`). Il Direttore dice a Calendar se l'evento ha un orario (`allDay`), quindi anche l'01:00 d'inverno resta un orario; solo dal To Do, dove si deduce dalla scadenza, un'attività a mezzanotte UTC (l'01:00 d'inverno, le 02:00 d'estate) diventa di tutto il giorno: limite accettato. Una voce che non si salva non ferma le altre (⚠️ nella risposta); l'ordine fallisce solo se non se ne salva nessuna. «Stessa scadenza» per `keepTiming` è lo stesso istante, anche scritto in un'altra forma. I messaggi Telegram che **non** vanno al Direttore restano sul To Do vocale di sempre, senza Calendar.
- Migration **`20261024090000_office_director_orders.sql`**, prima del codice. Nessuna env nuova (`APP_BASE_URL` per il link in chat). La conversazione dal vivo (API Realtime) non è fatta: è il passo dopo, dietro un interruttore.
- Test: `tests/office-director-orders.unit.test.ts` (prove dei dati, tipo, Napoli, link, date, stato, Telegram, foto, prenotazione delle immagini) e `tests/office-director-orders.db.test.ts` (coda chiusa e senza doppioni con otto chiamate insieme, otto clic che inseriscono una volta, contatto di un altro workspace rifiutato, RLS degli ordini). Provato anche contro Postgres + PostgREST + storage veri (`tests/agency-stack/stack.sh up`) con modello e Telegram simulati: bigliettino → proposta → contatto con trattativa e follow-up → coda Presentazioni; stato, mappe, Napoli, To Do, Direttore spento.
