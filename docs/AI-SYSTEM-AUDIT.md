# Speaqi — audit del sistema AI e percorso verso l'autonomia

**Aggiornamento: 25 ottobre 2026.** Codice CRM esaminato: `main` con PR #76, #77 e #79 (`f789b30`), integrato nel ramo della proposta #78. StudioMap: `eded91d`; piattaforma Speaqi: `75676003`. Fonti operative: `CLAUDE.md`, [modello di business](SPEAQI-BUSINESS-MODEL.md), [Business OS](BUSINESS-OS.md), [audit del 24 ottobre](UFFICIO-AUDIT-2026-10-24.md) e [proposta dei lavori persistenti](UFFICIO-LAVORI.md).

**Verdetto:** i servizi specialistici esistono, ma non formano ancora un'organizzazione autonoma completa. I correttivi recenti migliorano smistamento, ricerca e messaggi; non sostituiscono lavoro persistente, dipendenze, recupero e verifica dell'obiettivo. Il primo incremento del motore è implementato e collaudato nel ramo #78; non è attivato in produzione. Le tabelle sotto descrivono la base osservata e i gap: risultati e limiti del codice consegnato sono nel [rapporto di verifica](UFFICIO-TEST-REPORT.md).

Questo documento raccoglie audit, registro, architettura organizzativa e tecnica, memoria, gap, roadmap, prove e istruzioni operative. Non è una certificazione del deploy né un'attestazione di generazioni o comunicazioni effettuate in produzione.

## 1. Evidenze e limiti della verifica

Snapshot Supabase del **25 ottobre, 07:13 Europe/Rome** (`06:13:05Z`), interrogato in sola lettura:

| Osservazione | Esito | Interpretazione |
|---|---|---|
| Registro agenti | 12 installati; 5 accesi | Direttore, Eventi, Osservatorio, My Maps e Presentazioni |
| Corse | 18: 15 `done`, 3 `failed` | Direttore 10 concluse e 2 fallite; Presentazioni 3 concluse; My Maps 1 fallita; Eventi e Osservatorio 1 conclusa ciascuno. La corsa conclusa può avere prodotto soltanto un avviso |
| Ordini | 12: 8 `done`, 3 `failed`, 1 `waiting_you` | Lo stato dell'ordine non dimostra il risultato di tutti gli specialisti |
| Avvii pianificati dell'Ufficio | Nessuna riga `office-*` in `automation_job_runs` | Operatività periodica non verificata; non è prova sufficiente di quale variabile del server la impedisca |
| Tabella dei lavori | `office_work_items` assente | Il nuovo motore non è installato sul database osservato |
| Schema memoria lead | `lead_id`, `summary`, classificazioni e date | Conferma il difetto del lettore bozze che cercava `contact_id`/`memory`; corretto localmente con regressione |

Nello snapshot del 24 ottobre Eventi e Osservatorio erano senza fonti; Buenos Aires aveva una coda My Maps senza fonte esplicita e un errore 400, mentre le presentazioni Buenos Aires/Bergamo avevano prodotto segnalazioni per prerequisiti mancanti. Sono fatti storici, non un nuovo collaudo di quei percorsi dopo la #79.

Non sono state eseguite nuove spese, pubblicazioni, invii o modifiche ai database operativi durante l'audit. Le prove automatiche usano fixture, storage temporaneo, PostgreSQL isolato e fornitori simulati dove indicato.

## 2. Architettura ricostruita dal codice

```text
Titolare → CRM web / Telegram / voce trascritta
           → Direttore: interpretazione e validazione tipizzata
           → ordini + corse + output + ledger del CRM
           → specialisti Ufficio e servizi di dominio
               → StudioMap: pipeline editoriale, mappe, qualità, ricevute
               → Speaqi: traduzioni/media, Knowledge Base, distribuzione
               → CRM: contatti, opportunità, preventivi, fatture, bozze

Pianificatore interno CRM → endpoint autenticati a orario
Interfaccia /ufficio ← stato persistito, proposte, corse e costi
```

