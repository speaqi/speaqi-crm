# Speaqi Business OS — Piano di evoluzione v2

> Il centro operativo e finanziario di Speaqi deve misurare clienti, progetti, abbonamenti e minuti video secondo il modello commerciale definito in [SPEAQI-BUSINESS-MODEL.md](./SPEAQI-BUSINESS-MODEL.md).

**Versione:** v2
**Data:** 2026-08-09

## Regola guida

Il Business OS non considera più il preventivo una tantum o il contatto come unità economica principale. Le metriche e le automazioni partono dal **progetto**:

```text
Cliente
  -> uno o più Progetti
       -> Stato commerciale
       -> Deal e preventivi
       -> Abbonamento
       -> Wallet minuti video
       -> Ricavi, costi e margine
```

I vecchi pacchetti START, EXPERIENCE, SIGNATURE e il Piano PRO non fanno parte del modello v2.

## Stato attuale

Il CRM dispone già di asset riutilizzabili:

| Asset | Utilizzo nel modello v2 |
|---|---|
| `contacts` | Persone e stakeholder, da collegare ai clienti e ai progetti |
| `deals` | Pipeline commerciale, da collegare a cliente e progetto |
| `quotes` | Preventivi per abbonamenti, minuti video e accordi custom |
| `activities` e `tasks` | Timeline, SLA, follow-up e handoff |
| `stage_transitions` | Analisi del funnel commerciale |
| `business_goals` | Obiettivi su MRR, ARR, progetti e ricavi video |
| API AI e MCP | Automazioni e analisi basate sul nuovo dominio |

Gap principali:

- assenza di un'entità cliente separata dalle persone;
- assenza di una vera entità progetto;
- assenza di abbonamenti ricorrenti per progetto;
- assenza di trial e transizioni progetto auditabili;
- assenza di wallet e ledger minuti video;
- preventivi ancora legati al vecchio catalogo commerciale;
- dashboard finanziaria ancora orientata soprattutto ai preventivi una tantum.

## Fase 0 — Fondazione del dominio

Introdurre in modo additivo:

- `customers`;
- `projects`;
- `project_contacts`;
- collegamenti `customer_id` e `project_id` su deal, preventivi, attività e task;
- audit delle transizioni progetto.

La migrazione deve mantenere temporaneamente `contacts.status` come cache di compatibilità, senza usarlo per rappresentare lo stato del progetto.

### Risultato atteso

- Un cliente può avere più progetti.
- La stessa persona può partecipare a più progetti.
- Pipeline commerciale e stato operativo del progetto sono separati.
- Tutte le nuove funzionalità usano `project_id` come chiave economica.

## Fase 1 — Lifecycle Demo, Trial e Active

Implementare i cinque stati canonici:

- `demo`;
- `trial`;
- `active`;
- `suspended`;
- `archived`.

Funzioni:

- checklist di readiness;
- richiesta di validazione;
- validazione manuale da parte del team Speaqi;
- attivazione trial di 30 giorni;
- countdown e alert trial;
- sospensione automatica alla scadenza senza accordo;
- attivazione o riattivazione dopo pagamento;
- audit completo di attore, data e motivazione.

## Fase 2 — Subscription OS

Nuova tabella `project_subscriptions` e integrazione con il provider di pagamento.

### Piano standard

- 99 €/mese per progetto;
- 990 €/anno per progetto;
- tutte le funzioni incluse;
- nessun prezzo per utente;
- nessun tier di funzionalità.

### Funzioni finanziarie

- MRR e ARR per progetto;
- nuovo MRR, expansion, contraction e churn;
- stato pagamento e recupero insoluti;
- rinnovi mensili e annuali;
- cancellazioni a fine periodo;
- inclusione del canone negli accordi custom senza perdere il valore economico interno.

## Fase 3 — Video Revenue OS

Introdurre:

```sql
video_minute_packages
project_video_wallets
video_minute_ledger
video_processing_costs
```

Funzioni:

- catalogo pacchetti configurabile;
- vendita per minuti;
- prezzo per minuto decrescente per volume;
- saldo pubblico in minuti;
- prenotazione e consumo durante l'elaborazione;
- rimborso automatico per lavorazioni fallite;
- costo interno per modello/provider;
- margine per minuto, pacchetto, progetto e cliente;
- alert saldo basso e proposta di riacquisto.

Il ledger interno può usare crediti tecnici, ma UI, preventivi, email e contratti mostrano soltanto minuti.

## Fase 4 — Preventivi e Deal Desk

Il generatore preventivi deve offrire queste righe commerciali:

