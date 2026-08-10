# Speaqi RevOps v2

**Versione:** v1
**Data:** 2026-08-09
**Dipendenza:** [SPEAQI-BUSINESS-MODEL.md](./SPEAQI-BUSINESS-MODEL.md)

Questa specifica definisce lifecycle, scoring, routing, pipeline, automazioni e dashboard del CRM sul nuovo modello commerciale. Il record operativo principale è il **progetto**; cliente, contatti e deal forniscono il contesto.

## 1. Lifecycle commerciale

Il CRM deve mantenere separati:

- **Lifecycle del lead/deal:** descrive il processo commerciale.
- **Lifecycle del progetto:** descrive disponibilità e stato del servizio.
- **Lifecycle dell'abbonamento:** descrive pagamento e rinnovo.

### Lifecycle lead/deal

| Fase | Ingresso | Uscita | Owner | SLA principale |
|---|---|---|---|---|
| Lead | Persona o organizzazione identificata | Fit minimo verificato | Marketing / Sales | Review entro 1 giorno lavorativo |
| Qualified | Problema, progetto plausibile e interlocutore identificati | Demo project creato o disqualifica | Sales | Primo contatto entro 4 ore per lead ad alta intenzione |
| Project Building | Progetto `demo` creato | Richiesta validazione | Customer success assistito / Sales | Nessuna demo senza prossimo passo oltre 7 giorni |
| Validation | Cliente richiede la pubblicazione | Approvazione trial o rilavorazione | Operations Speaqi | Presa in carico entro 4 ore; esito entro 2 giorni lavorativi |
| Trial | Progetto pubblico per 30 giorni | Proposta, negoziazione o sospensione | Sales + Customer success | Kickoff entro 1 giorno; check-in entro giorno 7 |
| Proposal | Offerta collegata al progetto inviata | Accettazione, revisione o perdita | Sales | Invio entro 2 giorni dalla decisione commerciale |
| Negotiation | Condizioni aperte | Won o Lost | Sales / Deal desk | Nessuna trattativa senza attività oltre 7 giorni |
| Won | Contratto/pagamento valido | Handoff completato e progetto `active` | Sales -> Customer success | Handoff nello stesso giorno |
| Lost | Decisione negativa | Recycling o archivio | Sales | Motivo perdita obbligatorio |

### Lifecycle progetto

| Stato | Owner | Evento di ingresso | Evento di uscita |
|---|---|---|---|
| `demo` | Cliente + Customer success | Creazione progetto | Trial approvato o archivio |
| `trial` | Customer success + Sales | Validazione e attivazione manuale | Active o Suspended |
| `active` | Customer success | Pagamento o accordo attivo | Suspended o Archived |
| `suspended` | Customer success + Finance | Scadenza, insoluto o decisione commerciale | Riattivazione o archivio |
| `archived` | Operations | Chiusura definitiva | Riapertura auditata |

### Lifecycle abbonamento

```text
pending -> active -> past_due -> active
                    -> cancelled
active  -> cancelled_at_period_end -> cancelled
```

Lo stato dell'abbonamento non deve modificare direttamente lo stato progetto senza passare da una regola esplicita e auditata.

## 2. Scoring

Il punteggio è calcolato sul progetto e composto da tre dimensioni.

### Fit cliente — massimo 40

| Segnale | Punti |
|---|---:|
| Azienda, territorio, ente o evento coerente con ICP | +10 |
| Pubblico internazionale o reale necessità multilingua | +8 |
| Patrimonio informativo ampio o distribuito | +7 |
| Necessità di QR dinamici o accesso contestuale | +5 |
| Più brand, sedi, percorsi o progetti potenziali | +5 |
| Decision maker o champion identificato | +5 |

### Readiness progetto — massimo 40

| Segnale | Punti |
|---|---:|
| Progetto creato | +5 |
| Struttura informativa definita | +5 |
| Contenuti principali inseriti | +8 |
| Lingue configurate | +4 |
| AI Concierge configurato e testato | +6 |
| Pagine/QR configurati | +4 |
| Checklist readiness completata | +8 |

### Intento commerciale — massimo 20

| Segnale | Punti |
|---|---:|
| Riunione commerciale prenotata | +5 |
| Richiesta informazioni su prezzo o contratto | +5 |
| Richiesta di validazione | +10 |
| Richiesta pacchetto video o accordo custom | +10, con massimo dimensione 20 |

