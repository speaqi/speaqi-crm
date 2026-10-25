# Ufficio — proposta dei lavori persistenti

**Stato: base approvata dal titolare il 25 ottobre 2026; primo incremento implementato nella PR.**
Base: `main` con PR #76 e #77 (`62e4a47`). Capitolato: [audit del 24 ottobre](UFFICIO-AUDIT-2026-10-24.md), letto insieme a «Opportunità», «Ufficio Speaqi» e «Ordini al Direttore» di `CLAUDE.md`.

Obiettivo: un ordine resta nel sistema fino a un risultato verificabile o a un blocco che dica **cosa manca, chi interviene e quando si ricontrolla**. Accodare o terminare una corsa non significa aver concluso il lavoro.

## 1. Schema proposto

Tabella centrale **`office_work_items`**, con `user_id` obbligatorio su ogni riga. Ordine e opportunità sono facoltativi per i lavori periodici, ma non possono appartenere a un altro workspace.

| Gruppo | Campi e vincoli |
|---|---|
| Identità e origine | `id uuid`, `user_id`, `origin` (`order`, `approval`, `director_plan`, `schedule`, `legacy`), `source_key`, `order_id`, `deal_id`, `source_output_id`. Unicità `(user_id, source_key)` per richieste ripetute e slot periodici |
| Incarico | `agent_id`, `action`, `payload jsonb`, `payload_version`, `payload_hash`, `priority`, `available_at`, eventuale `due_at`. Payload limitato e validato per azione; coppia agente/azione in elenco chiuso |
| Avanzamento | `status`, `phase`, `checkpoint jsonb`, `result jsonb`, `result_summary`, `revision` per aggiornamenti concorrenti. Il risultato contiene riferimenti agli oggetti verificati, non solo testo libero |
| Attesa o blocco | `reason_code`, `reason`, `required_action`, `responsible`, `next_check_at`. Obbligatori negli stati di attesa/blocco; se manca una data possibile, indicare «dopo la decisione del titolare», senza inventarla |
| Presa in carico | `lease_token`, `lease_until`, `heartbeat_at`, `attempt_count`, `max_attempts`, `last_run_id`, `last_error`, date di creazione/aggiornamento/conclusione |

Tabelle di supporto, con gli stessi vincoli di workspace:

- **`office_work_dependencies`**: `work_id`, `depends_on_work_id`, condizione tipizzata (`succeeded` o `approved_output`), eventuale `output_id`. Vietati dipendenze circolari e legami fra workspace diversi.
- **`office_work_attempts`**: tentativi immutabili, versione del payload, lease, `run_id`, fase, ricevuta esterna, inizio/fine ed esito. `office_work_outputs` collega ogni uscita al lavoro e al tentativo che l'ha prodotta.
- **`office_work_revisions`**: payload precedenti, motivo e origine della correzione. Un campo nullo non cancella una fonte già salvata; nessuna modifica del payload in esecuzione.
- **`office_work_events`**: cambi di stato e notifiche da consegnare, registrati nella stessa transazione del cambiamento. Chiave unica per evento/destinatario/canale, stato di consegna e dettaglio dell'errore.

Le FK e le RPC controllano il proprietario anche per corse, uscite, enti, deck e opportunità. RLS: sola lettura al proprietario; nessuna scrittura diretta dal browser. RPC di mutazione solo `service_role`, `search_path` fisso, privilegi revocati a `PUBLIC`, `anon`, `authenticated`. Tabelle comprese nei backup; lo storico del lavoro non viene perso quando scade la conservazione delle corse.

## 2. Stati e transizioni

| Stato interno | Testo nel pannello | Uscita dallo stato |
|---|---|---|
| `waiting` | In attesa | Dipendenza soddisfatta, agente riacceso/libero o orario raggiunto → `ready` |
| `ready` | Pronto | Presa atomica del worker → `running` |
| `running` | In esecuzione | Checkpoint → `waiting`, `blocked`, `waiting_owner`, `succeeded` o `failed` |
| `blocked` | Bloccato | Correzione dati/configurazione, budget disponibile o riconciliazione → `ready` dopo ricontrollo |
| `waiting_owner` | Aspetta te | Clic autorizzato → prosecuzione; rifiuto → `cancelled` |
| `succeeded` | Riuscito | Terminale: risultato verificato per quella versione dell'incarico |
| `failed` | Fallito | Terminale: errore definitivo o tentativi sicuri esauriti; ripresa esplicita e tracciata nello stesso lavoro |
| `cancelled` | Annullato | Terminale: rifiuto/cancellazione; nessun seguito dipendente |

