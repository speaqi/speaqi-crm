# Contract Management — Audit e architettura proposta

Data: 2026-10-26 · Branch: `vm/relaxed-brown-h2wigd` · Stato: **solo analisi, nessun codice modificato**

> Questo documento copre le Fasi 1–2 e le prime decisioni della Fase 3. Le clausole
> giuridiche non sono state scritte né proposte: restano a carico di chi le approva.

---

## 1. Relazione tecnica (Fase 1 — Audit)

### 1.1 Architettura generale
- Next.js 15 (App Router) + Supabase (Postgres, RLS, Storage). Deploy su Railway.
- Il CRM è un unico repo: `src/app/(app)` per l'area autenticata, `src/app/api` per le rotte,
  `src/lib/server` per la logica server-only, `supabase/migrations` (137 file).
- Pattern consolidati da riusare: RPC `security definer` riservate al service role, trigger di
  immutabilità, bucket Storage privati, Chromium per i PDF (`agency-pdf.ts`, `tourism-deck-pdf.ts`),
  chiavi di render HMAC, coda Ufficio con decisione atomica (`decide_office_output`).

### 1.2 Modulo preventivi
- Tabella `quotes`: numero, titolo, `items` jsonb, importi (`subtotal/discount/tax/total_amount`),
  `billing_interval` (`one_time` | `year`), stato `draft→sent→accepted→paid`, `payment_state`,
  `contract_terms text`, `contract_signer_name/email`, `contract_accepted_at`, `public_token`,
  `quote_acceptance_token`, `agency_project_id`, `sales_team_member_id`.
- Creazione: `src/lib/server/quote-create.ts` (`createQuoteRecord`), usata da `POST /api/quotes`,
  dal link vendita `/vendita/<token>` e dalle presentazioni Agency.
- Pacchetti in `src/lib/speaqi-quote-packages.ts` (PIATTAFORMA SPEAQI, VIDEO NELLA MAPPA).
- Pagina pubblica `/preventivo?id=TOKEN`: spunta di accettazione (`accept_public_quote_contract`) o
  firma disegnata (`QuoteSignatureForm`, `POST /api/quotes/public/sign`), con approvazione specifica
  del rinnovo (testo degli artt. 1341–1342 c.c. già in `signature.ts`).

### 1.3 Gestione clienti
- `contacts` (scope `crm` / `holding` / `personal`, `is_partner`, `hidden`), `deals` (trattative,
  una aperta per contatto e pipeline), `activities` (timeline, usata come log: non esiste un audit log
  dedicato). Scheda completa `/scheda/[id]` con sezioni per preventivi, firme, fatture.

### 1.4 Catalogo servizi
- Non esiste un catalogo servizi relazionale. I servizi sono: pacchetti hardcoded
  (`speaqi-quote-packages.ts`), categorie Agency (`agency_service_categories`, configurabili) e
  voci libere in `quotes.items`. Un contratto non può quindi dedurre "che tipo di servizio è" da
  una chiave stabile: oggi lo dedurrebbe dal testo.

### 1.5 Generazione PDF
- **Nessun PDF per il preventivo né per il contratto.** Il preventivo è una pagina web.
- PDF esistenti: proposte Agency (`agency-pdf.ts`, con PDF in cache su Storage, versionato per
  `AGENCY_DESIGN_VERSION`) e presentazioni Tourism (`tourism-deck-pdf.ts`). Entrambi usano
  `@sparticuz/chromium` + `puppeteer-core` e chiavi di render firmate per le bozze.
- **Riutilizzabile:** l'intera pipeline Chromium e il pattern "PDF per versione in bucket privato".

### 1.6 Gestione documentale
- Bucket Storage privati già usati: `agency-assets`, `tourism-deck-assets`, `backups`,
  `office-director`. Nessun bucket dedicato a contratti.
- Backup: dump JSON gzip + copia su R2 (`R2_BACKUP_*`), tabelle in `BACKUP_TABLES`.
  Le tabelle contrattuali **non** sono ancora nell'elenco.

