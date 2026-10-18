# Ricerca dei portali e dei cataloghi di destinazione

Rilevazione del 18 ottobre 2026. Il catalogo delle organizzazioni e il catalogo dei luoghi sono livelli distinti: una pagina di un espositore, un portale di destinazione e una scheda di un ristorante non rappresentano la stessa entità.

## Stato verificato

- Database: 652 fonti nel nuovo registro, 649 selezionate dal catalogo e tre portali pilota aggiuntivi.
- Soltanto i tre portali pilota sono abilitati ai controlli periodici. Le altre fonti sono candidate, disabilitate e non attestano automaticamente un ruolo ufficiale.
- Ultimo campione: 31 richieste HTTP, 12 schede con coordinate, nessuna chiamata a modelli AI o API di scraping a pagamento.
- Le organizzazioni preesistenti, le verifiche, i contatti CRM e le proposte di matching non sono stati modificati dal censimento dei siti.

| Portale | Esito del campione | URL sitemap osservati | URL candidati luoghi | URL candidati ristorazione | Schede estratte con coordinate |
| --- | --- | ---: | ---: | ---: | ---: |
| [Vienna](https://www.wien.info/en) | Campione completato, 15 richieste | 4.996 | 542 | 218 | 5 |
| [NapoliForMe](https://napoliforme.comune.napoli.it/) | Campione completato, 15 richieste | 4 | 42 | 0 | 7 |
| [InCampania](https://www.incampania.com/) | HTTP 503 su robots.txt, 1 richiesta | Non misurato | Non misurato | Non misurato | Non misurato |

Gli URL includono lingue, categorie e articoli. Non rappresentano luoghi distinti. Uno zero in un campione indica assenza di osservazioni, non assenza di contenuti nel sito. Il totale mondiale dei portali e dei luoghi resta sconosciuto. Il campione di convenienza di due siti accessibili non consente di stimare la dimensione media dei cataloghi mondiali.

## Funzioni disponibili nel pannello

In `/tourism`, aprire **Ricerca siti e progetti**:

1. **Siti e mappe:** elenco filtrabile, esportazione CSV, analisi limitata, sezioni di catalogo, conteggi distinti, schede e anteprima interna dei punti geolocalizzati. Conferma separata del ruolo ufficiale e della natura di destinazione, con fonte e motivazione.
2. **Verifiche e duplicati:** attestazione esplicita di massimo 25 identità per operazione; versioni controllate e rollback atomico su conflitto. Collegamento canonico reversibile senza spostare o cancellare fonti; i casi ambigui richiedono revisione individuale.
3. **Lacune territoriali:** presenza per paese/categoria. Senza un denominatore ufficiale, la completezza è indicata come non misurata. Il grafo carica il vicinato della selezione, fino a 200 relazioni, anziché dipendere dai primi 500 record arbitrari.
4. **Progetti e attività:** dossier con fonte, motivazione, responsabile e prossimo passo. Avanzamento oltre la ricerca solo per organizzazioni verificate e collegate al CRM; creazione esplicita di attività idempotenti senza invii. Fase commerciale e stato del progetto rimangono distinti. Il dossier non crea automaticamente un progetto sulla piattaforma Speaqi.
5. **Volumi e costi:** scenari modificabili per numero di siti, richieste, browser, AI e quota di contenuti cambiati. Le tariffe unitarie sono ipotesi di budget, non preventivi verificati.

Le schede estratte rimangono candidate. L'esportazione GeoJSON per un progetto richiede conferma del portale, revisione delle schede e fonte della licenza aperta o autorizzazione. L'anteprima interna mostra anche candidati non ancora approvati.

## Stima a consumo

Ipotesi configurate in `src/lib/tourism-research.ts`:

- HTML e parsing: **0,50–3 EUR per 1.000 richieste**.
- Browser, se necessario in un adattatore futuro: **5–15 EUR per 1.000 richieste** in sostituzione dell'HTTP semplice.
- AI opzionale futura: **1–5 EUR per 1.000 pagine elaborate**, in aggiunta.

Questi valori non sono stati verificati contro listini correnti di fornitori e non sono costi già sostenuti. Escludono sviluppo e manutenzione degli adattatori, revisione umana, licenze, storage a lungo termine, IVA e costi dell'automazione dell'assistente. I browser a pagamento e l'AI non vengono eseguiti dal motore attuale.

| Scenario su 652 siti | Richieste | Costo a consumo ipotizzato per passaggio |
| --- | ---: | ---: |
| Censimento: 20 richieste HTTP per sito | 13.040 | 6,52–39,12 EUR |
| Cataloghi piccoli: 100 richieste HTTP per sito | 65.200 | 32,60–195,60 EUR |
| Estrazione: 1.000 richieste per sito, 20% browser | 652.000 | 912,80–3.520,80 EUR |
| Estrazione estesa: 5.000 richieste per sito, 20% browser, 10% AI | 3.260.000 | 4.890–19.234 EUR |

Ripetere integralmente lo scenario da 1.000 richieste ogni settimana equivale a circa **3.955–15.257 EUR al mese** (52 passaggi / 12 mesi), prima degli extra esclusi. Una ripetizione mensile equivale a un passaggio al mese.

Se un adattatore incrementale potesse limitare il nuovo download al 10% dei contenuti, lo stesso scenario diventerebbe **91,28–352,08 EUR per aggiornamento**, più il costo delle verifiche necessarie a trovare le modifiche. Questo risparmio è ipotetico: il motore attuale ripete un campione limitato e confronta le osservazioni; non implementa ancora un download incrementale universale. Sitemap, paginazione, tentativi falliti e controlli condizionali consumano ulteriori richieste.

Partenza consigliata: campioni mensili e approfondimento delle destinazioni selezionate; aggiornamenti settimanali solo dove servono. Il tetto iniziale di 120 richieste/giorno non consente di censire tutti i 652 siti ogni mese a 15 richieste ciascuno: la capacità va rivista prima di abilitare tutto il registro. Nessuna estrazione integrale mondiale è stata avviata.

## Pianificazione e operatività

Il worker applicativo `src/lib/server/tourism-research-scheduler.ts` controlla la coda all'avvio e ogni ora, soltanto se il server dispone della configurazione necessaria. Non attiva le altre automazioni del CRM. La UI espone se il worker è disponibile.

- Un sito abilitato e dovuto per esecuzione; prenotazione oraria in `automation_job_runs` contro duplicazioni fra repliche.
- Lease di sei minuti per fonte; controllo del token al salvataggio.
- Tetto di **120 richieste giornaliere per workspace**, includendo le prenotazioni attive, anche per le analisi manuali.
- Default: **15 richieste per sito**, intervallo di **30 giorni**. Siti bloccati: attesa crescente da 7 giorni fino all'intervallo configurato.
- `robots.txt` prima delle pagine, ritardo minimo di un secondo, backoff su 429/503, limiti di tempo e dimensione, nessun tentativo di aggirare challenge.
- HTTP diretto con DNS pubblico controllato anche alla connessione; nel cloud si usa il proxy gestito che risolve e autorizza i domini. Redirect ad altre autorità richiedono registrazione della URL canonica.
- Parsing JSON-LD/microdata e adattatori per i dati pubblici delle mappe di Vienna e NapoliForMe.
- Hash e ricevute delle pagine; snapshot conservati per 90 giorni e almeno quattro rilevazioni per fonte. Una scheda non riosservata nel campione non viene cancellata né presentata come rimossa.
- Disattivazione per singolo sito dalla UI; `TOURISM_RESEARCH_ENABLED=false` ferma il worker applicativo.

È inoltre configurato un controllo settimanale dell'assistente, il lunedì nel fuso Europe/Rome, che usa la stessa coda e gli stessi lease se trova una fonte dovuta. Non abilita nuovi siti e rimane silenzioso in assenza di novità significative. Non è ancora stata osservata un'esecuzione futura del controllo o del worker sul nuovo codice in produzione.

Per l'esecuzione operatore/assistente senza una sessione web:

1. Leggere il registro e verificare le esecuzioni recenti. Non duplicare un lavoro già in corso.
2. Usare il connettore Supabase autorizzato per chiamare `tourism_claim_site` nella sessione del proprietario: transazione, `SET LOCAL request.jwt.claim.sub`, `SET LOCAL ROLE authenticated`, RPC, commit. Nessuna modifica ai permessi.
3. Salvare la fonte prenotata in un file JSON privato locale. Eseguire:

   ```sh
   node --import tsx scripts/tourism/crawl-site-job.ts claimed-source.json result.json
   ```

4. Salvare il risultato attraverso `tourism_finish_site(source_id, lease_token, report, changes)` nella stessa identità autorizzata. Costruire i parametri come dati JSON; fare escaping degli apostrofi se si usa SQL testuale. Non interpolare testo del sito come codice o comandi shell.
5. Se l'ambiente o la rete non sono disponibili, registrare il blocco senza dichiarare successo. Non aggirare controlli di approvazione o policy di rete.

## Artefatti locali

In `backups/tourism-acquisition/site-inventory/` (escluso da Git e dal deploy):

- `siti-destinazioni-652.csv`: registro esportato dal database con stato e conteggi del campione.
- `domini-da-abilitare.txt`: i domini delle 649 fonti non ancora abilitate; l'accesso web dell'ambiente va configurato separatamente dall'abilitazione della fonte.
- `campione-siti-analizzati.csv` e `pilot.json`: misure e ricevute del campione.
- `anteprima-interna-candidati.geojson`: 12 punti candidati, uso interno, riuso non ancora attestato.

## Verifica

Build di produzione, test di normalizzazione esistenti, test del crawler e degli scenari, test SQL su PGlite con RLS e ruoli, e controlli browser con API simulate. Le verifiche browser non costituiscono un test autenticato della UI di produzione.

Le migrazioni del modulo e gli indici delle nuove chiavi esterne sono applicati al database. Gli advisor di sicurezza non hanno segnalato nuove voci relative alle tabelle di ricerca al primo controllo; tre indici di FK sono stati aggiunti dopo il controllo prestazioni. Lo stato effettivo del deploy e i controlli finali sono riportati nella risposta di rilascio.
