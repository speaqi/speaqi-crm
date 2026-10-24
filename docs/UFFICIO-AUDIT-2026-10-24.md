# Ufficio e agenti — audit operativo del 24 ottobre 2026

**Esito: la base tecnica funziona, ma l'ufficio non è ancora autonomo da un ordine al risultato. Alcuni lavori reali non sono riusciti.** Il Direttore interpreta e smista, ma non segue stabilmente l'esecuzione dei destinatari né risolve i prerequisiti mancanti. Acceso, avviato, terminato e obiettivo raggiunto sono stati diversi, oggi spesso sovrapposti.

Analisi del CRM alla revisione `c8b9a88` e del bridge StudioMap alla revisione `eded91d`. Letture sul progetto Supabase **Speaqi Crm** il 24 ottobre, fra le 23:50 e le 23:58 Europe/Rome. Nessuna scrittura in produzione, attivazione di agenti, generazione remota o pubblicazione durante l'audit. Le scritture di collaudo sono avvenute su storage temporaneo e PostgreSQL 17 isolato.

La fotografia verificabile, senza anagrafiche dei contatti, è in [audit-2026-10-24-evidence.json](ufficio/audit-2026-10-24-evidence.json). Le valutazioni sotto distinguono fatti osservati, comportamento del codice e interventi proposti. Non sono correzioni già applicate.

## 1. Che cosa è successo davvero

| Verifica in produzione | Risultato | Significato |
|---|---|---|
| Registro | 12 agenti, 5 accesi | Accesi: Direttore, My Maps, Presentazioni, Eventi, Osservatorio |
| Corse registrate | 13: 11 `done`, 2 `failed` | Gli 11 `done` comprendono report vuoti e smistamenti, non 11 obiettivi completati |
| Ordini al Direttore | 8: 6 `done`, 2 `failed` | Fra i conclusi: due smistamenti della mappa poi fallita, due presentazioni bloccate, una risposta di stato e un To Do |
| Avvii programmati dell'ufficio | 0 righe `office-*` in `automation_job_runs`; nessuna corsa con chiave `cron:*` | Le corse osservate sono manuali o avviate da ordini. Non è dimostrato il funzionamento periodico dell'ufficio |
| Altri job | Backup e ricerca Tourism presenti nello storico recente | Il pianificatore esiste ed è stato utilizzato; non basta a dimostrare che includa i job dell'ufficio |
| Eventi | 0 fonti, 0 eventi, 0 attività proposte | Agente acceso, ricerca non configurata |
| Osservatorio | 0 feed, 0 notizie | Agente acceso, rassegna non configurata |
| Presentazione Visit Buenos Aires | 0 presentazioni; report «Ente non verificato o disabilitato», poi approvato | L'ente è effettivamente `UNVERIFIED` e senza sito. Approvare il report non verifica l'ente e non genera il deck |
| Presentazione Visit Bergamo | 0 presentazioni; nuova segnalazione per ente non verificato | Secondo caso reale dello stesso blocco; ordine del Direttore `done` |
| Richiesta delle prossime fiere | Trasformata in un To Do personale | Il Direttore non ha fornito l'elenco e non ha incaricato Eventi |
| Mappa Buenos Aires | Coda presente, corsa fallita con `StudioMap HTTP 400` | Il Direttore ha smistato, ma la mappa non è stata prodotta da quella corsa |
| Finanza, Commerciale, Lingue, Qualità, Arricchimento, Pulizia, Social | Spenti e senza corse registrate | Nessuna prova operativa remota del loro funzionamento |
| Collegamento alle opportunità | 1.061 aperte, tutte `vendite`; 0 owner espliciti, 0 enti e 0 mappe collegati | Il nuovo percorso comune esiste nello schema, ma i dati non lo stanno ancora alimentando |
| Tourism → CRM | 0 collegamenti; 2 enti verificati, 149 da rivedere, 5.041 non verificati | La qualifica/verifica è un collo di bottiglia reale |
| Email | 265 bozze pendenti, 0 collegate a un'opportunità | La responsabilità unica della comunicazione non è ancora effettiva |

### Sequenza Buenos Aires, con orario di Roma