### 1.7 Autenticazione
- Supabase Auth; owner = `auth.uid()`; collaboratori via `team_members`; area `allowed_areas`.
- Rotte pubbliche con token (`public_token`, `quote_acceptance_token`, link vendita con SHA-256).
- Sign RPC eseguibile solo da `service_role` (IP e user-agent arrivano dal server): corretto.

### 1.8 Database e relazioni (rilevanti)
- `quote_signatures` (1:1 con `quotes`): PNG firma, nome, email, IP, user-agent, `channel`
  (`email`/`in_person`), `terms_snapshot` (include `contract_terms` testuale), `amounts_snapshot`.
  Immutabile via trigger `quote_signatures_no_update`. RLS in lettura ereditata da `quotes`.
- `stripe_webhook_events`: idempotenza webhook.
- `invoices`: bozza da preventivo (`createInvoiceDraftFromQuote`), SDI via Aruba.
- `agency_presentation_versions`: versioni immutabili con trigger — **il pattern da replicare**
  per le versioni contrattuali.

### 1.9 Firma elettronica
- Firma **semplice** interna: PNG disegnato + nome + spunta + prove tecniche (IP, UA, timestamp).
- Non c'è un provider qualificato (SPID/CIE/OTP/firma digitale). Nessun hash del documento
  presentato: lo snapshot è del **testo dei termini e degli importi**, non del file firmato.
  Questo è il gap giuridico principale (vedi §1.11).

### 1.10 Workflow automatizzati e agenti AI
- Pianificatore interno (`automation-scheduler.ts`), idempotente con `automation_job_runs`.
- Hook post-accettazione: `invoiceOnAcceptance` (bozza fattura + avviso Telegram), non lancia mai.
- Agenti Ufficio (budget, coda `office_agent_outputs`, decisione atomica). **Finanza** prepara
  bozze e non invia SDI. **Commerciale** scrive bozze email `source=office`, mai invio.
  Il pattern "agente propone, umano approva, RPC decide" è già applicato e va esteso.

### 1.11 Criticità

| # | Criticità | Gravità | Evidenza |
|---|---|---|---|
| C1 | **Il testo contrattuale vive nel codice** (`DEFAULT_CONTRACT_TERMS` in `src/lib/quote-defaults.ts`) e viene copiato come testo libero in `quotes.contract_terms`. Nessuna versione, nessun id, nessun hash. | Alta | `quote-defaults.ts`, `quotes.ts` (`applyBillingRules`) |
| C2 | **Nessun documento contrattuale**: l'accettazione prova il testo, non un file. Il cliente non riceve una copia firmata. | Alta | nessun PDF di preventivo/contratto |
| C3 | **Firma semplice senza hash del documento** nelle prove (`terms_snapshot` non ha `sha256`). Integrità ricostruibile solo per confronto testuale. | Alta | `20260923101000_quote_subscription_signature.sql` |
| C4 | **Nessuna gerarchia contrattuale**: non esiste concetto di "Condizioni generali + specifiche". Il contratto è un blocco unico per preventivo. | Alta | schema `quotes` |
| C5 | **Il contratto è modificabile dopo l'accettazione** via PATCH del preventivo. La firma è protetta (trigger), il campo `quotes.contract_terms` no: il PDF futuro andrebbe generato dal campo vivo. | Alta | `src/app/api/quotes/[id]/route.ts` (da verificare nel dettaglio) |
| C6 | **Nessun audit log** delle modifiche a preventivi/condizioni. `activities` è timeline commerciale, non prova. | Media | ricerca `audit` vuota in `src/lib/server` |
| C7 | **Nessuna versione del preventivo**: il `quote_number` identifica il documento, non una revisione. | Media | `quotes` |
| C8 | **Clausole specifiche** (rinnovo 1341–1342) hardcoded in `signature.ts` e non versionate né associate al documento. | Media | `src/lib/server/quote-signature.ts` |
| C9 | **Backup**: le tabelle contrattuali (quando nascono) vanno aggiunte a `BACKUP_TABLES`; i bucket non sono nel backup. | Media | `src/lib/server/backup.ts` |
| C10 | **Il Chromium di produzione** richiede librerie di sistema (`pdf-runtime` nel Dockerfile): il PDF contrattuale eredita la stessa dipendenza operativa. | Bassa | `CLAUDE.md`, Dockerfile |