1. Abbonamento piattaforma mensile.
2. Abbonamento piattaforma annuale.
3. Pacchetto minuti video configurabile.
4. Servizi professionali opzionali approvati.
5. Accordo custom per grandi volumi.

Per gli accordi custom il CRM deve richiedere:

- progetto associato;
- durata;
- minuti inclusi;
- prezzo effettivo per minuto;
- valore piattaforma;
- indicazione `platform_fee_included`;
- sconto e motivazione;
- approvatore interno;
- margine previsto.

Ogni eccezione deve essere registrata per poter capire quali condizioni custom meritano di diventare standard.

## Fase 5 — Financial Dashboard v2

### Vista executive

- clienti attivi;
- progetti demo, trial, active, suspended e archived;
- MRR e ARR;
- trial-to-active conversion;
- churn clienti e churn progetti;
- ricavo video;
- margine video;
- ricavo totale per cliente e progetto;
- pipeline ponderata;
- forecast 30/90/365 giorni.

### Vista sales

- valore pipeline per fase;
- demo pronte per validazione;
- trial in scadenza;
- preventivi aperti;
- accordi custom in approvazione;
- deal senza prossimo passo;
- velocità di conversione per settore e responsabile.

### Vista operations

- progetti da validare;
- trial da attivare;
- progetti da sospendere o riattivare;
- saldo minuti basso;
- elaborazioni video bloccate o rimborsate;
- rinnovi e pagamenti falliti.

## Fase 6 — Customer e Project Intelligence

La pagina cliente deve mostrare:

- contatti e stakeholder;
- elenco progetti;
- ricavi ricorrenti e una tantum;
- storico video;
- valore totale e margine;
- rischi e opportunità di espansione.

La pagina progetto deve mostrare:

- stato e timeline commerciale;
- readiness e validazione;
- trial e giorni residui;
- abbonamento e rinnovo;
- deal e preventivi;
- wallet e movimenti minuti;
- attività, task e responsabili;
- KPI di utilizzo della piattaforma.

## Fase 7 — AI CEO e Revenue Autopilot

Le analisi AI devono ragionare sul nuovo modello:

- quali trial hanno maggiore probabilità di conversione;
- quali progetti active sono a rischio sospensione;
- quali clienti possono aprire un secondo progetto;
- quali progetti hanno bisogno di nuovi minuti video;
- quali accordi custom hanno margine insufficiente;
- quali attività chiudono il gap rispetto agli obiettivi MRR/ARR;
- come cambia il forecast al variare di conversione trial, churn e consumo video.

Le azioni generate restano in bozza finché non vengono approvate dall'utente.

## KPI e formule

| KPI | Formula |
|---|---|
| MRR standard | Somma canoni mensili + canoni annuali / 12 dei progetti active |
| ARR | MRR × 12 |
| Trial-to-active | Progetti diventati active / trial terminati nel periodo |
| Project churn | Progetti active persi / progetti active a inizio periodo |
| Logo churn | Clienti senza più progetti active / clienti attivi a inizio periodo |
| Video attach rate | Progetti active con acquisto video / progetti active |
| Prezzo medio minuto | Ricavo video / minuti venduti |
| Margine video | Ricavo video − costo elaborazione |
| Revenue per project | Canone + video + servizi del progetto |
| Revenue per customer | Somma dei ricavi di tutti i progetti del cliente |

## Roadmap consigliata

| Fase | Contenuto | Dipendenze |
|---|---|---|
| 0 | Clienti, progetti, relazioni e audit | Nessuna |
| 1 | Demo, validazione, trial e stati progetto | Fase 0 |
| 2 | Abbonamenti e pagamenti ricorrenti | Fasi 0-1 |
| 3 | Pacchetti, wallet e ledger minuti video | Fase 0 |
| 4 | Preventivi v2 e deal desk | Fasi 0, 2 e 3 |
| 5 | Dashboard finanziaria v2 | Fasi 2-4 |
| 6 | Customer/Project Intelligence | Fasi 0-5 |
| 7 | AI CEO e Revenue Autopilot | Dati storici delle fasi precedenti |

## Criterio di completamento

Il passaggio al modello v2 è completo solo quando:

- nessuna nuova trattativa usa i vecchi pacchetti;
- nessun progetto è rappresentato da un semplice `contacts.status`;
- preventivi, ricavi, trial, abbonamenti e minuti video sono attribuibili a `project_id`;
- il piano unico e le condizioni custom sono gestiti senza reintrodurre tier;
- dashboard e AI distinguono ricavi SaaS, video e servizi;
- tutte le transizioni commerciali sono auditabili.