- **CRM:** Next/TypeScript, Supabase/PostgreSQL, autenticazione e RLS. Il pianificatore si avvia nel server (`src/instrumentation.ts`, `src/lib/server/automation-scheduler.ts`), con prenotazione `(job, slot)` fra repliche. Gli handler Ufficio risiedono in `src/lib/server/office-agents/`.
- **StudioMap:** server Node/TypeScript, pipeline a step con checkpoint, store fs/pg e journal dei job. I lease scaduti identificano un'interruzione; la presenza di un checkpoint non equivale a una ripartenza autonoma (`src/jobs.ts`, `src/pipeline.ts`).
- **Piattaforma Speaqi:** API NestJS/TypeORM/PostgreSQL e code Redis/BullMQ per traduzioni, testo/audio, video e ingestione della Knowledge Base. Queste code non gestiscono gli ordini commerciali del CRM.
- **LangGraph:** non trovato nei manifest e sorgenti dei tre progetti esaminati. Non c'è un grafo esistente da completare; per il primo percorso non è dimostrata la necessità di introdurre un framework aggiuntivo.
- **Tool calling:** Ufficio assegna azioni tramite codice; Agency produce JSON validato; Discovery Tourism usa ricerca web e citazioni; MCP CRM espone sei operazioni dirette. Non sono un unico protocollo di delega o un sistema generale di agenti che conversano fra loro.

Il confine da mantenere è semplice: il CRM possiede il processo commerciale, StudioMap quello editoriale, Speaqi traduzioni/media/KB. Gli adattatori devono collegare gli identificativi e verificare i risultati, senza duplicare le pipeline.

## 3. Agent registry: dodici specialisti installati

Ogni riga distingue responsabilità reale e limite di autonomia. **Parziale** significa che il compito specialistico è implementato, ma l'obiettivo aziendale completo non è provato. Nessuna riga implica che l'agente sia acceso o abbia una corsa remota riuscita oggi.