### Penalità

| Segnale | Punti |
|---|---:|
| Nessuna attività per 30 giorni in `demo` | -10 |
| Nessun decision maker identificato | -5 |
| Contatti non validi o irraggiungibili | -15 |
| Progetto duplicato o test interno | Esclusione dallo scoring |
| Richiesta fuori perimetro prodotto | -30 |

### Soglie operative

| Punteggio / evento | Azione |
|---|---|
| 0-39 | Nurture e assistenza prodotto |
| 40-59 | Review commerciale e prossimo passo obbligatorio |
| 60-69 | Priorità alta; contatto entro 1 giorno lavorativo |
| >= 70 | Project Qualified Lead; assegnazione immediata |
| Richiesta validazione | PQL indipendentemente dal punteggio, salvo test/spam |
| Trial attivo | Deal aperto obbligatorio con owner e close date |

Lo scoring deve conservare separatamente i tre componenti, così il team distingue un cliente perfetto ma inattivo da un progetto molto attivo ma fuori ICP.

## 3. Routing

### Decision tree

```text
Nuovo lead o progetto
  |
  +-- Cliente esistente?
  |     +-- sì -> account owner esistente
  |
  +-- Progetto custom / grande volume video?
  |     +-- sì -> senior sales + deal desk
  |
  +-- Verticale con specialista assegnato?
  |     +-- sì -> specialista di settore
  |
  +-- Territorio o lingua con owner dedicato?
  |     +-- sì -> owner territoriale/linguistico
  |
  +-- altrimenti -> round-robin tra commerciali disponibili
        +-- nessuno disponibile -> coda generale con SLA 1 ora
```

### Regole

- Tutti i progetti dello stesso cliente mantengono lo stesso account owner, salvo eccezione motivata.
- Il project owner può essere diverso dall'account owner per competenza tecnica, settore o lingua.
- I lead multi-progetto e gli accordi custom non entrano nel round-robin standard.
- Ogni assegnazione registra regola applicata, owner precedente, nuovo owner e timestamp.
- Assenze, capacità e carico pipeline devono essere considerati prima dell'assegnazione.
- Deve sempre esistere un fallback owner o una coda visibile.

## 4. Pipeline configuration

| Fase | Campi obbligatori | Trigger automatici | Soglia stale |
|---|---|---|---:|
| Lead | fonte, cliente/contatto, owner | enrichment e task review | 3 giorni |
| Qualified | use case, fit, interlocutore | creazione task discovery | 7 giorni |
| Project Building | `project_id`, obiettivo, data prossimo passo | reminder readiness | 7 giorni senza attività |
| Validation | checklist, richiesta, owner operations | SLA validazione | 2 giorni lavorativi |
| Trial | start/end, owner, valore previsto, billing preference | reminder 14/7/3/1 giorni | 7 giorni senza interazione |
| Proposal | `quote_id`, importo, validità | reminder e task follow-up | 7 giorni |
| Negotiation | condizioni aperte, decision maker, close date | deal desk se custom | 7 giorni |
| Won | contratto/pagamento, subscription | attivazione e handoff | nessuna |
| Lost | motivo, concorrente/alternativa, note | recycling o archivio | nessuna |

### Motivi di perdita

- `PRICE`
- `NO_BUDGET`
- `NO_PRIORITY`
- `NO_DECISION`
- `PRODUCT_GAP`
- `TIMING`
- `COMPETITOR`
- `INTERNAL_SOLUTION`
- `UNREACHABLE`
- `OTHER`

### Motivi di sospensione progetto

- `TRIAL_EXPIRED`
- `PAYMENT_FAILED`
- `CUSTOMER_REQUEST`
- `COMPLIANCE_REVIEW`
- `SERVICE_TERMINATED`
- `OTHER`

## 5. Automazioni

### A. Registrazione e creazione progetto

1. Crea/aggiorna cliente e contatto.
2. Crea progetto `demo`.
3. Calcola fit score iniziale.
4. Assegna owner secondo routing.
5. Crea task di benvenuto/onboarding se fit >= 40.

### B. Readiness e validazione

