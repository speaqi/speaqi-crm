# Speaqi — Modello di business e dominio CRM

**Stato:** fonte di verità operativa
**Versione:** v1
**Data:** 2026-08-09

Questo documento traduce il modello commerciale Speaqi in regole implementabili nel CRM. In caso di conflitto, sostituisce i precedenti riferimenti a piani START, EXPERIENCE, SIGNATURE, PRO, Business o Enterprise.

## 1. Principi non negoziabili

1. Il **cliente** è l'anagrafica economica e relazionale.
2. Il **progetto** è l'unità commerciale, contrattuale e di misurazione.
3. Un cliente può possedere zero, uno o molti progetti.
4. Ogni progetto ha stato, trial, prezzo, contratto, abbonamento e consumi indipendenti.
5. Il piano standard è unico e include tutte le funzioni della piattaforma.
6. La produzione video AI è una linea di ricavo a consumo separata.
7. Il cliente vede minuti video; eventuali crediti e coefficienti restano interni.
8. Il trial pubblico non parte alla registrazione: parte dopo validazione manuale del progetto.
9. Le condizioni custom sono eccezioni commerciali sul progetto, non piani di prodotto aggiuntivi.

## 2. Modello economico

### Abbonamento piattaforma

| Voce | Regola |
|---|---|
| Unità di prezzo | Progetto |
| Mensile | 99 € / mese + IVA |
| Annuale | 990 € / anno + IVA |
| Risparmio annuale | 198 €, equivalente a due mensilità |
| Funzioni incluse | Contenuti, pagine web, QR dinamici, AI Concierge, traduzioni testuali, audio multilingua, hosting, analytics, aggiornamenti |
| Utenti | Non tariffati separatamente |
| Testi e audio | Inclusi |
| Video AI | Esclusi e acquistati separatamente |

### Produzione video AI

- Unità commerciale visibile: **minuto video**.
- I pacchetti contengono un numero di minuti e un prezzo totale.
- Il prezzo per minuto diminuisce con l'aumentare del volume.
- I listini dei pacchetti devono essere configurabili, non hardcoded nel frontend.
- Il consumo deve supportare movimenti di acquisto, prenotazione, elaborazione, rimborso, rettifica e scadenza eventuale.
- Il saldo pubblico è espresso esclusivamente in minuti.
- Il ledger tecnico può usare crediti, ma conversioni e saldi in crediti non devono apparire nell'interfaccia cliente, nei preventivi o nelle email.

### Accordi ad alto volume

Un progetto può usare `pricing_mode = custom` quando:

- il volume video è rilevante;
- il prezzo al minuto è negoziato;
- il canone piattaforma è incluso nel valore complessivo;
- sono presenti termini, durata o modalità di pagamento non standard.

Il CRM deve comunque scomporre internamente:

- valore piattaforma;
- valore video;
- minuti inclusi/acquistati;
- prezzo effettivo per minuto;
- eventuale sconto;
- margine stimato.

## 3. Ciclo di vita del progetto

| Stato | Significato | Pubblico | Ricavo ricorrente |
|---|---|---:|---:|
| `demo` | Progetto costruito gratuitamente, non ancora in trial | No | No |
| `trial` | Progetto validato e attivo per 30 giorni | Sì | No |
| `active` | Progetto coperto da abbonamento o accordo commerciale attivo | Sì | Sì o incluso in accordo custom |
| `suspended` | Progetto non pubblico per scadenza trial, mancato pagamento o decisione commerciale | No | No / in recupero |
| `archived` | Progetto concluso e conservato come storico | No | No |

### Transizioni consentite

```text
demo -> trial -> active
demo -> archived
trial -> active
trial -> suspended
active -> suspended
active -> archived
suspended -> trial     solo con nuova autorizzazione commerciale
suspended -> active    dopo pagamento o riattivazione
suspended -> archived
archived -> demo       solo tramite riapertura esplicita e auditata
```

### Regole del trial

- Durata standard: 30 giorni esatti.
- Attivazione: manuale, riservata al team Speaqi.
- Precondizione: progetto validato.
- Al momento dell'attivazione vengono registrati `trial_started_at`, `trial_ends_at`, validatore e timestamp.
- Alla scadenza, se non esiste un abbonamento/accordo attivo, il progetto passa a `suspended`.
- Tutte le transizioni devono generare un evento di audit.

## 4. Entità CRM target

### `customers`

Anagrafica azienda, ente o organizzazione. Contiene ragione sociale, dati fiscali, settore, dimensione, paese, proprietario commerciale e informazioni di fatturazione.

### `contacts`

Persone fisiche collegate a un cliente. Un contatto può partecipare a più progetti con ruoli diversi.

### `projects`

Unità commerciale fondamentale.

Campi minimi:

- `id`, `user_id`, `customer_id`, `name`, `slug`;
- `status` con i cinque valori canonici;
- `project_type`, `country`, `primary_language`;
- `commercial_owner`, `technical_owner`;
- `validation_status`, `validated_at`, `validated_by`;
- `trial_started_at`, `trial_ends_at`;
- `activated_at`, `suspended_at`, `archived_at`;
- `pricing_mode` (`standard` o `custom`);
- `billing_interval` (`monthly`, `yearly`, `custom`);
- `platform_fee`, `platform_fee_included`;
- `contract_start_at`, `contract_end_at`, `renewal_at`;
- `created_at`, `updated_at`.

### `project_contacts`

Relazione molti-a-molti tra progetti e contatti, con ruolo: champion, decision maker, billing, technical, content owner o altro.

### `deals`