| Agente / reparto attuale | Responsabilità, input e strumenti | Output e autonomia effettiva | Memoria / dipendenze | Stato e problema principale |
|---|---|---|---|---|
| `director` — Direzione | Ordini in testo/foto, opportunità, preventivi, mappe; interprete a schema, letture CRM, registro handler, ricerca mirata ente dalla #79 | Piano e priorità, proposta contatto, To Do, risposte di stato/eventi, smistamento. Non pianifica un processo commerciale arbitrario completo | Ordini, corse, output, ledger, `deals`; dipende da dati e specialisti | **Parziale.** Attivo remoto e interpretazioni osservate; mancano dipendenze durevoli e risultato aggregato affidabile |
| `sales_followup` — Commerciale | Contatti CRM, cronologia email, task, firme, quote; generatore bozze e RPC con quota | Massimo 15 bozze al giorno; nessun invio autonomo dell'Ufficio | Memoria lead, email, quote, output; dati cliente e preventivo necessari | **Parziale.** Test locali; nessuna corsa remota nello snapshot. Ownership nel selettore, collegamento `deal_id` della bozza da uniformare |
| `presentations` — Commerciale | Ente/destinazione verificati, evidenze e coda; servizi deck, claim persistente, generatore validato | Presentazione da rivedere, segnaposto e proposte di correzione; email pronta solo dopo approvazione del deck | `office_presentation_tasks`, deck/versioni, prove; dipende da identità e legame territoriale | **Parziale.** Tre corse remote concluse non dimostrano tre deck. La catena completa deve distinguere avviso e documento pronto |
| `entity_enricher` — Ricerca | Destinazioni prioritarie e organizzazioni con sito; fetch sicuro, estrazione e validazione di frasi/recapiti | Proposta con prove; aggiornamento/verifica/importazione soltanto nel percorso approvato | Catalogo Tourism, evidence, relazioni, output; dipende da fonti ufficiali | **Parziale.** Test locali; niente corsa remota. L'handler periodico non è ancora un destinatario generale di incarichi puntuali |
| `events_scout` — Ricerca | Fino a 30 fonti; parser JSON-LD/iCal/feed, estrazione delle sole pagine senza struttura | Eventi/bandi e proposte To Do; non iscrive o invia. Le query libere configurate non sono eseguite | Batch per giorno, eventi, scadenze, output; fonti necessarie | **Parziale.** Corsa remota osservata con zero risultati e fonti vuote nel campione storico |
| `news_watch` — Ricerca | Feed/pagine datate, concorrenti; fetch e filtro ultime 48 ore | Rassegna con fonti; inoltro Telegram dell'output solo con azione autorizzata | Batch, URL/titoli già visti, consegne; dipende dai feed | **Parziale.** Corsa remota osservata senza notizie; concorrenti non sostituiscono fonti configurate |
| `mymaps_builder` — Mappe | Mappa/città e fonte pubblica; bridge autenticato StudioMap, parser KML e merge | Massimo 150 candidati/import, costo dichiarato zero; niente testi, traduzioni o pubblicazione | Checkpoint/ricevuta StudioMap, output per mappa/turno; dipende dalla fonte | **Parziale.** Una corsa remota fallita. #77 corregge import per mappa/turno e dettagli dell'errore, non crea da sola una guida finita |
| `maps_quality` — Mappe | Inventario o mappe in monitoraggio; bridge sola lettura, regole e campione globale massimo 20 | Rapporto e proposte; nessuna correzione/pubblicazione implicita | Fonti salvate, rapporti giornalieri, fingerprint; dipende dai contenuti leggibili | **Parziale.** Test locali; nessuna corsa remota. Approvare il rapporto non applica le correzioni |
| `languages_voice` — Mappe | Mappe Speaqi, lingue scelte, stime; status, dry run e fill API | Completa mancanti entro budget; obsolete richiedono autorizzazione. Il lancio remoto non è il risultato finale | Run remota, copertura e snapshot; sei mappe a rotazione dalla #77 | **Parziale.** Test locali; nessuna corsa remota. Stima al lancio distinta dal costo effettivo e dalla copertura finale |
| `finance` — Finanza | Quote pagate, fatture e scadenze; servizi fatture, regole contabili e RPC bozze | Bozze fattura/solleciti, dati da correggere, chiusura mese; niente SDI o pagamenti | Quote, fatture, clienti, output; dipende dai dati fiscali | **Parziale.** Test locali; nessuna corsa remota. Non è una riconciliazione bancaria o un CFO autonomo |
| `social` — Marketing | Guide online e foto verificabili; API pubbliche e generatore strutturato | Bozze per tre piattaforme, con link/foto esistenti; nessuna pubblicazione | Batch/snapshot settimanali, output; dipende da guide e asset | **Parziale.** Test locali; nessuna corsa remota. Non comprende strategia, newsletter, SEO e campagne come processo completo |
| `db_cleaner` — Operazioni | Chiavi email/telefono/azienda-città, scan SQL e compatibilità | Proposte di merge; clic transazionale sposta i legami e nasconde i duplicati, senza cancellarli | Storia CRM e decisioni precedenti; dipende dai vincoli di dominio | **Parziale.** Test SQL locali; nessuna corsa remota. Non è un amministratore libero del database |

Definizioni, handler e turni sono verificabili in `src/lib/server/office-agents/definitions.ts`, `registry.ts` e `src/lib/automation-schedule.ts`. Regole/prompt puri stanno in `src/lib/office/`; Agency in `src/lib/server/agency-agent.ts`, Discovery in `tourism-discovery.ts`, il generatore email in `email-drafts.ts` e `email-draft-context.ts`.

Agency esiste come servizio applicativo, ma non come agente Ufficio installato. Il concierge delle mappe risponde ai visitatori con retrieval e citazioni: non è il Direttore commerciale. Non aggiungere responsabili artificiali per colmare semplicemente una casella dell'organigramma.

## 4. Cinque cause principali dell'autonomia incompleta

### 1 — Il processo non ha ancora un lavoro persistente comune