### 1.12 Componenti riutilizzabili

| Componente | Dove | Uso nel sistema contrattuale |
|---|---|---|
| Chromium PDF | `agency-pdf.ts`, `tourism-deck-pdf.ts` | Generazione PDF contratto |
| Chiave di render HMAC | `deckRenderKey` | PDF di bozza senza esporre il link |
| Versioni immutabili + trigger | `agency_presentation_versions` | `legal_document_versions`, `contract_versions` |
| Firma + prove | `quote_signatures`, `quote-signature.ts` | Estendere con hash documento e versione |
| RPC service-role atomica | `sign_public_quote_contract`, `decide_office_output` | Accettazione e approvazioni |
| Hook post-accettazione | `quote-acceptance-invoice.ts` | Diventa dispatcher di eventi idempotenti |
| Bucket privato | `agency-assets` (pattern) | Bucket `contract-documents` |
| Coda decisione | `office_agent_outputs` | Proposta di selezione contrattuale da approvare |

---

## 2. Architettura proposta (Fase 2)

### 2.1 Principi
1. **Motore ≠ contenuto.** Il codice sa *quali* documenti applicare e *come* comporre il PDF.
   Il *testo* delle clausole sta in `legal_document_versions`, creato e approvato da persona.
2. **Un documento approvato è immutabile.** Ogni modifica genera una nuova versione o un accordo integrativo.
3. **Un contratto è uno snapshot.** Al momento dell'invio si congela: documenti, versioni, importi,
   hash del PDF. Il preventivo può cambiare; il contratto inviato no.
4. **Gli agenti AI non scrivono mai clausole approvate.** Possono proporre bozze in `draft`
   nell'elenco di revisione; la pubblicazione è una RPC riservata a un owner con permesso `legal:approve`.
5. **Ogni passaggio rilevante è un evento idempotente** con chiave deterministica.

### 2.2 Componenti
```
Preventivo (quotes + items)
   │
   ▼
Contract Engine (puro, testato)            ← selectContractDocuments(items, package, flags)
   │  propone: [general, agency?, saas?, partnership?, dpa?, sla?] + precedenza
   ▼
Selezione per quote (contract_selections)  ← verificabile e modificabile dall'admin prima dell'invio
   │
   ▼
Snapshot contrattuale (contracts)          ← congela versioni + importi + hash
   │  render PDF (Chromium)
   ▼
contract_documents (PDF, sha256, bucket privato)
   │
   ▼
Invio (email con link) → firma (quote_signatures + hash) → contratto accettato
   │
   ▼
Eventi post-accettazione (contract_events, idempotenti)
   ├─ stato commerciale (quotes/contacts/deals)
   ├─ progetto operativo (Agency project / milestones)
   ├─ scadenze fatturazione (invoices bozza)
   ├─ servizi ricorrenti (Stripe, già esistente)
   └─ archiviazione (bucket + backup)
```

### 2.3 Gerarchia contrattuale (proposta, da approvare — vedi decisione D1)
1. **Condizioni Generali Speaqi** — sempre applicate.
2. **Condizioni Agency** — se nel preventivo c'è un servizio con `category` Agency.
3. **Condizioni SaaS** — se c'è un pacchetto a ricorrenza o piattaforma (`billing_interval = year`, PIATTAFORMA).
4. **Accordo di Partnership / Revenue Sharing** — solo se il contatto è `is_partner` o c'è una commissione Referly.
5. **DPA** — quando Speaqi tratta dati personali per conto del cliente (es. contatti importati, dati visitatori).
6. **SLA** — quando il cliente acquista un livello di servizio misurabile (decisione D6).
7. **Clausole particolari** — testo libero *ma* solo come **accordo integrativo** approvato, mai come campo libero del preventivo.

Precedenza in caso di conflitto: `Partnership > SaaS/Agency > DPA > SLA > Generali`, con clausola esplicita
"in caso di contrasto prevale il documento specifico" da scrivere nelle Generali (testo giuridico, non
generato da noi).