La trattativa commerciale resta separata dal ciclo di vita del progetto. Ogni deal deve poter essere collegato a `customer_id` e `project_id`. Il deal descrive il processo di vendita; `projects.status` descrive lo stato del servizio.

### `project_subscriptions`

Registra l'abbonamento del singolo progetto: stato, intervallo, prezzo, periodo corrente, provider di pagamento, rinnovo, cancellazione e motivo.

### `video_minute_packages`

Catalogo configurabile di pacchetti: nome, minuti, prezzo, valuta, prezzo al minuto, validità e disponibilità commerciale.

### `project_video_wallets`

Saldo aggregato in minuti per progetto. È una cache derivata dal ledger, non la fonte contabile primaria.

### `video_minute_ledger`

Registro append-only dei movimenti. Ogni riga contiene progetto, tipo movimento, minuti, riferimento ordine/elaborazione, saldo risultante, eventuali crediti interni e motivazione.

### `quotes`

Ogni preventivo deve essere collegabile a cliente, progetto e deal. Le righe standard diventano:

- abbonamento piattaforma mensile o annuale;
- pacchetto minuti video;
- eventuali servizi professionali esplicitamente approvati;
- accordo custom con dettaglio economico interno.

## 5. Pipeline commerciale separata dallo stato progetto

Pipeline raccomandata:

| Fase deal | Criterio di ingresso | Criterio di uscita |
|---|---|---|
| Lead | Contatto o cliente identificato | Fit minimo confermato |
| Qualified | Esigenza e soggetto decisionale plausibili | Discovery completata |
| Project Building | Progetto demo creato | Progetto pronto per validazione |
| Validation | Richiesta di validazione ricevuta | Trial approvato o rilavorazione richiesta |
| Trial | Trial pubblico attivo | Decisione economica |
| Proposal | Preventivo inviato | Accettato, perso o revisione richiesta |
| Negotiation | Condizioni in discussione | Accordo concluso |
| Won | Progetto `active` | Handoff operativo completato |
| Lost | Opportunità chiusa | Motivo di perdita registrato |

Il deal può chiudersi, riaprirsi o essere sostituito; il progetto mantiene il proprio stato operativo indipendente.

## 6. Automazioni obbligatorie

### Costruzione e validazione

- Progetto creato -> stato `demo`.
- Richiesta validazione -> task al team Speaqi con SLA.
- Validazione respinta -> checklist di correzioni e follow-up.
- Validazione approvata -> possibilità admin di attivare trial.

### Trial

- Attivazione -> pubblicazione, date trial, attività CRM e email di avvio.
- Giorni residui 14, 7, 3 e 1 -> promemoria al cliente e task commerciale.
- Scadenza senza contratto -> sospensione automatica e task di recupero.
- Pagamento/accordo -> passaggio ad `active` senza interruzione.

### Abbonamento

- Pagamento riuscito -> rinnovo periodo e stato `active`.
- Pagamento fallito -> sequenza di recupero e alert.
- Cancellazione -> fine periodo e sospensione programmata.
- Rinnovo annuale imminente -> task commerciale e comunicazione preventiva.

### Video

- Acquisto -> accredito minuti nel ledger.
- Avvio elaborazione -> prenotazione minuti.
- Elaborazione completata -> consumo definitivo.
- Errore tecnico -> rilascio o rimborso dei minuti.
- Saldo sotto soglia -> alert e proposta di acquisto.

## 7. KPI canonici

### Acquisition e activation

- Nuovi clienti registrati.
- Nuovi progetti demo.
- Demo con richiesta di validazione.
- Tempo medio da creazione a richiesta di validazione.
- Percentuale di progetti validati al primo tentativo.

### Conversione commerciale

- Demo -> Trial.
- Trial -> Active.
- Tempo medio Trial -> Active.
- Win rate per settore, fonte e responsabile.
- Valore pipeline per progetto.

### SaaS

- Progetti active.
- MRR e ARR per progetto.
- Nuovo MRR, expansion MRR, contraction MRR e churned MRR.
- Logo churn e project churn distinti.
- Numero medio di progetti active per cliente.

### Video

- Minuti acquistati, prenotati, consumati e rimborsati.
- Ricavo video totale e per progetto.
- Prezzo medio effettivo per minuto.
- Costo e margine per minuto.
- Attach rate: progetti active che acquistano video.

## 8. Impatto sul CRM esistente

Elementi incompatibili da rimuovere o migrare:

- `src/lib/speaqi-quote-packages.ts`: pacchetti START/EXPERIENCE/SIGNATURE basati sul numero di video.
- `src/app/(app)/preventivi/page.tsx`: riga “Piano PRO Speaqi” e prezzi 490 €/299 €.
- `src/app/(app)/progetti/page.tsx`: i “progetti” sono attualmente contatti in stato `supertop`, `quote` o `preventivo`.
- Dashboard e Business OS che calcolano ricavi principalmente dai preventivi una tantum.

La migrazione deve essere additiva: introdurre clienti e progetti, collegare progressivamente deal/preventivi/task/attività e solo dopo rimuovere le cache basate su `contacts.status`.

## 9. Decisioni ancora da completare

- Fasce e prezzi ufficiali dei pacchetti minuti video.
- Regole di validità/scadenza dei minuti acquistati.
- Costo interno e rapporto crediti/minuto per ciascun modello video.
- Provider e flusso di fatturazione ricorrente.
- Regole di proration, rimborso e riattivazione.
- Visibilità del progetto durante lo stato `demo` e modalità di anteprima.
- SLA interno per la validazione del progetto.

Questi punti sono configurazioni mancanti, non motivi per mantenere il vecchio modello.
