# Modello dati e regole operative

Le migrazioni additive sono `supabase/migrations/20261017205455_tourism_intelligence.sql` e `20261017214525_tourism_acquisition_matching.sql`. Tutte le tabelle del catalogo sono distinte da contatti, trattative e progetti CRM.

| Tabella | Grana, chiavi e contenuto | Integrità |
| --- | --- | --- |
| `tourism_taxonomy` | Un codice organizzativo, etichette IT/EN e indicazione di governance | Codici referenziati via FK, non enum SQL. Il registro iniziale comprende 19 categorie; l'estensione richiede una migrazione e l'allineamento delle etichette del client e del validatore |
| `tourism_entities` | Una organizzazione, un luogo, un brand, un portale o una persona; UUID, proprietario, identità, alias, paese, recapiti, sito, dettagli, identificativi esterni, stato e versione | Unicità proprietario + tipo entità + paese + nome normalizzato. FK tassonomia; ISO a due lettere come formato; versione monotona; dati personali non importabili nel pilota |
| `tourism_evidence` | Una attestazione di una fonte rispetto a specifici attributi di una entità | URL, titolo, nota, attributi documentati, metodo, acquisizione, verifica, attore. FK composita workspace/entità; una fonte AI nasce non verificata |
| `tourism_relations` | Un arco direzionale tra due entità, con una evidenza | FK composite impediscono attraversamenti di workspace. Vincoli sulle coppie di tipi, unicità dell'arco, divieto di autoriferimento e cicli `PART_OF` |
| `tourism_crm_links` | Collegamento esplicito organizzazione → contatto aziendale CRM | Una organizzazione ha al massimo un collegamento. Trigger controlla workspace e identità verificata. Nessuna sincronizzazione implicita |
| `tourism_revisions` | Un evento di modifica di entità, fonte, relazione o collegamento | Attore, data, operazione, snapshot precedente e successivo. Inserimenti tramite trigger; l'utente può leggere il proprio audit ma non scriverlo o modificarlo |
| `tourism_jobs` | Una ricerca discovery con stato, tentativi, lease, risultati e consumo | Coda persistente; massimo tre tentativi; esclusione di ricerche simultanee per proprietario; token della lease impedisce a una risposta precedente di sovrascrivere il tentativo corrente |
| `tourism_acquisitions` | Ricevuta di un'acquisizione: fonti, ambito, conteggi, errori, date | RLS del proprietario, chiave esecuzione univoca, audit; completata indica il batch documentato, non la completezza mondiale |
| `tourism_crm_matches` | Suggerimento organizzazione → contatto, regola, punteggio e stato candidato/confermato/rifiutato | FK workspace/entità e trigger sul contatto impediscono riferimenti fra workspace; suggerimenti distinti dai collegamenti confermati |

## Entità e geografia

`kind=place` rappresenta paesi, aree amministrative e destinazioni. `details.place_level` descrive il livello locale senza imporre una gerarchia italiana. `PART_OF` può rappresentare più appartenenze; un grafo aciclico sostituisce una struttura rigida continente/regione/provincia/comune. I collegamenti `COVERS`, `PROMOTES`, `MANAGES` supportano molti-a-molti e sovrapposizioni. Perimetri geometrici e identificativi amministrativi completi non sono caricati automaticamente.

`external_ids` accoglie riferimenti Wikidata, GeoNames, OSM, ISO, Speaqi e le edizioni WTM. Sono riferimenti dichiarati, non una verifica dell'identità. Gli acquisitori riconciliano identificativi stabili e nomi normalizzati entro lo stesso paese, conservando alias e fonti. Un dominio condiviso non determina una fusione. La riconciliazione con le destinazioni dell'app principale resta da implementare.

Brand e portale hanno UUID distinti. `OPERATES_BRAND` e `OPERATES_PORTAL` collegano il gestore documentato. `MEMBER_OF` e `PARTNER_OF` modellano reti e collaborazioni. `WORKS_FOR` prepara il collegamento professionale, ma l'importazione di `person` è bloccata fino al workflow su base giuridica, conservazione e diritti delle persone. Nel pilota sono ammessi solo recapiti istituzionali pubblici documentati.

## Tassonomia iniziale

Ministero; NTO/NTA; RTO; DMO; DMC; OTA (agenzia di viaggi online, commerciale e senza governance territoriale); CVB; GAL; unione di comuni/comunità montana; consorzio; strada del vino; fondazione; associazione/Pro Loco; ente parco; distretto/cluster; camera di commercio; ufficio locale; rete/partnership; autorità di sviluppo; altra categoria da classificare. `Visit`, `Discover`, `Explore` e nomi equivalenti sono segnali di discovery, non categorie giuridiche o prove di governance.

Le etichette multilingua risiedono nel registro. Le denominazioni locali si conservano nel nome e negli alias. Le categorie rappresentano un primo vocabolario editoriale; più qualifiche simultanee e sottocategorie nazionali possono essere aggiunte con una tabella di assegnazione, senza duplicare l'organizzazione.

