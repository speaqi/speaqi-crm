# Ufficio — rapporto di verifica, 25 ottobre 2026

## Ambito ed evidenza

Il controllo distingue tre livelli: logica applicativa con servizi simulati, transazioni/lock su PostgreSQL isolato, comportamento del deploy reale. Un test verde al primo livello non attesta automaticamente gli altri due. Nessun messaggio, pubblicazione, generazione a pagamento o modifica dei dati di produzione viene autorizzato dal collaudo.

La catena implementata in questo intervento è **ordine di presentazione Tourism → verifica puntuale dell'ente → proposta → approvazione umana → presentazione pronta**. Il Direttore conserva incarichi, dipendenze, corse ed esiti. L'ufficio completo descritto nell'obiettivo aziendale resta più ampio: non si dichiara realizzato un accordo commerciale solo perché esiste una presentazione.

## Integrazione applicativa offline verificata

Comando eseguito:

```sh
node --import tsx tests/office-work-flow.unit.test.ts
```

**5 casi superati**, log di lavoro `/tmp/office-work-flow-test.log`.

| Caso | Codice applicativo esercitato | Risultato verificato |
|---|---|---|
| Catena Tourism | `runOfficeWorker`, `runAgent`, interpretazione dell'ordine, verifica ente, preparazione presentazione e handler Presentazioni | L'ordine crea due incarichi dipendenti. Prima del clic l'ente resta non verificato, il sito non viene scritto e nessun deck è generato. Dopo l'approvazione la presentazione riceve la destinazione dall'esito della verifica; il deck pronto chiude l'ordine. Un giro successivo non rigenera |
| Due ordini contemporanei | Worker e claim della corsa sul confine di persistenza simulato | Entrambi gli ordini sono conservati; quello che trova il Direttore occupato riprende al turno seguente senza un nuovo ordine |
| Ripresa con checkpoint delle prove | Worker nuovo e handler reale di verifica | Una fotografia già salvata di sito, pagine e prove consente di ricreare soltanto la proposta mancante, senza nuova lettura o spesa |
| Rifiuto | Decisione della proposta e dipendenza simulata, handler e worker reali | Verifica e presentazione dipendente vengono annullate; nessun deck, nuova proposta o costo |
| Fonte corretta | Ripresa dell'handler di verifica su payload revisionato | Una fonte illeggibile blocca il lavoro. La correzione conserva identificativi del lavoro e dell'ordine, incrementa la versione e produce la proposta riferita a quella versione |

**Confini simulati:** RPC e aggregazione SQL sono rappresentate dalla fixture `FakeSupabase` e da uno store in memoria; risposte del modello, pagine ufficiali e produzione delle slide sono fixture esplicite. Il servizio Presentazioni viene realmente invocato, ma i suoi servizi di creazione/generazione sono sostituiti al confine. Non è un test di rete completo e non dimostra la correttezza delle transazioni SQL: quella richiede la suite DB separata.

## Verifiche eseguite sulla consegna

I file seguenti coprono gli altri contratti del nuovo motore; il conteggio aggregato va letto insieme al riepilogo finale di validazione della PR, senza sostituirlo con il numero di file caricati.

| File | Contratti controllati |
|---|---|
| `tests/office-work.unit.test.ts` | Azioni chiuse, Napoli, due worker, agente spento/occupato, budget, esito incerto, lease e riserva, mancanza ricevuta, schema assente, consegna incerta, esiti del pianificatore |
| `tests/office-work-tourism.unit.test.ts` | Fonti letterali, sito assente, nessuna verifica prima del clic, checkpoint, rifiuto, budget, isolamento workspace, deck valido, ricevute dubbie, lease scaduta |
| `tests/office-work-api.unit.test.ts` | Autorizzazione proprietario, filtri workspace, token di presa non esposti, correzioni limitate e conflitti di revisione, compatibilità con schema assente |
| `tests/office-work-routing.unit.test.ts` | Ingressi persistenti, caricamento allegati, deleghe del piano, chiavi mancanti, report senza fonti, ricevute My Maps per versione, turni periodici senza secondo consumatore |
| Suite SQL dei lavori | Migrazioni reali, claim, dipendenze, transizioni, approvazioni concorrenti, recupero, permessi e importazione delle code; soltanto su database locale isolato |

Comandi di accettazione eseguiti:

```sh
npm run test:unit
npm run test:db
npx tsc --noEmit
git diff --check
npm run build
```

Risultati:

| Verifica | Esito |
|---|---|
| Suite applicativa completa `npm run test:unit` | **623 casi: 622 superati, 1 saltato, 0 errori** |
| Suite PostgreSQL completa `npm run test:db` | **113 superati, 0 errori** prima dell'ultima regressione aggiuntiva sulle proposte del piano |
| Suite SQL dedicata sulla migration finale | **22 superati, 0 errori**, inclusi otto clic concorrenti sulla delega del Direttore collegata anche alla radice conclusa |
| Nuovo percorso applicativo completo offline | **5 superati**, descritti sopra |
| Handler Tourism | **13 superati** |
| Ingressi, deleghe e turni del motore | **12 superati**; incluse fonte/versione My Maps, preflight delle chiavi, report senza fonti e conservazione del monitoraggio periodico |
| API del titolare | **12 superati**; incluse correzioni che non aggirano le approvazioni |
| TypeScript e controllo diff | Nessun errore |
| Build ottimizzata | Compilazione, controllo tipi e preparazione standalone completati |
| Browser locale desktop/telefono | Superato: blocco, fonte corretta, cronologia, collegamento ordine, annullamento e schema assente; API simulate |

I conteggi delle suite dedicate sono inclusi nelle suite complete quando queste le eseguono: non vanno sommati. La suite DB completa precede l'ultimo caso e l'adeguamento delle guardie delle deleghe; la suite dedicata è stata rieseguita sulla migration finale. Nessuna prova usa dati di produzione. I test SQL usano PostgreSQL isolato, `tests/db.sh` e i DDL originali, senza sostituirli con tabelle semplificate.

Il runtime locale è Node 24; il CRM dichiara Node 20. I nuovi file sono stati eseguiti anche direttamente con `node --import tsx <file>` per verificare i singoli casi. Il collaudo browser usa Chromium locale; non prova le credenziali o la consegna Telegram del deploy.

## Collegamento StudioMap: prova locale distinta

Durante il sottoaudit piattaforma sono stati eseguiti, su storage temporaneo e senza servizi remoti:

```sh
node --import tsx test/jobs-refresh.test.ts
node --import tsx test/office-mymaps.test.ts
node --import tsx test/office-quality.test.ts
```

**15 casi superati**: un caso di snapshot/refresh e quattordici per import My Maps/Qualità. Log `/tmp/platform-jobs-refresh.log`, `/tmp/platform-office-mymaps.log`, `/tmp/platform-office-quality.log`. Verificano conservazione dei testi umani, idempotenza delle ricevute, limite dell'import, protezione Napoli e letture senza mutazioni. Non verificano un nuovo progetto mappa multilingua completo in produzione.

## Matrice degli obiettivi aziendali richiesti

| Scenario del mandato | Autonomia verificata da questo intervento | Limite ancora aperto |
|---|---|---|
| Nuova opportunità commerciale | Ordine e incarichi persistenti; primo percorso Tourism con risultato documentale | Strategia commerciale generale, contratto, attivazione e distribuzione non sono una catena completa collaudata |
| Nuovo progetto mappa | Confini My Maps/Qualità verificati su fixture; ripresa del lavoro governata dal nuovo motore | Non verificato un progetto multilingua completo attraverso StudioMap e Speaqi remoti; testi e pubblicazione mantengono le autorizzazioni esistenti |
| Proposta commerciale completa | Deck Tourism persistito e validato, revisione umana conservata | Non attestata generazione coordinata di preventivo, condizioni economiche e contratto da un obiettivo libero |
| Analisi business | Si riusa il piano deterministico del Direttore e il collegamento alle opportunità | Non equivale a previsioni validate, analisi marginalità o nuovo reparto BI autonomo |
| Errore di un agente | Esito, blocco, diagnosi e regole di tentativo esplicite nei test applicativi/DB | Riconciliazioni economiche incerte restano interventi controllati; nessuna prova contro errori reali del fornitore a pagamento |
| Interruzione del sistema | Checkpoint, lease e fencing verificabili separatamente a livello applicativo e SQL | Non effettuato un arresto del server di produzione o un recupero con fornitori reali |

## Cosa non è una prova di completamento

Una risposta «ordine compreso», un report vuoto, un ente etichettato verificato senza ricevuta e `run.status=done` senza risultato del compito non bastano. La presentazione è riuscita quando esistono deck e slide validi collegati al lavoro. L'email non viene inviata automaticamente. Le notifiche operative al titolare non costituiscono approvazioni dei documenti.

Restano da osservare sul rilascio autorizzato: job `office-work` incluso nella configurazione effettiva, battito del pianificatore, migrazioni applicate prima del codice, primo claim/esito, consegna Telegram alla chat autorizzata e recupero di un turno senza browser aperto. Il rilascio in produzione non viene eseguito durante questi test.
