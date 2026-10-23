# Ufficio CRM — analisi e implementazione

23 ottobre 2026 · Orari Europe/Rome.

La base operativa esiste e supera i controlli locali: 12 agenti, budget atomici, code, approvazioni, API riservate al titolare. Il vecchio 3D era invece una dimostrazione statica scollegata dal CRM. Questa modifica lo sostituisce con due architetture selezionabili, entrambe collegate ai dati operativi.

**Ambito verificato:** codice, migrazioni su PostgreSQL locale usa e getta, logica con servizi simulati e browser sulla build di produzione locale. Non è una certificazione dello stato del server remoto: in questo ambiente mancano le credenziali operative e non sono state eseguite corse a pagamento, invii o pubblicazioni. Nessun deploy eseguito.

## Due proposte, entrambe implementate

| | Torre Speaqi | Studio open space |
|---|---|---|
| Struttura | Edificio in sezione su quattro piani, due reparti per livello e area comune al piano terra | Sette aree su una pianta unica, sala riunioni e zona lounge |
| Gerarchia | P3 Direzione/Mappe, P2 Ricerca/Commerciale, P1 Finanza/Marketing, P0 Operazioni | Aree numerate, partizioni basse e colori costanti per reparto |
| Ispezione | Il reparto selezionato si apre; gli altri e le strutture che lo coprirebbero vengono nascosti | Avvicinamento all’area selezionata e isolamento delle altre squadre |
| Punto forte | Visione della struttura aziendale; lettura dei reparti anche in una finestra stretta | Confronto immediato delle squadre e sensazione di collaborazione |
| Limite | I piani in basso restano parzialmente coperti nella vista generale, risolto entrando nel reparto | Su telefono la vista generale è più piccola, affiancata dal pannello testuale |

La **Torre**, scelta come vista iniziale, sfrutta meglio lo spazio verticale e rende chiara la divisione dei settori. Lo **Studio** è disponibile nella stessa pagina, senza duplicare dati o funzioni. La torre è stata resa più alta aumentando l’interpiano da 4,8 a 5,6 unità, con il logo originale Speaqi sul coronamento e nella testata. Il logo è incluso nella build. Gli interni includono piante alte, fioriere e vasi sulle credenze; pavimenti e pannelli acustici riprendono il colore del reparto: lilla per Direzione, verde per Mappe, azzurro per Ricerca, terracotta per Commerciale, ocra per Finanza, rosa per Marketing e blu ardesia per Operazioni. Entrambe offrono giorno/sera, rotazione, zoom, ritorno alla vista completa, selezione da tastiera e pannello accessibile.

> **Aggiornamento (23 ottobre, pomeriggio).** Torre e studio sono stati sostituiti da un solo **campus 3D**: sette padiglioni sempre visibili, gli agenti come persone con la maglia Speaqi (al computer, al caffè, in piedi con il «!», addormentati se spenti) e un clic che avvicina la camera senza nascondere gli altri reparti. Descrizione aggiornata in `CLAUDE.md`, voce **Ufficio**. La tabella qui sopra resta come storia della proposta precedente.

Anteprime con **dati simulati**, non dati del workspace remoto:

- [Campus](ufficio/campus.png)
- [Campus di sera](ufficio/sera.png)
- [Telefono](ufficio/mobile.png)
- [Dentro un padiglione, con un agente scelto](ufficio/reparto.png)

## Problemi trovati e corretti