---

## 3. Schema dati (proposta)

Nuove tabelle. Le migration vanno scritte additive; nessuna modifica distruttiva a `quotes`.

```sql
-- Documenti giuridici (catalogo, uno per tipo)
legal_documents (
  id uuid pk, slug text unique,            -- 'general','agency','saas','partnership','dpa','sla'
  kind text check (kind in ('general','agency','saas','partnership','dpa','sla','integrative')),
  title text, active boolean, created_at timestamptz
)

-- Versioni: immutabili dopo 'approved'
legal_document_versions (
  id uuid pk, document_id uuid fk, version int,
  status text check (status in ('draft','in_review','approved','retired')),
  body_md text,                            -- testo approvato, non generato dall'AI
  body_sha256 text not null,               -- calcolato alla pubblicazione
  effective_from timestamptz, retired_at timestamptz,
  approved_by uuid, approved_at timestamptz, legal_review_ref text,
  unique (document_id, version)
)
-- trigger: UPDATE vietato se status in ('approved','retired'); DELETE vietato sempre.

-- Regole di applicabilità (non il testo)
legal_applicability_rules (
  id uuid pk, document_id uuid fk, when_service_category text null,
  when_package_slug text null, when_billing_interval text null,
  when_contact_flag text null, priority int, active boolean
)

-- Selezione per preventivo, verificata dall'admin prima dell'invio
quote_contract_selections (
  id uuid pk, quote_id uuid fk, document_version_id uuid fk,
  selected_by_engine boolean, overridden_by uuid null, override_reason text null,
  position int, unique (quote_id, document_version_id)
)

-- Contratto = snapshot inviabile di un preventivo
contracts (
  id uuid pk, quote_id uuid fk, revision int,
  status text check (status in ('draft','ready','sent','accepted','declined','expired','superseded','cancelled')),
  snapshot jsonb not null,                 -- parti, importi, scadenze, deliverable, versioni
  snapshot_sha256 text not null,
  pdf_path text, pdf_sha256 text,          -- bucket privato contract-documents
  created_at timestamptz, sent_at timestamptz, expires_at timestamptz,
  superseded_by uuid null,
  unique (quote_id, revision)
)

-- Approvazioni specifiche (artt. 1341–1342 c.c.)
contract_specific_approvals (
  id uuid pk, contract_id uuid fk, clause_ref text,       -- es. 'renewal','liability'
  document_version_id uuid fk, approved_text_sha256 text,
  signer_name text, approved_at timestamptz
)

-- Estensione firma (nuove colonne su quote_signatures, nullable per la retrocompatibilità)
--   contract_id uuid, contract_pdf_sha256 text, document_versions jsonb,
--   consent_version text, signer_identity_method text ('email_link'|'in_person'|'otp'|'qes')

-- Audit log append-only (nuovo: oggi non esiste)
contract_audit_log (
  id bigserial pk, occurred_at timestamptz default now(),
  actor_user_id uuid null, actor_kind text check (actor_kind in ('owner','team','public','agent','system')),
  entity text, entity_id uuid, action text, before_sha256 text, after_sha256 text,
  ip text, user_agent text, details jsonb
)
-- trigger: UPDATE/DELETE vietati.

-- Eventi post-accettazione idempotenti
contract_events (
  id uuid pk, contract_id uuid fk, kind text,           -- 'accepted','status_updated','project_created',...
  idempotency_key text unique not null,                 -- es. 'contract:<id>:accepted:v1'
  status text check (status in ('pending','done','failed','skipped')),
  attempts int, last_error text, created_at timestamptz, done_at timestamptz
)
```

RLS: lettura per `user_id` del proprietario (ereditata da `quotes`); `legal_document_versions`
leggibile a tutti gli owner ma scrivibile solo via RPC service role; `contract_audit_log` solo
inserimenti via RPC.

---

## 4. Matrice contrattuale (proposta)

