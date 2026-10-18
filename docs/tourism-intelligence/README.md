# Global Tourism Intelligence — MVP e attivazione

Area applicativa: `/tourism`, visibile al proprietario del workspace nella sidebar del CRM. Il modulo vive nel CRM esistente e non crea una nuova applicazione o un nuovo servizio di produzione.

Documenti: [acquisizione mondiale reale](./ACQUISITION.md), [audit e architettura](./ARCHITECTURE.md), [modello dati](./DATA-MODEL.md), [verifiche e limiti](./VALIDATION.md), [campione organizzazioni CSV](./pilot-organizations.csv). Il CSV pilota contiene 8 organizzazioni di esempio; i conteggi di produzione sono in [acquisition-results.json](./acquisition-results.json).

## Stato consegnato

- Dashboard con conteggi dal database, copertura per paese e mappa mondiale interattiva locale; nessun conteggio fittizio nel prodotto.
- Directory paginata, ricerca full-text, filtri combinabili, ordinamento, selezione della pagina, viste salvate per utente/browser, export CSV della selezione senza dati personali e archiviazione multipla con esito per batch.
- Schede con fonti per attributo, revisione esplicita, versioni, storico, score documentato e relazioni. CRUD tramite API protette; UI per creazione organizzazioni, modifica e archiviazione.
- Import CSV/TSV/JSON con anteprima ed errori per riga. Tutte le righe devono essere valide prima dell'approvazione. Per Excel: esportazione in CSV UTF-8; lettura diretta `.xlsx` non implementata.
- Geografia e grafo relazionale con fonti; visualizzazione esplorativa fino a 500 entità. I brand/portali sono entità separate. Nel form di relazione si collegano territori; gli altri tipi di archi sono disponibili nell'API.
- Add to CRM idempotente, controllo delle identità esistenti, provenienza e sync esplicita in entrambe le direzioni. Nessuna creazione automatica di campagne o deal.
- Discovery Responses API + web search, massimo 12 candidati e 3 chiamate di ricerca per esecuzione. Solo fonti presenti nelle citazioni del provider; nessun contatto personale o score estratto dall'AI. Risultati da approvare e poi verificare.
- Job persistenti con lease di due minuti, token del tentativo, massimo tre tentativi e ripresa manuale. Una ricerca per proprietario alla volta; limite applicativo di 10 nuove richieste/ora. Non è ancora un worker autonomo con retry pianificati.
- Catalogo popolato sul Supabase del CRM con organizzazioni reali da WTM London, Arabian Travel Market, WTM Latin America, Wikidata e directory istituzionali. Copertura, ricevute delle acquisizioni e paesi senza organizzazioni sono visibili nella dashboard. Un paese con record non equivale a un censimento completo.
- Matching con il CRM esistente: filtro delle organizzazioni con possibili corrispondenze, conferma o rifiuto in scheda, collegamento esplicito dopo la verifica. L'acquisizione non crea contatti CRM.
- Il campione italiano di **8 organizzazioni, 7 territori, 1 brand, 1 portale, 7 relazioni** resta una fixture facoltativa; i record acquisiti da fonti pubbliche richiedono revisione prima della promozione.

## Prima attivazione sul CRM

1. Identificare il progetto Supabase realmente usato dal CRM. Le credenziali dell'app principale non dimostrano che sia lo stesso database. Non applicare la migrazione a un progetto diverso per tentativi.
2. Eseguire e controllare il backup pre-migrazione delle tabelle esistenti, ad esempio `npm run backup -- contacts deals activities tasks quotes lead_memories pipeline_stages team_members user_settings quote_signatures receivables`. La lista predefinita del backup è stata estesa alle nuove tabelle e va usata dopo la migrazione; il ripristino operativo resta da provare sul progetto target.
3. Applicare le migrazioni `20261017205455_tourism_intelligence.sql` e `20261017214525_tourism_acquisition_matching.sql` mediante il processo del repository, in ordine e in transazione. Non rilanciare file su uno schema già migrato: la cronologia Supabase governa l'esecuzione singola.
4. Configurare `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY` del CRM. Il modulo usa il JWT dell'utente e non necessita della service role.
5. Per la discovery: impostare **`OPENAI_API_KEY`** lato server; opzionale `OPENAI_TOURISM_DISCOVERY_MODEL`, default `gpt-5-mini`. Una chiave destinata all'audio non viene riutilizzata. Confermare policy di rete, accesso al provider e disponibilità del modello prima di un test reale.
6. Eseguire `npm run build`, avviare il CRM e aprire `/tourism` come proprietario. Importare il pilota dal pulsante nella dashboard vuota. Ripetere l'import non sovrascrive i dati esistenti.
7. Aprire le fonti, verificare gli attributi, promuovere una singola organizzazione e controllare la scheda CRM. Provare poi confronto e sincronizzazione in entrambe le direzioni su dati di test. Verificare che un collaboratore riceva 403 dal modulo e non veda il link.