## Deduplicazione e aggiornamento

- Normalizzazione deterministica di spazi, punteggiatura e accenti latini comuni; gli alfabeti non latini vengono conservati. Il nome originale rimane visibile. Non è un algoritmo di identità universale: traslitterazioni e varianti linguistiche vanno revisionate.
- Import atomico, 1–200 righe: ogni record nuovo riceve la sua evidenza. Gli esatti già presenti vengono contati e ignorati. Nessuna sovrascrittura di nomi, verifiche, recapiti o lavoro commerciale tramite reimportazione.
- Dominio ed email condivisi suggeriscono una revisione: non determinano una fusione. La UI segnala esplicitamente che il confronto esplorativo è limitato al campione di 500 entità.
- Una modifica agli attributi invalida tutte le precedenti attestazioni della scheda e porta a `NEEDS_REVIEW`. Regola conservativa: anche la modifica di un indicatore richiede revisione. Rifiutare o rimuovere una fonte verificata invalida lo stato verificato dell'entità.
- Una revisione opera sulla versione letta dall'utente. Una modifica concorrente produce conflitto e richiede ricaricamento. Timestamp e attore della verifica vengono assegnati dal database.
- Archivio (`INACTIVE`) conserva tutto. DELETE è disponibile nell'API solo con versione corrente e viene bloccato da relazioni/collegamenti esistenti. Le revisioni di record eliminati restano consultabili dal proprietario.

## Scoring spiegabile

Dieci fattori, con pesi iniziali per un totale di 100: rilevanza turistica 15, scala destinazioni 10, dimensione organizzazione 5, digitalizzazione 10, mappe 15, multilingua 15, AI Concierge 10, investimento 5, accessibilità referenti 5, compatibilità Speaqi 10.

Per ogni fattore si salva una valutazione interna 0–100, URL e motivazione. Il valore è utilizzabile solo se una evidenza **verificata** dello stesso URL copre `indicator:<fattore>`. La formula è la media ponderata sui soli fattori documentati; la copertura è il peso documentato diviso il peso totale. I dati mancanti restano sconosciuti, non diventano assenza di servizi o valore zero.

Sotto il 60% di copertura: `NOT QUALIFIED`. Altrimenti A ≥75, B ≥50, C <50. I pesi sono modificabili nella sessione; il preset è versionato come `weighted-verified-v1`. Lo score è un giudizio commerciale sostenuto da fonti e non una misura oggettiva della maturità di una destinazione. Nessuna previsione di ricavi o capacità di acquisto viene inventata.

## CRM

`tourism_promote` richiede un'organizzazione verificata e usa una transazione con lock. Cerca un contatto con identità e paese coincidenti; un nome coincidente con paese non normalizzato o una email condivisa da identità diverse blocca la creazione e richiede revisione. Le differenze fra “Italia” e “IT” non generano duplicati silenziosi. Non c'è fusione fuzzy automatica.

Il matching di acquisizione confronta nomi/alias e paese, domini web e domini email istituzionali, escludendo piattaforme condivise e fornitori di email gratuiti. Propone al massimo cinque contatti per organizzazione. Il punteggio codifica la regola di confronto, non una probabilità calibrata o una verifica. Rieseguire il matching conserva conferme e rifiuti e rimuove solo suggerimenti candidati non più attuali.

La presenza di candidati irrisolti blocca la creazione di un nuovo contatto. `tourism_link_existing` richiede organizzazione verificata, versione corrente, candidato esistente e contatto nello stesso workspace. Confermare il collegamento non sovrascrive i campi del contatto; crea il ponte e una nota di sistema.

Un nuovo contatto aziendale nasce `New`, scope `crm`, fonte `tourism-intelligence`, `marketing_eligibility=review`, riferimento stabile al catalogo. Sono copiati solo recapiti coperti da evidenza verificata. Non vengono creati task, deal, progetti, campagne o invii. La futura assegnazione a pipeline riutilizzerà i processi CRM esistenti. Il contatto aziendale è un ponte di compatibilità: il CRM non ha ancora un account canonico separato dalle persone.

La sincronizzazione mostra i valori e richiede conferma per ciascuna direzione. Catalogo → CRM richiede verifiche su email e telefono. CRM → catalogo crea una evidenza non verificata e invalida la precedente verifica. Le modifiche commerciali non vengono diffuse automaticamente al patrimonio informativo.

## Indici e crescita

Ricerca `simple` su denominazione, sito, alias e descrizione con indice GIN; indice composto su workspace/tipo/paese/categoria/stato/UUID; indici per evidenze, archi inversi, storico e job. Directory paginata sul server a 50 righe con ordinamento stabile; conteggi dashboard aggregati sull'intero workspace. Il grafo è deliberatamente limitato: passare a caricamento per vicinato/pagine quando il pilota supera 500 entità. PostGIS, ricerca fonetica/fuzzy, materialized views e un motore di ricerca esterno vanno introdotti solo dopo misure su carichi reali.