1. Aggiorna readiness score sugli eventi prodotto.
2. A checklist completata, invita a richiedere validazione.
3. Alla richiesta, promuove il deal a `Validation`.
4. Crea task operations con SLA di 2 giorni lavorativi.
5. Se approvato, abilita il comando admin “Attiva trial”.
6. Se respinto, registra checklist di correzioni e follow-up.

### C. Trial

1. Imposta `trial_started_at` e `trial_ends_at` a +30 giorni.
2. Pubblica il progetto.
3. Porta il deal a `Trial`.
4. Invia email di avvio e crea kickoff.
5. Genera task commerciali ai giorni 7, 16, 23, 27 e 29.
6. Invia alert residui a 14, 7, 3 e 1 giorno.
7. Alla scadenza: `active` se coperto, altrimenti `suspended`.

### D. Preventivo e attivazione

1. Il preventivo deve avere `customer_id`, `project_id` e `deal_id`.
2. L'accettazione aggiorna il deal ma non attiva il progetto senza conferma economica valida.
3. Pagamento o accordo approvato crea/attiva `project_subscriptions`.
4. Il progetto passa ad `active`.
5. Sales chiude Won e passa il contesto a Customer success.

### E. Video

1. Acquisto pacchetto -> movimento `purchase` positivo.
2. Avvio job -> movimento `reservation` negativo dal disponibile.
3. Completamento -> movimento `consumption` e chiusura prenotazione.
4. Fallimento -> movimento `refund` o `release`.
5. Saldo sotto soglia -> task e proposta di riacquisto.

### F. Pipeline hygiene

- Alert al superamento della soglia stale di fase.
- Task urgente se manca il prossimo passo.
- Escalation al manager dopo una seconda violazione SLA.
- Close date spostata due volte -> revisione forecast obbligatoria.
- Deal perso senza motivo -> blocco chiusura.

## 6. Dashboard specification

### Marketing / Acquisition

| KPI | Fonte |
|---|---|
| Registrazioni | customers / contacts |
| Progetti demo creati | projects |
| Demo -> Validation | project transitions |
| Fonte dei PQL | contacts/deals source |
| Costo per PQL | spesa marketing + PQL |

### Sales

| KPI | Fonte |
|---|---|
| PQL -> Trial | deals + projects |
| Trial -> Active | project transitions |
| Win rate | deals |
| Tempo per fase | stage transitions |
| Pipeline ponderata | deals value × probability |
| Stale deals | deals + tasks |
| Forecast | deals + subscriptions |

### Customer success / Operations

| KPI | Fonte |
|---|---|
| Tempo creazione -> validation | projects |
| First-pass validation rate | validation events |
| Trial in scadenza | projects |
| Progetti suspended | projects |
| Tempo riattivazione | project transitions |
| Progetti per cliente | customers + projects |

### Finance / Executive

| KPI | Fonte |
|---|---|
| MRR / ARR | project_subscriptions |
| New / expansion / contraction / churn MRR | subscription events |
| Project churn / logo churn | projects + customers |
| Ricavo video | quote/order/ledger |
| Minuti venduti e consumati | video ledger |
| Prezzo e margine medio minuto | video revenue + processing costs |
| Revenue per project/customer | subscriptions + video + services |

## 7. Audit e data hygiene

- Ogni record commerciale deve avere `user_id` workspace e ownership coerente.
- Email, dominio, ragione sociale e partita IVA concorrono alla deduplicazione cliente.
- Le persone non devono essere duplicate per ogni progetto: usare `project_contacts`.
- Ogni transizione progetto, abbonamento e wallet deve essere auditata.
- I movimenti del ledger sono append-only; le correzioni avvengono con movimenti compensativi.
- Importi e minuti non devono essere derivati da testo libero delle righe preventivo.
- Le dashboard devono distinguere dati reali, stimati e forecast.

## 8. Ordine di implementazione

1. Entità `customers`, `projects`, `project_contacts` e audit.
2. Collegamenti a `deals`, `quotes`, `activities` e `tasks`.
3. Lifecycle progetto e validazione/trial.
4. Subscription layer.
5. Video package, wallet e ledger.
6. Preventivi v2 e rimozione del vecchio catalogo.
7. Dashboard e KPI.
8. Scoring, routing e automazioni avanzate.

Questo ordine evita di costruire automazioni su record che rappresentano ancora il contatto al posto del progetto.