Dipendenza rifiutata/annullata annulla i passi che richiedevano quell'autorizzazione; dipendenza fallita blocca i successivi con causa e responsabile. Correggere un lavoro bloccato crea una revisione e invalida solo i risultati dipendenti non ancora eseguiti. Un effetto già partito richiede prima riconciliazione.

**Stato dell'ordine:** salvare un lavoro `interpret_order` insieme all'ordine, così anche due ordini contemporanei o un riavvio prima dell'interpretazione sono recuperabili. Il Direttore valida il piano e ne registra i figli prima di chiudere questa fase, in una transazione. Una chiusura del piano (`planning_closed_at`) impedisce un «Fatto» prematuro fra creazione dei figli e completamento dell'interpretazione.

L'aggregato è calcolato dal database: errore definitivo → fallito; rifiuto → annullato; approvazione necessaria → aspetta te; altrimenti blocco, esecuzione o attesa. **`done` soltanto a piano chiuso e con tutti i lavori richiesti `succeeded`.** Estendere additivamente gli stati dell'ordine mantenendo quelli esistenti; non ricavare lo stato dal testo di `reply`.

## 3. Chi crea e chi consuma

- **Ordini web/Telegram:** la rotta salva ordine e interpretazione da svolgere, risponde subito e non avvia più lavoro con Promise abbandonate. Un update Telegram già acquisito non crea un secondo ordine.
- **Direttore:** produce solo azioni ammesse dal registro, mai comandi liberi. Inizialmente: interpretazione/risposte/To Do/proposta contatto; import My Maps, controllo qualità, completamento lingue; verifica puntuale ente e preparazione presentazione. Le operazioni interne approvate sui contatti riusano i servizi esistenti con checkpoint.
- **Piano e approvazioni:** una proposta operativa del piano crea lavoro `waiting_owner` e uscita collegata. Il clic, gli effetti SQL e lo sblocco del lavoro sono atomici. Un report informativo non crea incarichi e approvarlo non verifica dati. Ogni altro incarico eseguibile nato dal piano usa lo stesso registro; azioni non installate sono blocchi espliciti.
- **Turni specialistici e avvio manuale:** creano lavori tipizzati idempotenti per agente/slot o clic. Per gli altri agenti installati si incapsula il compito esistente, senza ampliarne capacità o autorizzazioni. Le liste di monitoraggio restano configurazione, non incarichi da consumare.
- **Worker:** nuovo job `office-work` nel pianificatore esistente, ogni minuto, incluso esplicitamente nell'eventuale lista dei job abilitati. Nessun secondo pianificatore. Una richiesta può sollecitarne il giro, ma il recupero dipende dal database e dal turno successivo, non dalla pagina aperta.

Il worker seleziona lavori pronti per priorità e anzianità con `FOR UPDATE SKIP LOCKED`. Lease proposta: 90 secondi, rinnovo ogni 30; nessuna transazione resta aperta durante rete o modelli. Ogni mutazione verifica il token di lease: il vecchio processo non può completare o spendere dopo essere stato sostituito. Si mantiene **`claim_office_agent_run`**, una sola corsa per agente; conflitti con corse manuali/programmate lasciano il lavoro in attesa. I passi lunghi hanno checkpoint entro il limite attuale di 30 minuti della corsa.

La ripresa consulta prima checkpoint, corse, ledger e ricevute: risultato già salvato → adozione; operazione sicuramente non partita → nuovo tentativo limitato; timeout/spesa/effetto incerti → `blocked` con riconciliazione. Identificativi delle operazioni esterne stabili per lavoro/versione/fase, non per nuovo tentativo. Ogni spesa continua a passare dalla riserva preventiva e dal saldo idempotente; budget finito non aumenta i tetti e indica il primo ricontrollo compatibile con giorno/settimana/mese italiani.

## 4. Primo percorso completo: Tourism

```text
Ordine «prepara la presentazione per X»
  → interpret_order (Direttore)
  → verify_tourism_entity (Arricchimento enti), se mancano prerequisiti
      → ricerca mirata della fonte, raccolta e validazione delle prove
      → proposta collegata al lavoro: Aspetta te
      → clic: verifica/importazione e completamento del prerequisito
  → prepare_presentation (Presentazioni), dipendente dalla verifica approvata
  → deck pronto e validato → lavoro riuscito → ordine Fatto
```

Estendere Arricchimento con un ingresso puntuale (`entity_id`, destinazione da risolvere/verificare, `work_id`), indipendente dalle superguide prioritarie e dai periodi di esclusione della scansione periodica. Prima si riusano prove e proposte valide già esistenti; un rifiuto non si aggira automaticamente con una nuova proposta.