1. **15:43:** il Direttore accoda la presentazione e avvia Presentazioni. Il destinatario termina preparando soltanto una segnalazione per ente non verificato. L'ordine resta `done`.
2. **15:47:** il Direttore accoda la mappa, segnala che My Maps è spento e invita ad accenderlo e lanciarlo. L'ordine è già `done`.
3. **15:49:** un nuovo ordine ritrova la stessa voce, con My Maps acceso. L'agente parte e fallisce subito con HTTP 400. Il nuovo ordine resta `done`.
4. **23:48:** la richiesta di stato via Telegram viene elaborata e risponde con dati di piano e situazione. Questo percorso ha funzionato.

Durante l'audit sono arrivati altri ordini, inclusi nella fotografia finale delle **23:58:23**:

- **23:53:** «mi dici le prossime fiere interessanti?» viene interpretato come `task`. La risposta è «Segnato nel To Do: Ricercare e elencare le prossime fiere interessanti per Speaqi». È stato assegnato lavoro al titolare anziché svolgere la ricerca o indicare il blocco dell'agente Eventi.
- **23:55:** «Prepara la presentazione per visit bergamo» avvia Presentazioni, che prepara una nuova segnalazione «Ente non verificato o disabilitato». Nessun deck prodotto, ordine `done`.

Questi nuovi ordini sono attività esterne all'audit: non sono stati creati dai collaudi.

La coda My Maps non contiene un `source` esplicito. Il bridge richiede una My Maps nella richiesta, nei metadati della mappa o nei seed. La mancanza della fonte è quindi una spiegazione plausibile del 400, **non una causa dimostrata**: il CRM scarta il corpo dell'errore StudioMap, e in questo audit non sono stati letti i metadati remoti di Buenos Aires.

Il primo fallimento del Direttore, alle 11:28, era un HTTP 401 OpenAI. Il codice attuale usa OpenRouter e sette ordini successivi hanno completato l'interpretazione: quell'errore storico non dimostra un guasto attuale di OpenRouter. Rimane un centesimo prenotato e non saldato, oltre a sette centesimi effettivi nel ledger.

## 2. Come funziona oggi l'architettura

```text
Titolare (web / voce trascritta / Telegram)
  → ordine salvato in office_director_orders
  → corsa del Direttore, budget e validazione del piano
  → proposta da approvare / To Do / voce in settings.queue
  → tentativo di avvio del destinatario, se acceso
  → corsa e output del destinatario, con storico separato

Pianificatore nel server Next
  → endpoint autenticato di ciascun agente all'orario previsto
  → claim SQL dell'agente → handler → output/bozze/rapporti

Ufficio 3D e pannello
  ← fotografia di agenti, ultime corse, spese e proposte
```

Il collegamento decisivo manca nell'ultimo tratto: **l'esito del destinatario non aggiorna automaticamente l'ordine originario**. Non c'è un lavoro persistente comune che colleghi ordine, dipendenze, tentativi, corsa, opportunità e risultato.

La scena 3D legge dati operativi e non simula le corse. Tuttavia proietta principalmente `enabled` e l'ultima corsa: un agente acceso, senza fonti, con corsa `done`, può apparire disponibile. Il 3D non costituisce un motore di orchestrazione.

### Gli agenti e i passaggi previsti

Gli orari sono quelli del codice; il fuso generale predefinito è Europe/Rome. Eventi impone esplicitamente il proprio fuso. Questi orari non attestano l'attivazione del pianificatore remoto.