`office_director_orders`, corse e output descrivono frammenti diversi. #76/#77 attendono esiti e ritentano temporaneamente quando un agente è occupato, ma lo fanno in memoria. Un riavvio o un'attesa più lunga possono ancora interrompere il processo. La #79 amplia un passaggio funzionale senza renderlo durevole.

**Soluzione:** lavoro tipizzato con dipendenze, lease, checkpoint, tentativi e risultato; worker nel pianificatore esistente. [La proposta #78](UFFICIO-LAVORI.md) è la base approvata; il primo incremento è implementato e verificato localmente. Non introdurre una seconda pipeline editoriale o una nuova coda traduzioni.

### 2 — «Terminato», «avviato» e «obiettivo raggiunto» non hanno un unico contratto

Un handler può chiudersi con un avviso; `started:true` prova il lancio di una traduzione, non la copertura finale. I nuovi messaggi dell'esito migliorano la visibilità, ma non sostituiscono criteri di accettazione leggibili dal codice.

**Soluzione:** ogni azione definisce risultato richiesto e verificatore: deck persistito/valido, mappa importata con ricevuta, copertura letta a fine run, proposta in attesa del titolare. Stato e notifiche derivano da questi oggetti; il testo del modello non dichiara il successo.

### 3 — Dati mancanti, autorizzazioni e verifica vengono trattati in modo diverso fra percorsi

L'Arricchimento periodico propone prove da approvare. La #79, invece, consente al Direttore di attivare l'ente su ordine del titolare e può registrare `VERIFIED` anche quando la lettura/estrazione non riesce (`office-entity-activation.ts:70-83`, migration `20261024150000_tourism_activate.sql:53-75`). Questa è un'autorizzazione operativa esplicita nel codice recente, ma non è una prova letta su una fonte.

**Soluzione:** mantenere separate provenienza del dato e autorizzazione dell'azione. Dichiarazione del titolare, inferenza e attestazione documentale devono restare distinguibili. Il nuovo percorso Turismo non deve aggirare un rifiuto o convertire un errore di ricerca in prova verificata. Le differenze della #79 vanno assorbite con una policy esplicita, senza reintrodurre i blocchi volatili precedenti.

### 4 — Contesto e memoria non sono recuperati in modo uniforme

La memoria lead esiste, ma il generatore bozze leggeva campi inesistenti, ignorando l'errore. È stato corretto localmente riusando `readLeadMemory`: la sintesi del lead corretto raggiunge il generatore con fonte/data ed etichetta derivata. Un test con dati di altri workspace e altri lead prova il filtro.

Resta da unificare il recupero del fascicolo commerciale e la distinzione fra sintesi e fatti. `buildLeadContext` legge solo una parte della storia; `ai_decision_logs` ignora gli errori di scrittura (`ai-ready.ts:349-370`). Non è il registro transazionale richiesto per effetti critici.

### 5 — Le capacità disponibili non corrispondono ancora a permessi e responsabilità uniformi

Il contesto Ufficio è ristretto, mentre MCP dispone di `send_email` diretto dopo sola autenticazione (`src/app/api/mcp/route.ts:176`). **MCP non è una capability del Direttore** e non va collegato come toolbox generale. Le API e le chiavi di piattaforma possono consentire operazioni più ampie di quelle dello specialista.

Commerciale rispetta l'owner nel selettore, ma la RPC di bozza non porta ancora un contratto uniforme con `deal_id` e scopo. Mancano inoltre specialisti operativi per molte attività ipotizzate nell'organigramma, non necessariamente nuovi agenti da creare.

**Soluzione:** elenco chiuso di azioni e adattatori, controlli di workspace/ruolo/ambiente, responsabilità della comunicazione per opportunità e approvazione persistente per gli effetti esterni. Riutilizzare claim, contatori e riconciliazione del motore invii, preservando la separazione `source=office` / invii automatici preautorizzati.

## 5. Organizzazione: otto funzioni, senza otto nuovi agenti

Il titolare definisce obiettivi, policy e autorizzazioni. Il Direttore coordina. Un responsabile di reparto può essere un workflow deterministico o un umano: non serve un altro modello per ogni livello.

| Funzione proposta | Componenti esistenti da riusare | Responsabilità scoperta / confine |
|---|---|---|
| Sales & Business Development | Direttore, Commerciale, Presentazioni, catalogo Tourism, opportunità, servizi Agency e quote | Qualifica e proposta completa richiedono lavoro collegato all'opportunità; accordi e impegni restano del titolare |
| Marketing & Communication | Social, Osservatorio, motori campagne e Wine Project | Strategie, newsletter e GEO non sono capacità complete dell'agente Social; campagne hanno policy proprie |
| Maps & Content | My Maps, Qualità, Lingue, pipeline StudioMap, traduzioni/KB Speaqi | Produzione editoriale nel sistema esistente; pubblicazione umana e Napoli esclusa dai lavori sulle mappe |
| Product & Technology | Repository, test, log, workflow di revisione e PR | Nessun agente Ufficio tecnico installato; l'azione iniziale è una proposta verificabile, non un deploy automatico |
| Customer Success & Operations | Task, progetti, scadenze, abbonamenti, Pulizia, attività e notifiche | Onboarding/consegna/attivazione completi non sono ancora un workflow comune; il lifecycle del progetto resta separato dalla pipeline vendita |
| Finance & Administration | Finanza, fatture, quote, Stripe/SDI e contatori | Preventivi e prezzi restano nei servizi canonici; nessun pagamento o impegno autonomo |
| Legal & Compliance | Termini/contratti quote, firme immutabili, documenti e policy aziendali | Nessun agente legale installato; raccolta/preparazione assistita e revisione del titolare per accordi |
| Business Intelligence & Strategy | Piano Direttore, command center, analytics, catalogo/fonti e Osservatorio | Indicatori da fonti strutturate, dati mancanti dichiarati; non inventare previsioni o sommare metriche incompatibili |

Le etichette organizzative possono essere proiettate nella vista dei reparti senza rinominare in blocco i dati esistenti. La responsabilità operativa è dell'azione e dell'owner, non del colore nel campus 3D.

## 6. Architettura di orchestrazione e protocollo

Il workflow è identificato dall'ordine o dall'obiettivo; le opportunità restano `deals`. Ogni delega contiene azione, obiettivo, contesto referenziato, input/versione, agente, permessi, output atteso, criterio di completamento, priorità, scadenza, budget e dipendenze. Non passare SQL, nomi arbitrari di tool o istruzioni libere da eseguire.

Messaggi ammessi: incarico, richiesta informazione, risultato, errore, blocco, richiesta approvazione, annullamento. Tutti hanno `workflow_id`, `work_id`, causale/idempotency key e riferimenti alle prove. Limiti di tentativi, durata, costo e numero di passi impediscono cicli di delega. Gli specialisti non possono aumentare privilegi o budget.

Il motore in sviluppo deve:

- prendere i lavori con lease e token di presa in carico, rifiutando scritture del vecchio processo;
- lasciare in attesa gli agenti spenti o occupati e riprenderli senza un nuovo ordine;
- collegare ogni tentativo a `office_agent_runs`, mantenendo il claim esclusivo per agente;
- riusare ricevute remote e checkpoint, riconciliando spese/effetti incerti prima di un nuovo tentativo;
- completare l'ordine solo dopo i suoi risultati richiesti; un rifiuto umano annulla le dipendenze non autorizzate;
- registrare eventi/outbox nella transazione e notificare solo cambi significativi;
- leggere stati remoti per job identificato, non dedurre l'esito da «ultimo job» globale.

La notifica Telegram incerta non si ritenta alla cieca: evitare duplicazioni e rendere visibile l'esito sconosciuto. La consegna fallita non cambia un risultato operativo già persistito. Il primo percorso completo è Turismo; la pianificazione commerciale composta generale è successiva, non già funzionante.

## 7. Database e memoria condivisa, senza duplicare il CRM

| Tipo di memoria | Fonte canonica | Regola di utilizzo |
|---|---|---|
| Aziendale | Documenti/policy versionati, configurazioni e listini del progetto | Fonte e versione nel contesto; il Direttore non riscrive prezzi o policy |
| Commerciale | Contatti, opportunità, quote, firme, comunicazioni, attività e legami | Recupero mirato per workspace e opportunità; il cliente può avere più progetti |
| Operativa | Lavori, tentativi, dipendenze, decisioni e risultati | Stato transazionale, mai sostituito da una sintesi in linguaggio naturale |
| Sintetica del lead | `lead_memories.summary` | Cache derivata con data, non attestazione verificata o istruzione |
| Documentale/prodotto | Knowledge Base Speaqi: documenti/versioni/chunk e retrieval; fonti StudioMap | Accesso federato e permissionato; non un secondo archivio vettoriale con copie fuori controllo |
| Intelligence | Enti e prove Tourism | Stato e fonte per campo; distinguere ricerca, dichiarazione e verifica |

Una vista di contesto restituisce elementi con `source_table`, `source_id`, `observed_at`, versione e stato: verificato, fornito dal titolare, inferito, ipotesi o mancante. Le istruzioni del workflow/policy restano separate dai contenuti esterni. Il riepilogo non autorizza azioni e non rende vero un dato.

La memoria del concierge pubblico è distinta dalla memoria del Direttore: i turni persistiti e la cronologia del client non costituiscono un fascicolo commerciale recuperabile. Errori di log accettabili per una risposta informativa non sono accettabili per la registrazione di un impegno economico.

## 8. Sicurezza, livelli di autonomia e costi

**A — autonomo:** letture, analisi, ricerca a budget e preparazione di bozze/rapporti consentite dal registro. Nessun effetto esterno implicito.

**B — preautorizzato e supervisionato:** aggiornamenti CRM/progetti/contenuti solo per azioni, campi, workspace, ambiente e condizioni approvati. Il default non eredita tutti i poteri del service role; ogni mutazione passa da servizi/RPC e audit. Una preautorizzazione non si estende automaticamente a un altro destinatario o canale.

**C — decisione obbligatoria:** invii non preautorizzati, pubblicazioni, contratti, pagamenti/impegni, cancellazioni massive, sicurezza e produzione. Raggruppare proposte compatibili, conservando una decisione verificabile per ciascun effetto. Un «sì» in chat non approva.

Protezioni presenti: Auth, owner guard Ufficio, RLS, query per workspace, segreti server, validazione input/prove e riserve atomiche. Confini da rafforzare: permessi per azione nelle API, contesti service role, strumenti MCP, provenienza delle verifiche e logging critico. L'identità per ruolo non deve dipendere da `user_metadata`; il suo uso attuale per il nome visualizzato non è un'elevazione di privilegi.

Prompt Agency e Discovery separano già dati/istruzioni e usano schemi; questi controlli non bastano senza verifiche di output e permessi. La ricerca pubblica nel generatore email viene inserita nel contesto di sistema: prima di riusarla per azioni esecutive va spostata in dati strutturati non autorevoli. Il generatore Ufficio disabilita oggi quella ricerca opzionale nel percorso Commerciale.

Il ledger deve conservare token, chiamate e costo per agente/tentativo, aggregati per lavoro, opportunità e progetto; stima, riserva e costo effettivo sono diversi. L'infrastruttura esistente misura parte dei consumi, non ancora tutti gli aggregati del workflow. KPI da derivare dagli eventi: completamenti verificati, fallimenti, blocchi, durata, interventi umani, retry e costi. Funzioni deterministiche per regole e routing; scelta del fornitore solo fra configurazioni con prezzi verificati. Nessuna richiesta di aumentare automaticamente i budget.

## 9. Automazioni proattive e interfaccia

Esistono già scheduler, webhooks e servizi per risposte, follow-up, quote/pagamenti, fatture, campagne, punteggi e notifiche. Il nuovo motore deve collegarli tramite eventi persistenti con chiave causale e deduplicazione, non rieseguire l'intera azienda a ogni cambiamento.

| Evento | Seguito iniziale consentito | Confine |
|---|---|---|
| Lead creato o aggiornato | Recupero contesto e qualifica/preparazione attività | Trigger configurabile, niente ricorsione sulle scritture dell'agente |
| Preventivo inviato / risposta ricevuta | Prossimo passo e bozza nei motori esistenti | Risposte o disiscrizione bloccano i follow-up incompatibili |
| Contratto approvato / rinnovo vicino | Proposta di onboarding o attività di rinnovo | Attivazione completa dopo accordo resta da progettare/implementare |
| Mappa pubblicata o progetto in ritardo | Qualità/diagnosi entro permessi, blocco al Direttore | Nessuna rigenerazione o pubblicazione implicita |
| Errore applicativo | Diagnosi e rapporto/PR | Nessun deploy o modifica dei controlli di sicurezza |

L'interfaccia rimane in `/ufficio`: conversazione/comando, piano, lavori attivi, dipendenze, approvazioni, risultati e cronologia. Il campus è una proiezione dello stato, non l'orchestratore. Il pannello deve mostrare responsabile, blocco e prossima azione; i dettagli tecnici non devono ostacolare le decisioni. Nessuna nuova pagina nella barra laterale per duplicare gli stessi dati.

## 10. Matrice di autonomia: sei scenari richiesti

| Scenario | Capacità già esistenti | Autonomia verificata in questo audit | Per completare il processo |
|---|---|---|---|
| Nuova opportunità commerciale | CRM, qualifica, opportunità, deck, quote e bozze separati | Non provato un ordine unico fino al pacchetto commerciale | Piano tipizzato, dipendenze e owner; criteri su materiali/preventivo; approvazioni |
| Nuova mappa multilingua | Import, pipeline editoriale, qualità e traduzioni | 15 test locali StudioMap del sottoaudit; non una consegna multilingua remota | Collegare ricevute/job e verificare copertura/qualità finali |
| Proposta commerciale completa | Generatori deck/Agency e preventivi collegati | Nessun nuovo preventivo o documento commerciale generato in produzione | Un workflow che colleghi bisogni, soluzione, prezzi e revisione |
| Analisi delle opportunità | Piano deterministico e command center | Risposta di stato remota osservata; ranking testato nel progetto | Collegare le raccomandazioni ad azioni consentite e risultati |
| Errore di agente | Corse/ledger e correttivi #77 | Errori remoti storici osservati; non una ripresa completa verificata | Retry sicuro, checkpoint, blocco/riconciliazione e risultato aggregato |
| Interruzione del sistema | Checkpoint StudioMap, code Speaqi e ricevute specifiche | Non dimostrato il recupero dell'intero ordine commerciale | Lease, token, riavvio worker e prova di nessun doppio effetto |

Le prove sul motore sviluppato in questa PR andranno riportate separatamente dal comportamento del vecchio sistema. Né fixture né dati inventati vanno presentati come clienti o risultati reali.

## 11. Implementazione e test già effettuati in questo intervento

| Problema | Soluzione locale | File | Prova / risultato | Limite residuo |
|---|---|---|---|---|
| Sintesi lead assente dalle bozze per campi errati | Lettore canonico con filtro workspace/lead, fonte/data e stato derivato nel contesto; il prompt non tratta la sintesi come prova o istruzioni | `src/lib/server/email-drafts.ts`, `tests/office-sales.unit.test.ts` | `node --import tsx tests/office-sales.unit.test.ts`: **9 test superati**, inclusa regressione con memoria popolata e record di altri lead/workspace | La sintesi resta opzionale; non risolve da sola retrieval generale, logging o ownership |
| Confini Maps/persistenza non chiari | Audit repository e prove isolate dei servizi esistenti | Sorgenti StudioMap/Speaqi esaminati, nessuna modifica in quei repository dal sottoaudit | `node --import tsx test/jobs-refresh.test.ts` (**1**), `test/office-mymaps.test.ts` (**7**), `test/office-quality.test.ts` (**7**): **15 test superati** | Fornitori/storage temporanei; nessuna certificazione del deploy |

I test del 24 ottobre (166 applicativi, 75 DB, 14 StudioMap) restano evidenza storica dell'audit precedente. Non vengono ricontati come verifiche odierne della base #79. Per il nuovo motore vanno eseguiti test puri, PostgreSQL reale con le migration del progetto, integrazione con servizi simulati e browser locale; test remoti solo entro le autorizzazioni del titolare.

## 12. Roadmap incrementale per le dodici fasi della missione

| Fase | Intervento e dipendenza | Stato |
|---|---|---|
| 1 — Audit | Ricostruzione CRM/StudioMap/Speaqi, fonti, prove e gap | Documento aggiornato; runtime dei domini remoti non interamente ricollaudato |
| 2 — Organizzazione | Direttore unico, ownership per processo, responsabili solo dove servono | Mappata sopra, niente nuovi agenti artificiali |
| 3 — Reparti | Proiezione degli otto ambiti sulle capacità reali | Proposta; non rinominare tabelle/ruoli in blocco |
| 4 — Orchestrazione | Work items, registro azioni, dipendenze, risultati e recovery | Primo incremento implementato e collaudato sulla base #78; rilascio separato |
| 5 — Memoria | Lettore commerciale canonico e contesto con provenienza; collegamento KB esistente | Primo bug corretto; retrieval federato successivo |
| 6 — Comunicazione agenti | Messaggi tipizzati per workflow e outbox | Parte del motore; nessuna conversazione libera |
| 7 — Autonomia | Policy A/B/C per azione, ruolo e ambiente | Confini definiti; estensioni attivate solo con test e autorizzazioni |
| 8 — Direttore UI | Vista Lavori e stato per ordine nel pannello esistente | Scheda Lavori implementata e provata nel browser desktop/mobile con API simulate |
| 9 — Proattività | Collegare eventi di dominio ai lavori senza duplicare automazioni | Dopo affidabilità del primo percorso Turismo |
| 10 — Test reali | Sei scenari sopra, concorrenza, agente spento/occupato, budget, fonte corretta, rifiuto e riavvio | Accettazione completa ancora aperta |
| 11 — Performance/costi | Aggregati per workflow/progetto, latenze, cap, interventi umani | Riutilizzare ledger/eventi; non introdurre stime non supportate |
| 12 — Rilascio | Migrazioni additive prima del codice, compatibilità schema assente, cutover, osservazione e sospensione worker | Nessuna modifica alla produzione senza approvazione; niente merge/deploy automatico |

Priorità: chiudere il ciclo persistente ordine → lavoro → risultato; poi Turismo completo; poi estendere lo stesso contratto alle opportunità commerciali, Maps e preventivi. L'organizzazione completa non è terminata finché i sei scenari non sono provati e gli effetti esterni non restano nei limiti autorizzati.

## 13. Guida operativa: disponibile e prevista

**Oggi:** impartire gli ordini dal pannello del Direttore in `/ufficio` o dal bot autorizzato; configurare fonti e budget nella scheda agente; leggere esiti e proposte invece di dedurre il successo dall'interruttore. «Acceso» non significa «al lavoro» e un report approvato non equivale a un deck approvato. Napoli in produzione resta intoccabile per i lavori automatici sulle mappe.

**Con il motore collaudato, dopo l'attivazione autorizzata:** consultare la scheda Lavori, correggere dati mancanti nello stesso lavoro, decidere le proposte con effetto esplicito e seguire il risultato dell'ordine. Non reinviare per agente occupato o riavvio. Un costo/effetto incerto richiede riconciliazione visibile, non un pulsante di retry cieco.

**Amministrazione:** verificare schema/migrazioni, flag del worker, inclusione del job nella lista, heartbeat, lease e disponibilità dei servizi. Non accendere tutti i job del CRM per abilitare soltanto l'Ufficio. Conservare backup dei nuovi registri e prova del passaggio dalle code; in caso di problema sospendere il consumatore conservando i lavori. Sequenza e controlli del rilascio sono nella [guida operativa](UFFICIO-OPERATING-GUIDE.md).