**Senza sito:** riusare ricerca Tourism e fetch sicuro, limitandoli all'ente richiesto. Il trasporto di ricerca esistente non entra nell'ufficio finché strumenti e modello non hanno prezzo verificato, riserva preventiva e consumi riconciliabili nel ledger comune. Se tale adattamento non è disponibile, il lavoro resta bloccato «fonte ufficiale da individuare», assegnato ad Arricchimento con ricontrollo e azione del titolare disponibili nello stesso ordine; non si chiede di rimandarlo. Questa capacità di ricerca rientra nell'implementazione della catena, non in una nuova discovery generale.

Il sito candidato e le prove restano nel payload/proposta fino all'approvazione: nessuna verifica automatica dell'ente. Il clic riusa `office_enrich_entity` e `tourism_promote`, validando sito, identità, copertura, recapiti e workspace; completa il lavoro di verifica e rende pronto quello di Presentazioni **nella stessa transazione**. Se serve collegare un'opportunità, si riusa `deals`, senza crearne una seconda anagrafica o assegnare implicitamente comunicazioni a un altro responsabile.

Presentazioni riceve ente e destinazione espliciti, ricontrolla le prove e riusa `office_presentation_tasks`, deck e ricevute esistenti. «Riuscito» richiede deck persistito e validazione conclusa, non `run.status=done` o un rapporto di errore. Preparare il deck non lo approva e non invia l'email: revisione, condivisione e invio conservano i clic attuali. Un rifiuto della verifica annulla il passo dipendente e restituisce l'esito all'ordine.

## 5. Esiti, Telegram e pannello

Assorbire `queuedWorkReport`/`reportQueuedWork` come formattazione dei risultati persistenti; eliminare la loro responsabilità di seguire Promise in memoria. Gli eventi notificano passaggi significativi e risultato finale, non ogni heartbeat: «Aspetta la verifica dell'ente; se ne occupa Arricchimento; ricontrollo …». Ordini Telegram rispondono alla chat autorizzata d'origine; ordini web al destinatario del titolare già configurato. Nessun ripiego su un altro canale, nessuna approvazione tramite «sì» in chat.

L'evento di notifica sopravvive al riavvio. Consegne confermate non si ripetono; timeout di consegna resta incerto, visibile nel pannello, senza ritentativo cieco che duplichi messaggi. Il problema Telegram non cambia il risultato del lavoro. Le notifiche operative al titolare sono distinte da email, social, SDI, pubblicazioni e rassegne: quelle azioni mantengono le approvazioni esistenti.

Nuova scheda **Lavori** nel pannello di `/ufficio`, senza voce nella barra laterale: aperti prima, agente, stato, motivo, chi interviene, prossima azione/data; dettaglio con dipendenze, revisioni, corse e uscite. Ogni ordine mostra i suoi lavori e il risultato aggregato. Le correzioni e le decisioni autorizzate si effettuano lì senza ricreare l'ordine; gli identificativi tecnici restano nel dettaglio.

In `automation_job_runs` aggiungere `outcome` (`succeeded`, `skipped`, `blocked`, `failed`) e motivo, conservando `ok` per compatibilità. Payload HTTP tipizzato per passo: agente spento/occupato → saltato con motivo, prerequisito o riconciliazione → bloccato, errore definitivo/trasporto → fallito. Un giro misto conserva i dettagli per lavoro e aggrega con precedenza fallito → bloccato → riuscito → saltato; gli avvisi riguardano fallimenti, non normali attese. Il 502 introdotto dalla #77 resta per veri fallimenti, non per agente spento.

## 6. Passaggio dalle code attuali e deploy