| Agente | Avvio previsto | Ingresso e risultato | Passaggio successivo attuale |
|---|---|---|---|
| Direttore | Feriali 07:30; ordini espliciti | Opportunità → piano giornaliero; proposte mappe settimanali | Le azioni sulle opportunità restano righe di un report. Gli ordini possono accodare tre specialisti e l'Agenzia prevista |
| My Maps | 01:30, un import per turno di due giorni; avvio da ordine | Coda e fonte pubblica → massimo 150 candidati | Nessun passaggio automatico generale a testi, Qualità o Lingue. L'import non completa una guida |
| Lingue e voce | 02:00 | Mappe Speaqi in coda → testi/audio mancanti entro stima e budget | Obsolete solo con approvazione; nessuna pubblicazione |
| Qualità | 04:00; avvio da ordine | Inventario o mappe in coda → rapporto e proposte | Le correzioni e la pubblicazione restano manuali |
| Pulizia database | Domenica 04:30 | Doppioni e anomalie → proposte | L'approvazione unisce i gruppi compatibili nella transazione SQL |
| Arricchimento enti | 06:00 | Destinazioni prioritarie e catalogo con siti → prove e proposta | Il clic verifica/importa nel CRM e accoda Presentazioni; nessun avvio immediato in quella rotta |
| Eventi | 06:30 a giorni alterni | Fonti configurate → eventi verificati e proposte | Il clic crea un To Do. Le query di ricerca libera non vengono eseguite |
| Osservatorio | 07:00 | Feed configurati → notizie ultime 48 ore | Telegram soltanto su azione esplicita; nessun seguito automatico per il Direttore |
| Commerciale | Feriali 08:00 | CRM, preventivi, email e scadenze → massimo 15 bozze/giorno | Revisione/invio umano; non segue una lista di incarichi assegnati dal piano del Direttore |
| Finanza | 08:30 | Preventivi pagati, fatture e scadenze → bozze e segnalazioni | Nessun invio SDI o email; condivide il blocco delle bozze pendenti |
| Social | Lunedì 09:00 | Guide online e foto verificabili → bozze per tre piattaforme | Pubblicazione umana; non riceve incarichi dalla coda degli ordini |
| Presentazioni | Lunedì 10:00; avvio da ordine | Ente/destinazione verificati → massimo due tentativi di generazione | Deck approvato in Tourism → bozza email, con ulteriori prerequisiti |

L'agente **Agenzia** è previsto dal router ma manca nel registro degli handler e nelle definizioni. La funzionalità Agency del CRM esiste; ciò non equivale a un agente d'ufficio installato. Anche Distribuzione e i flussi dopo l'accordo sono ancora fasi da costruire, come dichiara `UFFICIO-OPPORTUNITA.md`.

## 3. Problemi da correggere, ordinati per impatto

### P1 — L'ordine è concluso prima del lavoro e non riceve il risultato

**Osservato in produzione e confermato dal codice.** `executePlan` restituisce `done` appena accoda. `startQueuedAgents` lancia `runAgent` senza attenderne o registrarne il risultato sull'ordine. Inoltre `runAgent` normalmente restituisce `{run,error}` invece di rigettare la Promise: il solo `.catch()` del chiamante non intercetta quei fallimenti.

Riferimenti: `src/lib/server/office-director-orders.ts:134`, `:229`, `:298`; `src/lib/server/office-agents.ts:67`.

**Effetto:** il titolare vede un ordine concluso anche se il destinatario è spento, occupato, senza dati o fallito. Il Direttore non riprende il lavoro né riporta automaticamente il blocco.

**Intervento:** separare ricevuto, compreso, accodato, in esecuzione, bloccato, attesa approvazione, riuscito e fallito. Collegare il lavoro alla corsa e propagare l'esito al Direttore. «Ho passato il lavoro» è una ricevuta di smistamento, non un risultato.

### P1 — Avvio e recupero degli ordini non sono durevoli

**Dal codice.** Le rotte web e Telegram usano `void processDirectorOrder(...)`. L'ordine viene spostato da `received` a `working`; un riavvio può lasciare uno di questi stati senza recupero. `processDirectorOrder` non riprende ordini che non siano `received`. Se il Direttore sta già lavorando, il secondo ordine viene marcato `failed` e chiede al titolare di rimandarlo.

Riferimenti: `src/app/api/office/director/orders/route.ts:45`; `src/lib/server/office-director-orders.ts:275`, `:305`; webhook Telegram.

**Intervento:** worker che reclama ordini persistenti, con scadenza della presa in carico e recupero. Il secondo ordine deve aspettare, non chiedere un nuovo invio. Distinguere il recupero di un'operazione certamente non partita dalla riconciliazione di una spesa incerta.

### P1 — Non è verificato l'avvio programmato dell'ufficio

**Osservato:** nessun job `office-*` nello storico e nessuna chiave `cron:*` nelle corse. Gli agenti sono stati installati/attivati da poco, quindi non tutti gli orari successivi sono ancora trascorsi. Non si può concludere soltanto da questo che la configurazione sia sbagliata.

Il codice richiede congiuntamente `AUTOMATION_SCHEDULER_ENABLED=true`, secret, workspace, migrazioni, server attivo e inclusione dei job in `AUTOMATION_SCHEDULER_JOBS`. Un elenco con solo `backup` esclude l'ufficio anche quando i suoi interruttori sono accesi.

