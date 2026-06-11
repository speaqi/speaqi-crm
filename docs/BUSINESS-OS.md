# Speaqi Business OS — Piano di Evoluzione Strategica

> Da CRM di gestione preventivi a **Business Operating System**: il centro di controllo
> di tutta l'azienda, capace di mostrare in tempo reale quanto l'azienda guadagna,
> quanto potrebbe guadagnare, dove cresce e quali azioni eseguire.

## Stato attuale (analisi del codebase)

Il CRM ha già fondamenta solide su cui costruire il Business OS:

| Asset esistente | Cosa abilita |
|---|---|
| `quotes` con campi finanziari completi (`total_amount`, `tax_amount`, `deposit_amount`, `payment_state`, `paid_at`, `sent_at`) | Fatturato reale, incassi, tempi di pagamento — senza nuove tabelle |
| `contacts` con `value`, `score`, `win_probability`, `industry`, `company_size` | Pipeline ponderata, scoring opportunità, segmentazione |
| `activities` + `/api/analytics` | Produttività team, costo commerciale per cliente |
| `lead_memories` + `ai_decision_logs` + endpoint `/api/ai/*` | Base per il Business Model Analyzer e l'AI CEO |
| `stage_transitions` | Funnel analytics, velocità di conversione per stadio |
| MCP server (`/api/mcp`) | Accesso AI a tutti i dati aziendali via tool |

**Limiti attuali**: nessuna nozione di costi (fissi/variabili), nessun ricavo ricorrente
(niente abbonamenti), nessun obiettivo formalizzato, nessuna previsione, dashboard
orientata all'operatività quotidiana ma non alla decisione strategica.

---

## Fase 1 — Financial Dashboard (✅ implementata)

Nuova area **`/finanza`** + API `/api/finance/overview` + tabella `business_goals`.

Calcolata interamente da dati reali già presenti (preventivi + pipeline):

- **Ricavi**: incassato totale (lordo/netto IVA), mese corrente, anno corrente, serie mensile 12 mesi
- **Previsioni**: entrate confermate (accettati non pagati), previsione 30 giorni
  (valore atteso ponderato dei preventivi aperti), pipeline trattative (lorda e ponderata)
- **KPI**: run-rate mensile/annuale (proxy MRR/ARR), win rate, ticket medio,
  ricavo medio per cliente, tempo medio di incasso, clienti paganti
- **Scoring opportunità**: ogni preventivo aperto ha una probabilità calcolata da
  stato, età, scadenza, score e win_probability del contatto → risponde a
  *"Quanto potrei fatturare nei prossimi 30 giorni?"* e *"Quali preventivi si chiuderanno?"*
- **Ricavi per prodotto**: classificazione dei line item (START/EXPERIENCE/SIGNATURE/Altro)
- **Top clienti**: chi sta comprando di più
- **Sistema Obiettivi**: target mensili/trimestrali/annuali su fatturato, nuovi clienti,
  preventivi inviati — con avanzamento %, marker dell'avanzamento atteso a oggi e
  flag automatico "a rischio" quando il progresso è sotto il 75% del previsto
- **Analisi automatica**: insight a regole (crescita/calo, preventivi fermi >30gg,
  concentrazione fatturato sul top client, copertura pipeline vs obiettivo, win rate)

### Probabilità di chiusura (euristica v1)

```
accettato non pagato        → 90%
inviato                     → 35% base
  + win_probability contatto (se impostata)
  + score/400 (max +25%)
  × 0.6 se inviato da >30gg, × 0.35 se >60gg
  × 0.5 se valid_until scaduto
bozza                       → 10%
clamp 2%–95%
```

Quando ci sarà storico sufficiente (≥50 preventivi decisi), sostituire con
regressione calibrata sui dati reali (per stadio, fascia importo, settore).

---

## Fase 2 — Costi, margini e Break Even (Area Business Plan)

Nuove tabelle:

```sql
cost_entries (id, user_id, category, label, amount, frequency        -- 'monthly'|'yearly'|'one_off'
              cost_type,                                              -- 'fixed'|'variable'
              variable_driver,                                        -- es. 'per_quote_paid', 'per_client'
              starts_on, ends_on)

revenue_lines (id, user_id, name, kind,                               -- 'one_off'|'recurring'|'usage'
               unit_price, unit_cost, billing_period, active, notes)  -- linee di ricavo attuali e future
```

Funzionalità `/business-plan`:

- **Modello di business**: linee di ricavo (esistenti, mappate sui pacchetti; future, simulate)
- **Costi fissi e variabili** con timeline di validità
- **Margine per linea/cliente**: ricavo − costi variabili attribuiti
- **Break Even Point**: `costi_fissi_mensili / margine_medio_unitario` → quanti
  preventivi/abbonamenti servono al mese, visualizzato come gauge vs run-rate attuale
- **Scenari previsionali** (prudente / realistico / aggressivo): tre set di parametri
  (win rate, ticket medio, nuovi lead/mese, churn) applicati a un motore di proiezione
  a 12-24 mesi; salvati in `forecast_scenarios` e confrontabili in un unico grafico
- **Obiettivi a cascata**: obiettivo annuale → trimestrali → mensili generati
  automaticamente e tracciati con il sistema della Fase 1

## Fase 3 — Customer Intelligence

Estensione della pagina contatto `/contacts/[id]` con un blocco "Valore cliente":

- Fatturato generato (somma preventivi pagati), storico preventivi e pagamenti
- Servizi acquistati (dai line item), attività svolte, contatti effettuati (già presenti)
- **CLV** e margine cliente (quando esistono i costi della Fase 2)
- **Suggerimenti upsell/cross-sell**: regole + AI — es. "ha START da 8 mesi e
  engagement alto → proponi EXPERIENCE"; "ha comprato il servizio X ma non Y che
  l'82% dei clienti simili acquista"
