# Un ordine del Direttore per una mappa demo completa

**Verifica del 25 ottobre 2026. Stato: audit dei sorgenti e specifica di implementazione; comando completo non ancora installato.**

Obiettivo del titolare: chiedere una demo per una destinazione e ricevere il massimo risultato documentabile attraverso i servizi e gli agenti disponibili, senza impartire un ordine per ogni passaggio. Esempio di comportamento richiesto: «Crea una mappa demo di Marsiglia, con punti, foto, testi, itinerari, traduzioni e audio. Tienila in bozza». I numeri di punti e lingue sono parametri del profilo demo o dell'ordine, non un'autorizzazione di spesa illimitata.

## 1. Cosa funziona oggi, e dove si ferma

Il CRM interpreta `build_map` e crea **un solo lavoro `import_mymaps`**. Non costruisce un grafo per ricerca, redazione, qualità, bozza Speaqi e traduzioni. Una ricevuta d'importazione prova l'import, non una demo pronta. Il bridge Ufficio di StudioMap espone soltanto import My Maps e lettura della qualità; i suoi endpoint non autorizzano generazione o sync.

StudioMap dispone già di pipeline ben più ampie. Non occorre riscrivere raccolta, redazione o traduzione, né fingere che ogni fase sia un nuovo agente installato nel CRM.

| Passaggio | Capacità esistente | Collegamento mancante dal Direttore |
|---|---|---|
| Identità e perimetro | Mappa rapida: risoluzione del territorio, centro, confine e comuni | Destinazione normalizzata e verificata, con paese e identificativo del lavoro |
| Ricerca dei luoghi | Mappa rapida: Google a zone, Wikipedia, classificazione, deduplica e selezione; import My Maps come altra sorgente | Scelta della pipeline in base alle fonti; una My Maps non deve essere obbligatoria per qualsiasi demo |
| Schede e foto | Creazione schede, arricchimento e materiale delle fonti | Esecuzione su una demo isolata, dentro il budget autorizzato |
| Testi | Scrittura, rilettura e verifica dei fatti; completamento dei testi mancanti | Preventivo, riserva, checkpoint e verifica del risultato collegati al lavoro CRM |
| Temi e itinerari | `full-flow`: temi, itinerari, preparazione e selezioni | Pianificazione prima dei testi: non aggiungere punti e scrivere nello stesso giro del full-flow |
| Qualità | Readiness, coda di revisione, gate finale; agente Qualità per rapporti | Controllo dell'intera demo e delle coperture, distinto dal campione massimo di 20 luoghi dell'agente periodico |
| Mappa e progetto Speaqi | Bootstrap idempotente in bozza, sync punti e itinerari con ricevute | Capability autenticata e limitata alla demo dell'incarico; verifica della destinazione e del proprietario |
| Lingue e audio | API di copertura, stima, `fill`, stato e richiesta idempotente; agente Lingue e voce | Dipendenza dalla bozza sincronizzata, prenotazione dei costi e attesa della copertura effettiva |
| Anteprima e risultato | Anteprima della bozza per proprietario/admin | Ricevuta finale aggregata e link realmente apribile dal titolare; una bozza non è un link pubblico per clienti |