Riferimenti: `src/instrumentation.ts`; `src/lib/server/automation-scheduler.ts:176`; `src/lib/automation-schedule.ts`.

**Intervento:** verificare la configurazione del server e osservare il primo slot dovuto di ogni agente attivo. Esporre ultimo battito, prossima corsa, job incluso/escluso e prerequisiti. Non accendere indiscriminatamente tutte le automazioni: il registro comprende anche altri flussi del CRM.

### P1 — Il pianificatore può registrare successo quando l'agente è fallito

**Riprodotto localmente.** La rotta di automazione restituisce HTTP 200 se il fallimento ha una riga `run`. Il pianificatore considera soltanto `response.ok` e non legge lo stato della corsa nel JSON. Risultato: `run.status=failed` può produrre `automation_job_runs.ok=true` e nessun avviso.

Riferimenti: `src/app/api/automation/agents/[id]/run/route.ts:21`; `src/lib/server/automation-scheduler.ts:66`.

**Intervento:** contratto esplicito fra rotta e pianificatore: successo operativo, salto legittimo, blocco e fallimento. Gli errori applicativi devono raggiungere lo storico e gli avvisi senza trasformare un agente spento in un falso incidente.

### P1 — La verifica dell'ente non è una dipendenza della presentazione

**Osservato.** Il Direttore trova un'organizzazione per nome, senza verificarne stato, sito, copertura o destinazione. Accoda Presentazioni, che invece richiede ente e destinazione `VERIFIED`. Visit Buenos Aires e Visit Bergamo si fermano esattamente qui.

Riferimenti: `src/lib/server/office-director-orders.ts:144`, `:237`; `src/lib/server/office-agents/presentations.ts:12`; `src/lib/server/office-agents/entity-enricher.ts:65`.

**Intervento:** controllare i prerequisiti prima dello smistamento e passare a ricerca/verifica quando mancano. L'Arricchimento attuale non accetta incarichi liberi dal Direttore: sceglie destinazioni prioritarie e organizzazioni con sito. Per questo ente, privo di sito, serve prima individuare una fonte. L'approvazione di un semplice report non deve sembrare uno sblocco.

### P1 — Correggere la fonte di una mappa già accodata non aggiorna la coda

**Riprodotto su PostgreSQL locale.** Primo ordine: Marsiglia senza link. Secondo: stessa città con link. La chiave rimane `build_map:marsiglia`, la RPC restituisce `already_queued` e il `source` resta nullo.

Riferimento: `supabase/migrations/20261024090000_office_director_orders.sql:60`.

**Intervento:** distinguere il duplicato identico dall'integrazione/correzione di un incarico bloccato. Versionare il payload e registrare chi lo modifica; non cambiare in silenzio un lavoro già in esecuzione. Conservare e mostrare il motivo dettagliato del 400 StudioMap, oggi eliminato dal bridge CRM.

### P2 — Le code non garantiscono ordine, avanzamento o assenza di attese indefinite

**Riprodotto e letto nel codice.** My Maps usa `mymaps:<turno>` come chiave globale: dopo un import nel turno, una nuova città viene saltata. La scelta è `queue[slot % queue.length]`, non l'incarico che ha appena causato l'avvio. Le voci non hanno un ciclo di consumo comune. Lingue legge sempre `entries.slice(0,6)`: con almeno sette mappe e prime sei mantenute in coda, le successive possono non essere mai visitate.

Riferimenti: `src/lib/server/office-agents/mymaps.ts:17`; `src/lib/server/office-agents/languages-voice.ts:83`.

**Intervento:** separare le mappe da monitorare periodicamente dai lavori puntuali. Dare ai lavori stato, priorità, scadenza e cursore; limitare quantità/spesa per corsa senza perdere il progresso. Un ordine esplicito deve ricevere esecuzione o una data/motivazione di attesa verificabile.

### P2 — Il clic che accoda non avvia sempre il destinatario

Le approvazioni generiche passano da `decide_office_output`, che aggiorna la coda nella transazione. La rotta non chiama `startQueuedAgents`. Vale per le proposte mappe del Direttore e per Arricchimento → Presentazioni. Se il pianificatore è attivo, Presentazioni può aspettare fino al lunedì; senza pianificatore aspetta un avvio manuale. L'approvazione del contatto dal Direttore usa invece un percorso diverso, con avvio immediato.