1. **Migration nuova additiva**, timestamp successivo all'ultima presente al momento dell'implementazione: schema, vincoli, RPC, stati/aggregati e marcatura della migrazione delle code per workspace. Nessuna modifica retroattiva ai file SQL esistenti. Migrazioni consegnate, mai applicate da questo lavoro alla produzione.
2. **Codice compatibile con schema assente:** riconoscere tabelle/RPC mancanti; salvare gli ordini come ricevuti nel registro esistente, senza spese, con «aggiornamento in corso». Approvazioni che richiedono i lavori non vengono consumate e restano pendenti. Worker segnala blocco di configurazione. Quando lo schema arriva, il worker importa gli ordini ricevuti; niente fallback silenzioso alle Promise volatili.
3. **Importazione locale collaudata, poi eseguita dall'operatore:** fotografia e conteggi delle vecchie voci; chiave stabile per workspace/agente/voce. Preservare origine, approvazioni, correzioni e ricevute. Escludere voci rifiutate, associare risultati già conclusi; stato incerto → riconciliazione, mai riesecuzione automatica. Gli ordini storici privi di un legame certo restano storici: non si rigenerano lavori presumendo un'autorizzazione.
4. **Cambio di percorso per workspace:** un solo consumatore. Dopo la conclusione o riconciliazione delle corse precedenti, ordini, clic e turni scrivono lavori; gli handler ricevono solo il payload del lavoro, non svuotano `settings.queue`. I vecchi ingressi (`office_director_queue`, `startAfterApproval`) diventano adattatori alla nuova RPC. Un marcatore persistente impedisce di importare/eseguire due volte la stessa coda; le liste restano per configurazione/monitoraggio e non vengono cancellate alla cieca.
5. **Avvio controllato del worker:** verificare inclusione del job, battito, prima presa ed esito nel pannello e nel registro del pianificatore. Nessun agente acceso, budget aumentato o vecchio job estraneo abilitato dal deploy. Rollback dopo il cambio di percorso: sospendere il worker e conservare i lavori, senza tornare a consumare le code vecchie.

Le correzioni #76/#77 restano: intento `events`, messaggi StudioMap, controllo prerequisiti, merge non nullo delle fonti, import per mappa/turno e rotazione Lingue. Il worker sostituisce `runAgentWhenFree` con attesa persistente; approvazioni e notifiche confluiscono nel medesimo modello, senza due meccanismi paralleli.

## 7. Passi e accettazione dopo l'approvazione

1. Schema/RPC e stati: test puri e PostgreSQL vero con migration reali (`tests/db.sh`, `tests/office-schema.ts`), compresi RLS, workspace, dipendenze e concorrenza.
2. Worker e passaggio delle code: due ordini insieme; agente spento/riacceso e occupato; arresto prima/dopo checkpoint o spesa; lease scaduta con vecchio processo ancora vivo; budget finito; fonte corretta; nessun doppio effetto.
3. Tourism e comunicazione: assenza del sito, proposta, rifiuto, clic concorrenti, verifica → presentazione → esito finale su ordine/Telegram; consegna incerta e servizi simulati senza spesa reale.
4. Pannello e pianificatore: stati, prossima azione, schema non ancora applicato, migrazione ripetuta, recupero dopo riavvio, nessun invio/pubblicazione implicito; poi `npm run test:unit`, `npm run test:db`, `npx tsc --noEmit` e prova browser locale.

**Fuori perimetro:** nuovi agenti Agenzia/Distribuzione, flussi dopo l'accordo, conversazione dal vivo, pianificazione generale di ordini composti oltre Tourism, riallocazione di budget e pubblicazioni/invii autonomi. Napoli, Naples e `napolimap` restano esclusi dai lavori sulle mappe, controllati all'ingresso e dopo la risoluzione dell'identità.

**Approvazione ricevuta:** il titolare ha confermato «Sì, approvo la base #78». Implementazione e prove del primo incremento sono descritte in [rapporto dei test](UFFICIO-TEST-REPORT.md) e [guida operativa](UFFICIO-OPERATING-GUIDE.md). L'attivazione in produzione resta una fase separata e non è stata eseguita.

## 8. Implementazione consegnata

Il ramo contiene schema e RPC additive, worker con lease e checkpoint, importazione delle code, dipendenze e aggregazione degli ordini, eventi persistenti, contratti HTTP del pianificatore, API del titolare e scheda Lavori. Il piano del Direttore può proporre soltanto le deleghe tipizzate ammesse; quelle soggette a decisione restano collegate alla proposta in attesa del clic. Gli agenti spenti, occupati o senza budget mantengono il lavoro, con motivo e prossimo controllo.

Il percorso Tourism verifica sempre le prove dell'ente richiesto prima della generazione; la sola etichetta VERIFIED non basta. Ricerca, lettura e interpretazione lasciano checkpoint; approvazione e sblocco del prerequisito sono atomici. Presentazioni adotta risultati già validi e ferma ricevute dubbie. Fonti e testo si correggono sullo stesso incarico, mentre una correzione non aggira una proposta pendente.

La memoria commerciale riusa `lead_memories` per workspace/lead, con data e origine; i riepiloghi derivati non diventano prove fattuali. Backup del server e script includono le nuove tabelle. Le prove finali e i limiti osservati sono riportati separatamente, senza equiparare fixture locali e produzione.