| Problema precedente | Evidenza | Correzione |
|---|---|---|
| Sfarfallio dei pavimenti | La terrazza aveva il bordo superiore a `LEVEL_Y + 0.16`; il pavimento delle case aveva la stessa quota. Due superfici sovrapposte competono nel depth buffer (z-fighting) | Un unico solaio per piano e rivestimenti solidi con il bordo inferiore a +0.03 rispetto alla superficie del solaio; niente superfici coplanari |
| Ambiente poco coerente con un ufficio | Scogliera, mare, case, porto e funicolare | Sostituiti da edificio in sezione o studio, con materiali opachi, arredi, finestre, piante e colori sobri |
| Persone, attività, modelli e spese inventati | Array statici `DEPTS`/`QUEUE` e `logEvent()` casuale; modelli e ruoli non corrispondenti al registro installato | Dati proiettati da `/api/office`; nessun agente simulato o attività casuale nell’interfaccia |
| Valuta errata per i dati operativi | Il 3D mostrava stime in dollari; il ledger usa centesimi di euro | Euro, spesa effettiva e importi prenotati distinti |
| “Acceso” confuso con “al lavoro” | La simulazione non leggeva le corse | “In corso” solo con una corsa `running`; “Disponibile”, “Spento” e “Da verificare” distinti |
| Nessun collegamento fra visualizzazione e lavoro | Il 3D non conosceva gli output reali | Apertura della proposta specifica o della scheda agente nella gestione autenticata |
| Dipendenza da CDN e font esterni | Three.js, addon e font scaricati all’apertura | Motore e controlli inclusi nella build; font di sistema, nessuna richiesta esterna necessaria alla scena |
| Iframe con privilegi impliciti della pagina | `srcDoc` senza sandbox | Sandbox con soli script; nessun accesso a storage/sessione. Il genitore invia solo la proiezione necessaria, senza token, settings o corpi delle bozze |
| Errori senza percorso alternativo pratico | Messaggio sul loader del 3D | Errori dati con recupero e ultimo snapshot conservato; in assenza di WebGL il pannello resta navigabile e agenti/bozze restano accessibili |
| Telefono: il menu spingeva il 3D sotto la schermata | La classe mobile compatta era applicata a `/ufficio/agenti`, non a `/ufficio` | Navigazione compatta su entrambe; altezza del 3D vincolata al viewport e pannello sotto la scena |
| Approvazioni descritte come prive di effetti sul CRM | Le RPC uniscono contatti, importano enti e accodano lavori, mentre il testo indicava solo “decisione registrata” | Effetto esplicito prima del clic e pulsanti specifici: “Approva e unisci”, “Approva e importa nel CRM”, “Approva e accoda”, “Approva e crea To Do” |
| Link alla scheda agente senza ancora | Nessun id HTML sulla riga agente | Ancora `#agente-<id>` e percorso di ritorno al 3D |

## Inventario operativo

Gli orari seguenti sono quelli dichiarati dal pianificatore, con fuso predefinito Europe/Rome. Ogni agente nasce **spento**. La presenza del job nel codice non prova che il pianificatore remoto sia attivo.

| Agente | Reparto / orario | Comportamento implementato e vincoli |
|---|---|---|
| Direttore | Direzione · lunedì 07:00 | Legge priorità, copertura, vendite, finanza e corse; prepara proposte. L’approvazione accoda ai destinatari, non rialloca automaticamente i loro budget |
| Costruttore My Maps | Mappe · 01:30, slot di due giorni | Importa una mappa dalla coda, massimo 150 nuovi candidati, costo dichiarato zero; bridge StudioMap, nessuna generazione testi o pubblicazione |
| Controllo qualità mappe | Mappe · 04:00 | Controlli e campione di testi; produce rapporti/proposte, non pubblica mappe |
| Lingue e voce | Mappe · 02:00 | Completa le mappe in coda tramite API Speaqi e budget. Le traduzioni obsolete richiedono approvazione. Il costo registrato al lancio resta una stima, non il costo finale del fornitore |
| Arricchimento enti | Ricerca · 06:00 | Cerca nei siti degli enti legati alle destinazioni prioritarie, verifica recapiti con frasi fonte. Solo l’approvazione aggiorna l’ente, lo porta nel CRM e accoda le Presentazioni |
| Ricercatore eventi e fiere | Ricerca · 06:30 a giorni alterni | Eventi e bandi con fonti, scadenze e deduplicazione. L’approvazione crea un’attività To Do, non un’iscrizione all’evento |
| Osservatorio novità | Ricerca · 07:00 | Rassegna recente con fonti, deduplicazione e controllo temporale; Telegram solo tramite azione esplicita del titolare |
| Commerciale | Commerciale · lun–ven 08:00 | Follow-up con fonti CRM, massimo 15 bozze al giorno, deduplicazione e verifica delle risposte; niente invii automatici dell’ufficio |
| Presentazioni | Commerciale · lunedì 10:00 | Deck Tourism da fonti verificate, massimo due tentativi di generazione per corsa; approvare il report non approva il deck. La revisione del deck resta nell’editor Tourism |
| Finanza | Finanza · 08:30 | Bozze fattura, solleciti, segnalazioni dati/SDI e riepilogo di chiusura mese; nessun invio allo SDI o via email |
| Social | Marketing · lunedì 09:00 | Bozze da guide/foto verificabili, deduplicate per settimana; nessuna pubblicazione social |
| Pulizia database | Operazioni · domenica 04:30 | Propone gruppi di doppioni e dati sporchi. L’approvazione unisce i gruppi compatibili, sposta i collegamenti e conserva le righe duplicate nascoste |

Tutti i 12 id hanno definizione, handler e job. Manutenzione dello storico alle 03:15 con conservazione di 90 giorni per le corse; output pendenti e ledger conservati secondo i vincoli testati. Napoli è esclusa dai flussi cartografici automatici che la proteggono già nel codice.

## Cosa funziona nei controlli