Riferimenti: `src/app/api/office/outputs/[id]/route.ts`; `supabase/migrations/20261023120000_office_entity_enricher.sql`.

**Intervento:** usare un unico evento persistente di lavoro pronto dopo il commit, con politica esplicita: subito, prossimo turno o attesa di autorizzazione. Un agente riacceso deve riprendere i lavori eleggibili senza richiedere di ricreare l'ordine.

### P2 — Il Direttore non governa ancora tutte le squadre né le comunicazioni

L'interprete ammette una sola intenzione per ordine: contatto, mappa, controllo, presentazione, stato, To Do o richiesta di chiarimento. La RPC degli ordini accetta My Maps, Qualità, Presentazioni e Agenzia futura. Non consente di assegnare direttamente lavori a Commerciale, Finanza, Social, Eventi, Osservatorio, Arricchimento o Lingue. Le azioni del piano giornaliero sono contenuto del report, non incarichi eseguibili con dipendenze.

La richiesta reale delle prossime fiere, trasformata in un To Do, dimostra anche il limite del router: manca un'intenzione di ricerca eventi e manca il passaggio verso il relativo specialista. Questo fallback va limitato alle richieste in cui il titolare vuole davvero annotare un'attività personale.

L'introduzione di `deals.owner` ed `email_drafts.deal_id` non impone la responsabilità: `create_office_email_draft` non passa `deal_id` e non verifica l'owner; Commerciale sceglie dai dati CRM, non dagli incarichi del Direttore. L'orchestratore storico si ferma se Commerciale è acceso, una protezione utile ma incompleta. In produzione nessuna opportunità ha owner e nessuna bozza pendente ha `deal_id`.

**Intervento:** far viaggiare insieme opportunità, responsabile e scopo della comunicazione. Presentazioni produce il materiale; Commerciale gestisce la comunicazione commerciale; Finanza i solleciti contabili. Il Direttore decide priorità e passaggi entro le autorizzazioni del titolare, evitando incarichi concorrenti sulla stessa comunicazione.

### P2 — Il percorso contatto non è atomico e la deduplicazione è solo consultiva

`findDuplicates` mostra possibili corrispondenze ma `approveDirectorContact` non le rilegge per scegliere fra inserimento e aggiornamento. Il `legacy_id` impedisce la duplicazione dello stesso output; due ordini distinti per la stessa persona hanno identificativi diversi.

Creazione contatto, trattativa, task, attività, accodamento e chiusura proposta sono più operazioni. Se il contatto viene inserito e una fase successiva fallisce, il tentativo seguente ritrova il contatto e salta `createLeadFromInput`: non ripara automaticamente le sue fasi mancanti. Anche il fallimento dell'apertura dell'opportunità può diventare soltanto una nota.

Riferimenti: `src/lib/server/office-director-orders.ts:158`, `:356`; `src/lib/server/lead-ops.ts:106`.

**Intervento:** decisione esplicita collega/aggiorna/crea, con ricontrollo al clic; transazione o passaggi persistenti e riprendibili. Mantenere la protezione contro i clic simultanei già esistente.

### Altri limiti rilevanti

- **Fonti vuote:** Eventi e Osservatorio possono terminare correttamente il processo senza fare ricerca. Serve uno stato operativo «da configurare» distinto dal successo utile. I competitor configurati non sostituiscono i feed.
- **Errori assorbiti:** Lingue, Arricchimento ed Eventi registrano alcuni errori nel report e restituiscono normalmente; `runAgent` li chiude `done`. Il riepilogo deve distinguere lavoro riuscito, parziale, bloccato e nessun lavoro necessario.
- **Contabilità:** il riepilogo del Direttore arrotonda gli euro all'intero: cinque centesimi risultano «0 €». Riprodotto. Il ledger conserva la spesa. Lingue salda la stima al lancio, non un consuntivo remoto; un costo effettivo oltre stima viene registrato dal sistema, quindi la riserva non garantisce matematicamente un tetto al costo finale del fornitore.
- **Cronologia migrazioni:** oggetti e colonne del 24 ottobre esistono, ma nello storico interrogato non risultano le versioni locali `20261024090000` e `20261024120000`; lo storico contiene anche versioni differenti. Va riconciliato il deploy, senza riapplicare alla cieca le migrazioni su oggetti esistenti.
- **Ordini composti e dialogo:** non esistono piano a più passi, dipendenze generali, sospensione/ripresa/cancellazione o un riferimento di conversazione usato dal parser. Una domanda di chiarimento non crea una conversazione riprendibile sullo stesso lavoro.
- **Interfaccia:** mostra interruttori, corse, costi e proposte, ma manca una vista unificata dei lavori con motivo del blocco, destinatario, prerequisito e prossima azione. Il browser non è stato ricollaudato in questo audit; i test di proiezione e del bundle sono inclusi nelle verifiche applicative.