Fonti verificate: CRM `07ee8bc` (#89); StudioMap `eded91d`; Speaqi `395acb5d` (confrontato con la copia locale `75676003`, nessuna differenza nei contratti Maps esaminati).

## 2. Contratto del comando unico

Introdurre **un intento distinto, `create_map_demo`**, preservando il significato e i costi dell'importazione My Maps esistente. L'interprete estrae solo parametri ammessi: destinazione, paese se risolto, profilo/punti, lingue e richiesta di audio/itinerari. Il codice valida il piano; il modello non sceglie endpoint, permessi o importi spendibili.

Un solo ordine possiede tutto il percorso:

```text
Ordine e profilo demo
  → identità, paese e perimetro della destinazione
  → preventivo e disponibilità dei budget
  → nuova copia demo isolata
  → raccolta, selezione e deduplica dei luoghi
  → temi e itinerari richiesti, poi selezione definitiva
  → schede, foto, fonti e testi dei punti rimasti
  → verifica editoriale e qualità
  → creazione/sync della bozza Speaqi
  → traduzioni e audio nelle lingue richieste
  → controllo delle coperture e dell'anteprima
  → risultato finale sullo stesso ordine
```

Il Direttore governa il piano e il risultato aggregato. Costruttore mappe coordina i servizi StudioMap; ricerca, redazione e verifiche restano i passaggi della pipeline già esistente. Qualità e Lingue mantengono le proprie responsabilità. Il CRM conserva lavoro, dipendenze, tentativi e budget; StudioMap resta il proprietario editoriale; Speaqi gestisce bozza, media e contenuti multilingua.

## 3. «Il massimo disponibile» deve avere un significato verificabile

- Cercare copertura e varietà adatte al territorio, non riempire un numero con luoghi deboli o fuori zona. Il profilo demo fissa un massimo di punti e un massimo di costo, non un minimo di fatti da inventare.
- Riutilizzare fonti, risposte in cache e risultati validi; completare le parti mancanti. Un risultato mancante resta dichiarato mancante.
- Foto con provenienza e diritti gestiti dalla pipeline; coordinate coerenti col perimetro; identità distinte e doppioni risolti.
- Testi supportati dal materiale raccolto, con verifiche e problemi visibili. Una segnalazione non si elimina per ottenere il bollino «pronto».
- Itinerari e temi solo quando i punti e le fonti li sostengono. Dichiarare quelli non disponibili.
- Traduzioni e audio nelle lingue previste dal profilo/ordine, controllati al termine. `started:true` non equivale a copertura completa.
- Nessuna generazione video o acquisto aggiuntivo impliciti nella parola «massimo».

Il risultato deve riportare almeno: punti richiesti/selezionati/pronti, copertura geografica e categorie, foto, testi, itinerari, copertura testo/audio per lingua, problemi aperti, costi con natura del dato (effettivo/stimato/da riconciliare), link di anteprima e prossimo passo.

## 4. Destinazione corretta e protezione dei dati esistenti

**«Marsiglia anziché Barcellona» deve cambiare il bersaglio del piano, non soltanto l'etichetta.** Nome, paese, perimetro, lingua di base, fonti, cache della lavorazione, slug StudioMap, ID Speaqi e ricevute devono essere coerenti con la stessa versione dell'incarico.

Per una nuova demo usare uno slug dedicato e stabile per workspace, lavoro e versione. Non usare l'import My Maps per cercare una mappa esistente per alias e poi considerarla automaticamente una demo: l'import attuale può adottare una mappa già presente. Il nuovo adattatore deve poter dimostrare che quella copia appartiene alla lavorazione e che non è collegata a una guida live.

Prima di effetti esterni, una correzione aggiorna la revisione dello stesso lavoro e ricalcola il piano. Dopo l'avvio, fermare i passi ancora modificabili e gestire esplicitamente la versione precedente; nessun riuso di ricevute o contenuti della destinazione sbagliata. Una risposta tardiva non completa la nuova versione.

Paese e località ambigui richiedono una domanda sullo stesso incarico. `settingsForQuickMap` usa Italia come fallback per una destinazione fuori catalogo: il nuovo comando non deve applicare quel fallback a una destinazione estera non risolta.

Napoli, Naples e `napolimap` restano esclusi: controlli all'ingresso e dopo la risoluzione dell'identità. Nessuna prova o scrittura sulle mappe operative; prove di integrazione su copie temporanee di Marsiglia/Barcellona.

## 5. Il nodo dei costi: non basta aggiungere un endpoint

Il ledger CRM, il budget locale della pipeline StudioMap, le quote Google e le elaborazioni Speaqi sono confini differenti. `RunBudget` di StudioMap limita le chiamate dei modelli; il preventivo Mappa rapida espone separatamente Google e AI. Il completamento manuale della città usa attualmente `RunBudget(Number.MAX_VALUE)`: **non è un ingresso da assegnare automaticamente al Direttore**.

Occorre un contratto remoto con stima, massimo autorizzato e ricevuta per operazione. La riserva deve precedere tutte le chiamate a pagamento, comprese quelle Google, e restare valida attraverso cambi di processo e repliche. Un preventivo non è un costo effettivo; una cache non è un nuovo costo da addebitare.

Il worker CRM considera giustamente da riconciliare una riserva non saldata. Un job remoto lungo, però, può essere ancora in corso: non può essere simulato come una normale chiamata sincrona né saldato in anticipo al costo stimato per far passare il controllo. Serve distinguere **operazione remota identificata e attiva** da **esito economico incerto**, conservare la prenotazione e chiuderla con una ricevuta finale. Il saldo dopo un nuovo turno deve verificare workspace, lavoro, versione, operazione e lease correnti anche quando il ledger appartiene alla corsa di avvio.

Budget insufficiente: lavoro in attesa con motivo, responsabile e prossimo controllo. Nessun aumento implicito dei tetti. I controlli già saldati non si ripagano quando cambia il giorno o il processo.

## 6. Recupero e contratti fra i servizi

Estendere il bridge forte esistente con operazioni chiuse per: **stima**, **avvio**, **stato/ricevuta**, **arresto** e **sincronizzazione della sola bozza**. Non dare al modello o al browser accesso generico alle API manuali o a un endpoint di pubblicazione.

Ogni richiesta porta un'identità stabile di operazione e un fingerprint di destinazione, versione e profilo. Un avvio ripetuto restituisce la stessa ricevuta. Lo stato remoto deve poter essere riletto senza ripetere l'effetto; una ricevuta deve attestare cosa è stato completato e quali prenotazioni rimangono.

StudioMap ha già `PersistentJobs` e checkpoint della Mappa rapida. Un job recuperato può risultare interrotto: il CRM deve verificarne i checkpoint, non trasformare `done=true` in successo. La fase `fine` della Mappa rapida può inoltre esistere senza testi quando `writeTexts=false`: controllare il contenuto, non solo il nome della fase.

Un timeout di avvio non prova che la lavorazione non sia partita. Cercare la ricevuta mediante ID stabile; se non si ricostruiscono stato ed effetti, bloccare per riconciliazione senza un secondo avvio cieco. Arresto e cambio destinazione devono essere osservati prima di ulteriori chiamate a pagamento e salvataggi, non soltanto nella schermata del job.

## 7. Risultato e approvazioni

Per chiudere una demo completa servono: identità territoriale coerente, copia di lavorazione identificata, contenuti richiesti con controlli conclusi, ID di mappa e progetto Speaqi appartenenti al workspace, bozza confermata, sync senza righe rifiutate, traduzioni/audio conclusi nelle lingue richieste, anteprima accessibile al titolare e costi riconciliati. Ogni esenzione va dichiarata nel profilo iniziale o decisa esplicitamente, non dedotta dal modello a fine lavoro.

Se il percorso produce una demo parziale utile, renderla consultabile e indicare le mancanze; l'ordine che chiedeva una demo completa resta in attesa/bloccato finché i requisiti non sono soddisfatti. Non chiamare «pronta» una mappa vuota, un job avviato o una sola importazione.

Un ordine iniziale deve autorizzare il percorso entro i limiti già configurati, senza richiedere un comando per ogni agente. Restano le sole decisioni sostanziali previste dalle policy: dati ambigui, superamento del budget autorizzato, problemi editoriali non risolti e pubblicazione esterna. Dopo il clic si riprende dallo stesso punto.

La demo nasce in bozza: l'API Speaqi crea una mappa con `is_draft=true`; `isMapOpenToPublic` esclude le bozze e `canPreviewDraftMap` ammette proprietario/admin. Il link della mappa non basta per farla vedere a un cliente anonimo. Un eventuale link demo esterno richiede un percorso di anteprima autorizzato da implementare/verificare oppure un atto esplicito di pubblicazione. Non attivare trial, prezzi, distribuzione o abbonamenti come effetto collaterale della creazione.

## 8. Incrementi necessari e prova di accettazione

1. **Budget e ricevute dei job remoti:** preparare prenotazioni persistenti, contratto del bridge e riconciliazione dei costi. È la dipendenza che impedisce un collegamento superficiale alle API manuali.
2. **Incarico demo:** intento distinto, profilo validato, identità geografica, copia isolata e grafo dei passi nel registro esistente. Niente nuovo framework o nuovo registro commerciale.
3. **Produzione editoriale:** riuso della raccolta, selezione, temi/itinerari e testi nei rispettivi tempi; qualità completa della demo, senza applicazioni automatiche alle mappe operative.
4. **Bozza e copertura:** bootstrap/sync con ID persistenti, lingue/audio con attesa delle ricevute, anteprima e risultato aggregato.
5. **Collaudo completo isolato:** stesso ordine dal testo alla demo apribile, senza servizi a pagamento. Solo dopo esiti verificati si programma un collaudo reale con destinazione e tetto di spesa espliciti.

| Scenario di accettazione | Esito richiesto |
|---|---|
| «Demo di Marsiglia» con fonti disponibili | Un ordine, demo isolata, contenuti e coperture richieste verificati, anteprima del titolare |
| «Marsiglia anziché Barcellona» prima/dopo l'avvio | Destinazione e ricevute coerenti con la revisione; nessuna modifica alla guida sbagliata |
| Nessuna My Maps | Uso della raccolta alternativa configurata; nessuna falsa necessità di un link My Maps |
| Agente spento, occupato, browser chiuso | Lavoro conservato e ripreso dal worker, senza riaccendere agenti o chiedere di rimandare l'ordine |
| Budget finito o job lungo | Prenotazione corretta, fase remota distinguibile dall'esito incerto; nessuna spesa ripetuta |
| Doppio avvio, riavvio e risposta tardiva | Una sola operazione per lavoro/versione/fase e adozione della ricevuta corretta |
| Una lingua o un audio falliti | Artefatto parziale visibile; nessuna falsa chiusura dell'ordine completo |
| Bozza già online o di altro workspace | Rifiuto prima di qualsiasi modifica; nessun riuso implicito di guida live |
| Napoli o suo alias | Nessun avvio e nessuna scrittura |

## 9. Evidenza eseguita e limiti

Eseguite suite preesistenti StudioMap su storage temporaneo con provider/rete simulati:

| Comando | Esito |
|---|---|
| `node --import tsx test/quick-map.test.ts` | 30 casi superati |
| `node --import tsx test/speaqi-publish.test.ts` | 11 casi superati |
| `node --import tsx test/speaqi-translations.test.ts` | 10 casi superati |
| `node --import tsx test/jobs-refresh.test.ts` | 1 caso superato |
| `node --import tsx test/full-flow.test.ts` | 16 casi superati |

**Totale: 68 casi superati, nessun errore.** Queste prove validano componenti esistenti. **Non provano il nuovo comando unico**, che richiede gli incrementi sopra, né l'esecuzione remota con chiavi reali, né la visibilità di un link demo a clienti anonimi. Nessun dato di produzione, mappa Napoli, generazione reale o configurazione degli agenti è stato modificato durante questa verifica.

Sorgenti centrali: CRM `src/lib/server/office-work-handlers.ts`, `src/lib/server/office-work.ts`, `src/lib/server/office-agents/maps-bridge.ts`; StudioMap `src/office-mymaps.ts`, `src/quick-map/run.ts`, `src/full-flow.ts`, `src/city-completion.ts`, `src/run-budget.ts`, `src/jobs.ts`, `src/speaqi-sync.ts`, `src/publish-all.ts`; Speaqi `apps/api/src/maps/maps-studiomap.controller.ts`, `map-studiomap-sync.service.ts`, `map-translation.service.ts`, `map-public-visibility.ts`.