Le due migrazioni sono state applicate al progetto Supabase **Speaqi Crm** (`drlaoxxodjltsycbbdvn`). Backup e verifiche del primo rilascio sono in [RELEASE.md](./RELEASE.md); popolamento reale, matching e limiti di copertura sono in [ACQUISITION.md](./ACQUISITION.md). Il pulsante del pilota non è stato usato in produzione. La ricerca AI reale e il percorso browser autenticato sul deploy rimangono da verificare; i test del trasporto AI usano risposte simulate.

## Uso del pilota

Il campione include ENIT, Toscana Promozione Turistica, Visit Piemonte, GAL Cilento ReGeneratio, Trentino Marketing, Ente Parco Nazionale delle Cinque Terre, Italy Creative e Fondazione Bologna Welcome. I recapiti sono istituzionali e pubblicati dalle fonti; nessuna email viene dedotta. I territori del GAL non vengono equiparati all'intero Cilento, il Trentino non all'intera regione Trentino-Alto Adige e la DMC non viene trattata come governo territoriale.

Il portale VisitTrentino è presente come entità distinta; il suo collegamento al gestore richiede l'evidenza specifica appropriata e non viene inferito dal nome. Lo stesso vale per il confine di gestione del parco. Il pilota contiene un collegamento documentato fra Trentino Marketing e il brand Trentino.

Metriche del campione prima della revisione del workspace:

| Misura | Esito / limite |
| --- | --- |
| Identità con fonte ufficiale consultabile | 8/8 controllate nella ricerca preparatoria; non è una stima della precisione del discovery automatico |
| Categorie distinte | 7: NTO, RTO, DMO, GAL, parco, DMC, fondazione |
| Duplicati esatti nel campione | 0; un reimport del test rileva 17/17 entità già presenti senza sovrascriverle |
| Campi core | Nome, paese, categoria, sito e fonte per tutte le 8 organizzazioni |
| Recapiti pubblici | 4 organizzazioni con email istituzionale; 1 con telefono |
| Dati commerciali / score | Non valutati: nessun fabbisogno digitale o budget presunto dall'assenza di dati |
| Record che richiedono revisione del workspace | 17/17, intenzionalmente 100% all'importazione |
| Tempo di acquisizione e costo per organizzazione verificata | Non misurati end-to-end: non c'è stata una ricerca AI reale né una verifica operativa sul CRM target |
| Copertura territoriale completa / recall | Non misurata. 8 enti non rappresentano la copertura dell'Italia |

Prima dell'espansione misurare precisione su campione indipendente, recall contro directory ufficiali, duplicati post-revisione, completezza per attributo, minuti umani per verifica, token/costo provider, quota revisioni e tempo dal job alla pubblicazione. Il denominatore della precisione deve includere anche candidati scartati, non solo quelli importati.

## Verifica riproducibile

`npm run test:tourism` esegue test unitari e una migrazione reale in PostgreSQL WASM/PGlite con ruoli, RLS, trigger, transazioni e funzioni SQL. PGlite è solo una dipendenza di sviluppo; non cambia l'infrastruttura di produzione.

`npm run test:tourism:ui` richiede un Next locale già avviato e Chromium (`CHROMIUM_PATH`, default `/usr/bin/chromium`). Usa `TOURISM_TEST_URL` (default `http://127.0.0.1:3000`) e `TOURISM_TEST_OUTPUT` (default `/tmp/speaqi-tourism-browser`). Le chiamate API sono intercettate con fixture in memoria. Questi controlli verificano la UI e i contratti, non certificano l'integrazione Supabase. Il test non deve essere eseguito su produzione.

Per un test isolato usare una configurazione Supabase locale di test; le prove di questa sessione hanno usato un URL locale fittizio con tutte le API del browser intercettate. La route reale risponde 401 senza bearer token. Gli screenshot non rappresentano dati di produzione.

La build viene verificata dopo i test. Un'incompatibilità preesistente con Next è stata corretta estraendo `useCRMContext` dal file speciale `layout.tsx` in `src/components/layout/CRMContext.tsx`; gli import esistenti sono stati aggiornati senza cambiare il comportamento del contesto.

## Priorità, dipendenze e accettazione