- **Accesso:** titolare autorizzato, richieste senza sessione rifiutate, collaboratori esclusi. La rotta della scena ha gli stessi controlli.
- **Budget:** tetti indipendenti giornalieri/settimanali/mensili, zero blocca la spesa, prenotazioni concorrenti atomiche, saldo idempotente e costo oltre la stima sempre contabilizzato.
- **Corse:** claim atomico, chiave di idempotenza, blocco delle doppie esecuzioni, recupero dei processi scaduti senza liberare riserve dall’esito incerto.
- **Decisioni:** transazioni e vincoli del workspace verificati; niente scritture privilegiate dirette dal browser.
- **UI operativa:** stato vuoto, interruttore, modifica budget/settings, avvio manuale, approvazione/rifiuto, errore/recupero e integrazione nella dashboard.
- **3D:** entrambe le architetture, selezione reparto/agente, giorno/sera, link alle proposte e alle impostazioni, aggiornamento esplicito, recupero dopo un errore dati, desktop e telefono, navigazione anche senza WebGL.
- **Isolamento:** l’iframe riceve nomi, descrizioni, stato, costi, titoli e id necessari alla navigazione; non riceve `user_id`, settings, token, destinatari o corpi degli output.

## Limiti da tenere presenti

1. **Stato remoto non verificato.** Nell’ambiente di lavoro risultano assenti `SUPABASE_SERVICE_ROLE_KEY`, `AUTOMATION_WORKSPACE_USER_ID`, `AUTOMATION_SECRET`, `OPENAI_API_KEY`, `SPEAQI_API_KEY`, `OFFICE_BRIDGE_SECRET` e le variabili Telegram. Non significa che manchino sul server di produzione. Per il collaudo remoto servono configurazione del server, migrazioni applicate e un workspace effettivo.
2. **Gli agenti non diventano operativi accendendoli soltanto:** alcuni richiedono code, fonti, enti verificati o API esterne. Senza elementi validi possono concludere legittimamente senza produrre lavoro.
3. **Budget per agente:** il totale del reparto è la somma dei tetti degli agenti, inclusi quelli spenti. Non esiste un tetto condiviso autonomo per reparto. La nuova UI lo dichiara.
4. **Aggiornamento ogni 30 secondi:** la vista non è uno stream in tempo reale. In errore conserva l’ultimo snapshot con avviso e timestamp.
5. **Code paginate:** il 3D mostra i titoli della prima pagina delle proposte e fino a cinque anteprime. Il conteggio globale resta quello esatto dell’API. La gestione completa si apre in “Agenti e bozze”. Il pannello del singolo reparto avverte del limite della prima pagina.
6. **Volumi elevati:** nella scena si disegnano fino a 12 persone per reparto; la lista e i conteggi comprendono tutti gli agenti. Le definizioni attuali contengono al massimo tre agenti nello stesso reparto.
7. **Approvazione di un report ≠ esecuzione universale:** le correzioni fattura e le modifiche manuali delle presentazioni restano proposte da applicare nei rispettivi editor. Non sono stati aggiunti invii o pubblicazioni automatici.
8. **Storico UI:** “Agenti e bozze” mostra proposte pendenti e ultime corse; non è un archivio completo delle decisioni. I dati delle decisioni restano nel database.

## Verifiche riproducibili

| Controllo | Esito |
|---|---|
| Test applicativi ufficio e pianificatore, inclusi i nuovi controlli | 138 superati |
| Nuovi test proiezione 3D, stati, approvazioni e bundle JavaScript | 5 superati, inclusi nei 138 precedenti |
| Test SQL su PostgreSQL 17 locale e PGlite | 67 superati |
| Browser sulla build production locale, Chromium | Superato: gestione operativa + due scene + telefono + errore/recupero + assenza WebGL |
| `npm run build` | Superato, 153 pagine generate |
| `git diff --check` | Superato |

Comandi di riferimento:

```sh
npm ci
npm run build
node --import tsx --test --test-concurrency=1 tests/office*.unit.test.ts
# Richiede PostgreSQL locale nel PATH, come previsto da tests/db.sh:
node --import tsx --test --test-concurrency=1 tests/office*.db.test.ts
# Avviare la build locale sulla porta 3215:
CHROMIUM_PATH=/percorso/chromium npm run test:office:ui
```

`npm run build` rigenera automaticamente il documento 3D con `prebuild`. Per lavorare soltanto sulla scena: modificare `scripts/ufficio/scena.html` e `scripts/ufficio/scene.js`, poi `npm run build:office`. `src/lib/server/ufficio-scene.ts` è generato e non va modificato a mano.

Nessuna migrazione aggiuntiva necessaria per questa modifica. Le migrazioni dell’ufficio già presenti rimangono necessarie sul database di destinazione.

## Integrazione prima della pull request

Modifica riallineata alla revisione `dfed99b` di main: conservati il nuovo agente Eventi e gli aggiornamenti prestazionali del CRM. Aggiunta l’indicazione dell’effetto To Do nell’approvazione delle proposte Eventi.