- API `GET /api/contacts/[id]/intelligence` che aggrega tutto in una scheda unica
  (riusabile anche dall'MCP server)

## Fase 4 — Business Model Analyzer + AI CEO

L'asset distintivo. Architettura:

1. **Snapshot giornaliero**: job (n8n → `/api/automation/business-snapshot`) che
   materializza in `business_snapshots` le metriche chiave del giorno (ricavi, pipeline,
   KPI, per prodotto, per settore) → trend storici senza ricalcoli pesanti
2. **Tool MCP finanziari**: esporre `finance_overview`, `customer_intelligence`,
   `goal_status`, `scenario_simulate` come tool del server MCP esistente → qualsiasi
   agente AI (incluso il voice command) può rispondere a "quale prodotto è più
   profittevole?", "dove stiamo perdendo denaro?"
3. **AI CEO Dashboard** (`/ceo`): report settimanale generato da OpenAI con accesso
   agli snapshot — SWOT (punti di forza/debolezza, rischi, opportunità),
   raccomandazioni azionabili (clienti da contattare, offerte da creare, attività da
   interrompere), salvato in `ai_decision_logs` per audit
4. **Simulatore "what-if"**: motore deterministico (non LLM) parametrizzato —
   *"cosa succede se acquisisco 50 comuni?"* = 50 × ticket medio segmento ×
   margine − costi variabili, proiettato sui 3 scenari; l'AI traduce la domanda in
   parametri, il motore calcola, l'AI spiega il risultato

## Fase 5 — Investor Dashboard + Export

- `/investor`: crescita clienti/fatturato MoM e YoY, retention, pipeline, previsioni
  annuali, KPI strategici — sola lettura, design "board-ready"
- **Export PDF** professionale (react-pdf o route con Puppeteer) con brand Speaqi
- Link pubblico con token a scadenza (stesso pattern di `public_token` dei preventivi)
  per condividere con soci/investitori senza account

## Fase 6 — UX: da "visualizzare dati" a "prendere decisioni"

Principi per il redesign:

- **Ogni numero ha un'azione**: accanto a "preventivi fermi >30gg" c'è "Genera follow-up"
  (riusa `email-drafts`); accanto a "obiettivo a rischio" c'è "Mostra le 5 opportunità
  che lo chiudono"
- **Home a tre livelli**: Oggi (operativo, esistente) → Finanza (tattico, Fase 1) →
  CEO (strategico, Fase 4)
- **Comando unico**: la barra vocale/testuale esistente diventa l'interfaccia
  trasversale ("quanto ho fatturato a maggio?", "crea obiettivo Q3 da 50k")
  instradata sui tool MCP
- **Alert proattivi**: gli insight critici della Fase 1 inviati via email/notifica,
  non solo mostrati a chi apre la pagina

---

## 10 funzionalità innovative ad alto impatto competitivo

1. **Revenue Autopilot** — quando la previsione 30gg scende sotto l'obiettivo mensile,
   il sistema genera automaticamente (in bozza) la lista di azioni che colmano il gap:
   follow-up sui preventivi a più alto valore atteso, upsell sui clienti caldi.
2. **Probabilità auto-calibrata** — il modello di scoring impara dallo storico reale
   dei preventivi chiusi/persi di Speaqi e mostra quanto è affidabile ("negli ultimi
   90 giorni le previsioni hanno sbagliato del ±12%").
3. **Margine in tempo reale sul preventivo** — mentre componi un preventivo vedi
   margine e contributo al break-even, non solo il totale: il pricing diventa una
   decisione informata.
4. **Simulatore "what-if" in linguaggio naturale** — "cosa succede se vendo Speaqi a
   100 cantine?" → proiezione immediata su ricavi, margini, BEP nei 3 scenari.
5. **Health Score cliente** — combinazione di engagement email, recenza contatti,
   pagamenti puntuali → previsione churn e lista "clienti da salvare questa settimana".
6. **Briefing vocale del lunedì** — l'AI CEO registra/sintetizza un audio di 2 minuti:
   come è andata la settimana, i 3 numeri che contano, le 3 azioni della settimana.
7. **Concentrazione e rischio** — indice di dipendenza da top client/settore con
   soglie di allarme: il CRM avverte *prima* che perdere un cliente diventi un problema
   esistenziale.
8. **Forecast di cassa** — non solo fatturato: usando acconti (`deposit_amount`),
   saldi e tempi medi di incasso, proietta la cassa a 90 giorni (il vero collo di
   bottiglia delle PMI).
9. **Benchmark interno per segmento** — confronto automatico win rate/ticket/ciclo di
   vendita tra settori (cantine vs comuni vs hotel) → "i comuni chiudono al 45% con
   ciclo 18gg: attacca quel mercato".
10. **Investor link "live"** — invece del PDF statico, un link sempre aggiornato con i
    KPI reali (con token revocabile): trasparenza verso soci come feature di prodotto.

## Roadmap consigliata

| Fase | Contenuto | Effort indicativo |
|---|---|---|
| 1 ✅ | Financial Dashboard + Obiettivi + Insight | fatta in questo branch |
| 2 | Costi, margini, BEP, scenari | 1-2 settimane |
| 3 | Customer Intelligence + upsell | 1 settimana |
| 4 | Snapshot + tool MCP + AI CEO + what-if | 2-3 settimane |
| 5 | Investor dashboard + PDF | 1 settimana |
| 6 | UX action-first trasversale | continuo |