## 4. Che cosa funziona e va mantenuto

- Ordine salvato prima dell'elaborazione e accessi API riservati al titolare.
- Claim SQL atomico delle corse, esclusione delle esecuzioni contemporanee dello stesso agente e idempotenza per chiave.
- Recupero delle corse scadute senza liberare arbitrariamente riserve di spesa incerte. Il recupero avviene al claim successivo, non grazie a un monitor generale dei lavori.
- Prenotazioni concorrenti, tetti giornalieri/settimanali/mensili, saldi idempotenti, registrazione della spesa effettiva.
- RLS attiva sulle cinque tabelle centrali controllate; RPC privilegiate verificate non eseguibili da `anon` o `authenticated`, ma dal service role.
- Proposte, prove e bozze con separazione dalle azioni esterne. Nessun invio automatico dell'ufficio nei percorsi esaminati.
- Unione dei doppioni, approvazione eventi e arricchimento con controlli transazionali specifici, verificati nei test SQL.
- Protezioni di Napoli nei flussi cartografici esaminati; collaudi StudioMap su storage temporaneo.
- Bridge My Maps con limiti, ricevute e deduplicazione; Qualità con letture e campionamento limitato.
- Richiesta di stato via Telegram realmente riuscita dopo il cambio di trasporto del modello.

## 5. Come devono intrecciarsi per funzionare in autonomia

La gerarchia deve essere: **il titolare definisce obiettivo e autorizzazioni; il Direttore pianifica e assegna; gli specialisti eseguono e rendicontano**. Le regole e i limiti del titolare restano vincolanti anche per il Direttore.

Ogni lavoro dovrebbe contenere almeno: `order_id`, eventuale `deal_id`, destinatario, azione ammessa, dati/versione, priorità, dipendenze, budget massimo, chiave di idempotenza, stato, motivo del blocco, prossima esecuzione, tentativi, corsa e output prodotti. Le impostazioni dell'agente rimangono configurazione; il lavoro operativo merita uno storico proprio.

```text
Ordine del titolare
  → Direttore: capisce, controlla i prerequisiti, prepara il piano
  → lavoro persistente assegnato a uno specialista
      → pronto: avvio automatico se autorizzato, acceso e nel budget
      → prerequisito mancante: incarico al responsabile della verifica
      → decisione umana necessaria: proposta con effetto esplicito
      → occupato/spento/budget: attesa tracciata, senza perdere l'ordine
  → risultato dello specialista
  → Direttore: verifica l'esito, sblocca il passo successivo o segnala il blocco
  → risultato finale al titolare
```

Regole operative proposte:

1. Un ordine esplicito riceve precedenza sui lavori ordinari compatibilmente con lavori già iniziati, scadenze e limiti. Una modifica del titolare versiona il piano; una proposta autonoma non può annullarla.
2. Gli agenti possono lavorare in parallelo su incarichi indipendenti. Lo stesso oggetto/operazione ha un'esclusione comune per evitare conflitti fra agenti diversi, oltre al lock già presente per singolo agente.
3. Il Direttore non invia comandi liberi che eludono i controlli: assegna azioni tipizzate che lo specialista valida. Non può accendere agenti, aumentare budget, inviare o pubblicare senza la relativa autorizzazione.
4. Completare un prerequisito deve rendere eseguibile il lavoro dipendente dopo il commit. Riavvio del server, agente occupato e riaccensione non devono richiedere un nuovo ordine.
5. Errori di dati/configurazione richiedono una correzione precisa; errori transitori consentono tentativi limitati; effetti economici incerti richiedono riconciliazione, non rilanci ciechi.
6. Ogni risposta deve dire che cosa è riuscito, che cosa aspetta, chi lo farà e quando. «Fatto» solo dopo un risultato verificabile.