| Servizio nel preventivo | General | Agency | SaaS | Partnership | DPA | SLA |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| PIATTAFORMA SPEAQI (una tantum) | ✓ | | ✓ | | ✓* | |
| VIDEO NELLA MAPPA (ricorrente) | ✓ | | ✓ | | ✓* | D6 |
| Categoria Agency (sito, branding, software…) | ✓ | ✓ | se SaaS | | se dati | |
| Commissione Referly / partner | ✓ | | | ✓ | | |
| Mappa a pagamento / pass | ✓ | | | se partner | ✓ | |
| Contatto `is_partner` con accordo | ✓ | | | ✓ | | |
| Manutenzione ricorrente | ✓ | se Agency | ✓ | | | D6 |

\* DPA da applicare dove Speaqi tratta dati personali del cliente: decisione D5.
Tutte le celle sono **proposte di applicabilità**, non clausole. Il motore le applica; un admin le conferma.

**Contratto misto.** Agency + SaaS = Generali + Agency + SaaS, con precedenza scritta nelle Generali.
Il motore restituisce sempre l'elenco ordinato e la motivazione di ogni inclusione (per l'admin e per il log).

---

## 5. Piano di implementazione (per fasi, con migrazione e rollback)

Ogni fase è additiva, dietro un flag `CONTRACTS_ENABLED=false` di default. Rollback = spegnere il flag;
le tabelle restano vuote o inerti.

| Fase | Contenuto | Output verificabile | Rollback |
|---|---|---|---|
| **A — Decisioni** | Approvazione delle decisioni D1–D10 (§6) e incarico legale | Verbale decisioni | — |
| **B — Fondazioni DB** | Migration `legal_*`, `quote_contract_selections`, `contracts`, `contract_audit_log`, `contract_events`; trigger di immutabilità; RLS; test su Postgres vero (come `tests/office.db.test.ts`) | Test db verdi, migration su e giù | `drop` delle nuove tabelle (nessuna è collegata a flussi esistenti) |
| **C — Motore** | `src/lib/contracts/engine.ts` puro: input = righe preventivo + flag; output = documenti ordinati + motivazioni. Test unit per tutte le celle della matrice | Test unit per i 10 scenari di Fase 8 | Il motore non è chiamato da nessun flusso finché il flag è spento |
| **D — Admin legale** | Pagina `/impostazioni/contratti` (solo owner): catalogo, bozze, revisione, approvazione (RPC), storico versioni. Testi **vuoti/segnaposto** finché il legale non li fornisce | UI verificata a schermo; approvazione impedisce modifica successiva | Pagina dietro flag |
| **E — Snapshot e PDF** | `createContractSnapshot` (congela), render PDF con Chromium riusando il pattern Agency, bucket `contract-documents`, `pdf_sha256` | PDF generato da prova; hash ricalcolato uguale | Il PDF è rigenerabile; il vecchio snapshot resta |
| **F — Selezione e revisione admin** | Sul preventivo: pannello "Contratto" con documenti proposti dal motore, override motivato, anteprima | Override tracciato in `contract_audit_log` | Flag |
| **G — Invio e firma** | Link contratto (non preventivo), firma con `document_id` + `sha256` nelle prove, copia firmata via email. Migrazione del flusso preventivo: il preventivo resta com'è finché il flag non passa | Firma di prova completa; ricostruzione delle 6 evidenze richieste dalla Fase 5 | Flag per tipo di flusso |
| **H — Eventi post-accettazione** | Dispatcher idempotente (`contract_events`) che richiama i moduli esistenti: stato, fattura (già esiste), progetto Agency, milestone, servizi ricorrenti | Doppio evento = un solo effetto (test) | Disattivare il dispatcher; eventi `pending` riprendibili |
| **I — Sicurezza e backup** | Aggiungere tabelle a `BACKUP_TABLES` e bucket a backup; retention; log di accesso ai PDF | Restore di prova su database vuoto | — |
| **J — Verifica e collaudo** | Scenari Fase 8 end-to-end, con avviso di legale prima della produzione | Report di test allegato | — |

**Non in questo piano:** firma qualificata (QES/SPID/CIE). Va decisa in D3 e richiede fornitore esterno.

**Nota operativa:** la migrazione Fase G non cambia i preventivi già firmati. Le firme esistenti restano
valide con i loro `terms_snapshot`; non vengono riscritte.