| Componente | Prima / implementazione | Priorità e complessità | Dipendenze e criterio di accettazione | Costo operativo |
| --- | --- | --- | --- | --- |
| Auth e area applicativa | Auth esistente; area owner-only e RLS aggiunte | P0 · media | JWT, schema CRM; utente anonimo 401 e altro workspace isolato | Infrastruttura esistente |
| Catalogo, fonti e audit | Mancavano; tabelle e trigger aggiunti | P0 · alta | Migrazione; una modifica invalida verifica e conserva before/after | PostgreSQL: storage e revisioni |
| Tassonomia / geografia | Nuovo registro, luoghi e archi | P0 · media | Fonti per relazione, nessun ciclo geografico o FK fra tenant | Nessun servizio esterno |
| CRUD e ricerca | API/renderer nuovi; shell riusata | P0 · media | Filtri e pagine coerenti, conflitti di versione espliciti | Query indicizzate sul DB esistente |
| Import e deduplica | Parser CSV riusato; pipeline atomica nuova | P0 · media | Riga invalida blocca import; reimport non distruttivo | Batch fino a 200; nessuna AI necessaria |
| CRM | Contatti e attività riusati; bridge e sync nuovi | P0 · alta | Promozione solo verificata, ripetibile, senza iscrizioni; target reale da provare | Stesso PostgreSQL |
| Dashboard e mappa | Nuove viste, Leaflet esistente | P0 · media | Totali globali del workspace, paese cliccabile, nessun falso conteggio | Basemap locale circa 194 KB, pubblico dominio |
| Discovery assistita | Responses API già usata; nuovo workflow dedicato | P1 · alta | Candidati con citazioni, selezione e approvazione; test provider reale da completare | Token e web search secondo listino configurato |
| Job autonomi e monitoring | Scheduler CRM esistente; non collegato al modulo | P1 · alta | Worker con lease, retry/backoff, budget, allarmi e riavvio verificati | Tempo worker e provider; dipende dal volume |
| Persone e ruoli | Contacts CRM esistenti; acquisizione nel catalogo bloccata | P1 · alta | Policy giuridica/retention, fonti per ruolo e cambi di impiego | Verifica umana, gestione richieste interessati |
| XLSX, connettori API e directory | CSV/JSON e acquisitori pubblici WTM/Wikidata disponibili; XLSX diretto assente | P1 · media/alta | Riconciliazione pagine, fonti per attributo, aggiornamento senza sovrascrittura | API pubbliche; revisione umana |
| Collaboratori | Permessi CRM esistenti basati su assegnazione | P1 · alta | Ruoli catalogo read/review/export; RLS diretta e test negativi | Manutenzione permessi |
| Copertura mondiale profonda | Prima acquisizione globale pubblicata; profondità locale ancora parziale | P1 · alta | Benchmark per paese e categoria, directory regionali/locali, controllo delle identità | Acquisizione + revisione, principale voce di costo |

## Stima economica trasparente

Non viene introdotto un nuovo abbonamento infrastrutturale. Il costo incrementale dipende dal consumo del Supabase/hosting già esistente e dalla retention delle revisioni. Un ordine di grandezza per lo storage va misurato sul campione reale, includendo indici e versioni.

Per la discovery: `costo verificato = (token input × tariffa input + token output × tariffa output + ricerche web × tariffa ricerca) / organizzazioni approvate e verificate + costo revisione umana`. I job espongono token e numero ricerche riuscite; non stimano dollari con un listino hardcoded. Una chiamata fallita può comunque essere fatturata dal provider: riconciliare la dashboard del provider, non considerarla automaticamente a costo zero.

Esempio di budget **ipotetico**, non tariffa del provider né misura del pilota: €0,20 per ricerca, 8 candidati, 70% verificati → circa €0,036 di AI per organizzazione verificata. Tre minuti di revisione a €30/ora aggiungono €1,50. Il totale pianificatorio è circa €1,54/record, esclusi hosting e controllo qualitativo del campione. Cambiare questi coefficienti con i consumi misurati prima di impegnare il budget.

## Espansione e funzionalità avanzate

1. **Italia:** validare 100–200 organizzazioni stratificate per categoria e territorio, includendo fonti nazionali/regionali, GAL, consorzi e DMC. Revisione a campione indipendente; nessun import mondiale indiscriminato.
2. **Europa:** selezionare paesi con domanda commerciale Speaqi, accessibilità delle fonti, maturità della pipeline dati e costo per record verificato. Dizionari locali e tassonomia per paese prima dell'acquisizione.
3. **Nord America:** NTO/state boards/CVB e operatori commerciali distinti; collegamenti a province, stati e regioni turistiche tramite fonti specifiche.
4. **Altri mercati:** America Latina, Asia, Medio Oriente, Africa e Oceania secondo una matrice di domanda, valore, qualità/licenza dei dati e costo. Non è una graduatoria già misurata.

Prima di acquisire su larga scala: obiettivo operativo iniziale precisione identità ≥95% su campione indipendente, nessun leak fra tenant, zero duplicazioni da reimport, fonti per tutti gli archi pubblicati, costo per verificato sotto il budget approvato e restore provato. Il 95% è una soglia di accettazione proposta, non un risultato osservato.

AI Prospect Finder, maturità digitale, territory opportunity finder e segmentazione richiedono osservazioni di servizi **presenti/assenti verificati/sconosciuti**, non euristiche sul testo del nome. Market Expansion Intelligence e coverage analysis richiedono denominatori amministrativi e turistici affidabili. Change Detection e monitoraggio richiedono snapshot, scadenze delle evidenze e connettori autorizzati. Il Sales Research Assistant può riutilizzare il grafo e le fonti quando il dossier separa fatti, stime e giudizi. Queste sono evoluzioni pianificate, non funzioni dichiarate già operative.
