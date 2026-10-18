# Verifiche del 17–18 ottobre 2026

Ambiente locale: Node 24.19.0; il repository mantiene `engines.node=20.x`. La migrazione è stata applicata anche al Supabase del CRM; verifiche e backup del rilascio sono in [RELEASE.md](./RELEASE.md). Nessuna email inviata. Il runtime Node 20 del deploy target va incluso nella validazione del rilascio.

| Verifica | Risultato e ambito |
| --- | --- |
| `npm run test:tourism` | 11 test unitari + 21 test database passati. Log aggiornato: `acquisition-test-results.txt` |
| Acquisitori pubblici | 25 test Python: classificazione fieristica, esclusione fornitori e attività fuori ambito, confini paese, identità in conflitto, cache scaduta, classi organizzative, catture istituzionali incomplete, payload SQL e rimozione dei batch generati diventati obsoleti. Log: `acquisition-python-tests.txt` |
| Database | Migrazione eseguita in PGlite/PostgreSQL WASM con ruoli, RLS, trigger, funzioni e transazioni reali. Nessun mock per i vincoli SQL |
| Integrità | Import atomico, rollback anche dell'audit, reimport 17/17 senza modifiche, evidenze e identità verificate separate, modifiche che invalidano attestazioni, revisione su versione corrente |
| Sicurezza | Accesso area riservato al proprietario, RLS fra due workspace, inserimento cross-tenant negato, audit non scrivibile dall'utente, ingestione persone bloccata, schema relazioni tipizzato |
| CRM | Promozione idempotente, recapiti solo se verificati, nessun marketing eleggibile automatico, blocco per paese non normalizzato o email condivisa, niente duplicati silenziosi |
| Job | Esclusione di un secondo avvio durante una lease attiva; ripresa della lease scaduta con nuovo tentativo. La concorrenza multi-processo PostgreSQL/Supabase non è misurata da PGlite e richiede un test sul target |
| Ricerca | Nomi giapponesi conservati e ricercabili, pagine successive senza sovrapposizione, ricerca su più di una pagina |
| Performance locale | Ultimo run registrato: 600 fixture sintetiche importate in circa 460 ms; due pagine di ricerca in circa 3 ms. Include SQL in memoria, non rete o carico di produzione; non è uno SLA |
| Browser Chromium | 12 flussi passati con API intercettate: comprende ricevute/copertura, filtro corrispondenze e collegamento esplicito a un contatto esistente, oltre ai 9 flussi originari; viewport mobile e zero errori JS. Risultato in `acquisition-browser-results.json` |
| Basemap | 177 feature Natural Earth servite localmente, caricate nel browser. La mappa non dipende da servizi di tile esterni. Provenienza/licenza in `public/tourism-assets/NOTICE.md` |
| Regressione mirata | Quattro file di test esistenti passati: scheduler, team login, fiere, email destinazioni. Log in `regression-results.txt`. La suite campagne su Postgres esterno non è stata eseguita in questo ambiente |
| TypeScript | `tsc --noEmit --incremental false` passato, inclusi i tipi delle route generati da Next |
| Build e packaging | Build Next riuscita, 138 pagine generate; asset copiati nel bundle standalone. Log aggiornato: `acquisition-build-results.txt` |
| HTTP reale | `GET /api/tourism` senza bearer token ha risposto 401 con `Unauthorized` sul server locale |

La suite browser è passata anche sul bundle di produzione avviato mediante `start.cjs` (API sempre intercettate). La discovery è verificata con trasporto simulato: schema, fonti citate dal provider, limite di candidati e chiamate, esclusione di email personali/score inventati. Non è stata effettuata una ricerca AI reale: precisione del provider, latenza e costo per organizzazione verificata restano da misurare.

L'integrazione bidirezionale è implementata con transazioni SQL e conferma UI. Sul Supabase del CRM sono stati verificati migrazione, privilegi effettivi, isolamento RLS, importazione, revisione, promozione idempotente e sync bidirezionale in una transazione annullata. Il catalogo è stato poi popolato realmente da fonti mondiali: ricevute, conteggi, matching e limiti sono in [ACQUISITION.md](./ACQUISITION.md). Le cinque organizzazioni già presenti sono conservate. Il campione italiano resta una fixture separata. Il backup locale è stato riletto e controllato; restano da provare il ripristino, il percorso browser autenticato sul deploy e il comportamento con più processi.

![Anteprima del modulo con dati di test](./preview.png)