---

## 6. Decisioni da approvare

| # | Decisione | Opzioni | Raccomandazione |
|---|---|---|---|
| **D1** | Gerarchia contrattuale e precedenze | Vedi §2.3 | Adottare §2.3; precedenze scritte nelle Generali dal legale |
| **D2** | Testi giuridici: chi li scrive e chi li approva | Legale esterno / interno / misto | Legale esterno; Speaqi approva la versione finale; l'app non genera né riscrive clausole |
| **D3** | Tipo di firma | Semplice (attuale) / avanzata OTP / qualificata (SPID, CIE, firma digitale) | Avanzata OTP via email per i contratti; qualificata solo per i contratti oltre una soglia da fissare (decisione legale) |
| **D4** | Copia firmata al cliente | Sì con PDF sigillato / solo link | Sì, PDF con hash e riepilogo prove in coda |
| **D5** | DPA: quando applicare e chi lo sottoscrive | Sempre / solo se dati personali / su richiesta | Applicare quando Speaqi tratta dati di terzi per conto del cliente; testo dal legale |
| **D6** | SLA: esistono per Speaqi? A quali servizi | Nessuno / solo ricorrenti / tutti | Decidere prima della Fase D; in assenza, nessun SLA in contratto |
| **D7** | Modifica di un contratto già firmato | Nuovo contratto / accordo integrativo / nuova revisione | Accordo integrativo referenziato al contratto originale; mai riscrittura |
| **D8** | Chi può approvare una versione giuridica | Solo owner / owner + legale (ruolo) | Owner più firma di approvazione registrata (nome, data, riferimento legale) |
| **D9** | Retention dei documenti e dei log | Durata da fissare (es. 10 anni civile/fiscale) / ridotta | Fissare con il legale e il commercialista; oggi nessuna politica esiste |
| **D10** | Agenti AI: ambito | Solo bozze di revisione / anche suggerimenti di clausole | Solo bozze in `draft` di segnalazione; nessuna scrittura su versioni approvate (vincolo DB, non solo codice) |

Decisioni che sbloccano la fase successiva: **D1, D2, D3, D8**. Le altre possono seguire.

---

## 7. Test previsti (Fase 8, da realizzare in Fase J)

- Preventivo Agency (solo categoria Agency) → Generali + Agency.
- Preventivo SaaS (PIATTAFORMA o VIDEO NELLA MAPPA) → Generali + SaaS.
- Preventivo misto Agency + SaaS → Generali + Agency + SaaS, ordine e precedenza.
- Partnership (`is_partner` o commissione) → Generali + Partnership.
- Contratto con manutenzione ricorrente → SaaS + SLA (se D6 lo prevede) + verifica rinnovo 1341–1342.
- Modifica contrattuale → nuova revisione o accordo integrativo; il vecchio resta `superseded`.
- Mancata sottoscrizione → scadenza, nessun evento post-accettazione.
- Accettazione completata → firma con hash, PDF con hash, evento unico.
- Annullamento → stato `cancelled`, nessun evento, log presente.
- Errore di generazione o archiviazione → contratto resta `draft`, evento `failed` riprendibile, nessuna copia parziale.
- Versione approvata non modificabile (test db: UPDATE rifiutato).
- Agente AI non può pubblicare una versione (test db: RPC negata).
- Doppio clic su accetta → un solo evento (idempotenza).

---

## 8. Limiti di questa analisi

- Non ho eseguito test né avviato l'app: l'audit è letto dal codice e dalle migration.
- Il punto C5 (modifica del preventivo dopo l'accettazione) va verificato sulla rotta `PATCH /api/quotes/[id]`.
- Nessun testo giuridico è stato proposto o modificato. Il `DEFAULT_CONTRACT_TERMS` esistente è
  trattato come testo già in uso e non va toccato senza un processo di approvazione.
- Lo sviluppo (Fasi B–J) non è iniziato: le decisioni D1, D2, D3, D8 bloccano la scrittura di contenuti
  e della firma avanzata. Le fasi B e C possono partire appena D1 e D10 sono approvate.