Percorsi concreti:

- **Tourism:** scoperta/fonte → Arricchimento → approvazione della verifica/importazione → opportunità con owner → Presentazioni → revisione deck → bozza del Commerciale → trattativa.
- **Mappe:** ordine con fonte valida → import My Maps → eventuale lavorazione editoriale nel flusso già autorizzato → Qualità → decisione di pubblicazione → Lingue e voce quando applicabile. Importare candidati non equivale a una guida pronta.
- **Partner:** contatto qualificato → opportunità Distribuzione → proposta/pilota → accordo → attivazione link/QR → misure → ritorno al Direttore. Le ultime fasi non sono ancora implementate come flusso autonomo completo.
- **Finanza:** pagamento/quote → bozza fattura; insoluto → sollecito con responsabilità contabile; un problema torna al Direttore con causa e azione richiesta.
- **Eventi/Osservatorio/Social:** producono segnali o materiali; soltanto quelli che richiedono una decisione diventano incarichi o proposte. I report vuoti non devono intasare «Aspetta te» come se fossero risultati utili.

## 6. Ordine di intervento consigliato

1. **Rendere leggibili i blocchi reali:** dettaglio del 400 StudioMap; prerequisiti di Visit Buenos Aires; fonti Eventi/Osservatorio; configurazione e prossimo slot dei job. Non sbloccare modificando semplicemente le etichette di stato.
2. **Chiudere il ciclo ordine → lavoro → esito:** coda durevole, recupero, collegamento delle corse, stati corretti e avvisi attendibili. È il prerequisito per promettere autonomia.
3. **Uniformare i passaggi:** correzioni dei payload, approvazione → lavoro pronto, equità delle code, dipendenze ricerca/verifica/presentazione e priorità degli ordini espliciti.
4. **Rendere effettivo il percorso opportunità:** assegnazione, `deal_id` nelle bozze, responsabilità della comunicazione e riconciliazione del deploy. Poi completare Agenzia, Distribuzione e dopo-accordo.
5. **Collaudo completo su dati isolati:** ordine composto, destinatario occupato/spento, riavvio, budget finito, fonte corretta dopo un errore, due ordini concorrenti, settima mappa in coda, rifiuto umano, approvazione e restituzione dell'esito finale. Solo dopo, osservazione dei turni reali autorizzati.

## 7. Verifiche eseguite

| Controllo | Esito |
|---|---|
| 18 file applicativi: Ufficio, pianificatore e opportunità, eseguiti direttamente con `node --import tsx <file>` | **166 test superati** |
| StudioMap: `office-mymaps.test.ts`, `office-quality.test.ts`, storage temporaneo | **14 test superati** |
| 12 file DB: Ufficio e opportunità, PostgreSQL 17 isolato; Finanza usa PGlite nella propria suite | **75 test superati** |
| Riproduzioni aggiuntive: seconda mappa nello stesso turno; errore HTTP 200 considerato successo; centesimi mostrati a zero | **3 comportamenti difettosi confermati** |
| SQL locale: aggiornamento fonte con stessa chiave, dentro transazione annullata | **Difetto confermato: `already_queued`, fonte ancora nulla** |
| TypeScript CRM `tsc --noEmit` | Superato |
| Produzione Supabase | Letture di agenti, code, corse, ordini, output, ledger, pianificatore, catalogo, collegamenti, privilegi e migrazioni |
| Browser/deploy/corse a pagamento | Non eseguiti durante questo audit |

Le dipendenze locali inizialmente erano incomplete (`cheerio` mancante); ripristinate con `npm ci --ignore-scripts` prima delle verifiche definitive. Il runtime del collaudo è Node 24.19; il CRM dichiara Node 20: resta da ripetere l'accettazione sul runtime di produzione. Nessun lockfile o sorgente applicativo modificato dall'audit.

Il test runner con `--test` in questo ambiente riportava solo i file: per evitare di contare caricamenti come singoli casi, i conteggi finali provengono dall'esecuzione diretta dei file e dai loro risultati interni. I test verdi verificano i contratti esistenti; non coprivano le lacune di orchestrazione riprodotte qui.
