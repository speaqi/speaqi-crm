# Social — consegna

Branch `codex/office-12-social` da main aggiornato `8f11d8b`, PR indipendente verso main.
Non dipende dal 07 o dai branch 02/04. La scena `/ufficio` resta intatta.

Migration nuova: `20261023060654_office_social_drafts.sql`, da applicare a cura
di Claude prima del merge, dopo le migration esistenti 00/11/10/01. Nessuna
applicazione a database operativi. Le prove applicano i file solo come fixture
su un database Postgres locale usa-e-getta, con DDL e CHECK reali.

L'agente nasce spento. Nessuna nuova env o credenziale social: usa le fonti
pubbliche Speaqi esistenti e OPENAI_API_KEY. Non chiama mai API social, non
invia email e non pubblica; prepara solo draft_post pending da copiare a mano.

Dati mancanti restano dichiarati: le lingue previste non sono lingue completate,
il paywall non prova zero itinerari e non sono disponibili i luoghi più aperti.
Non si pubblicizzano novità senza timestamp o snapshot verificabili. Se manca
una foto HTTPS ricevuta dalla mappa, la guida non è usata. Napoli è esclusa.

Dopo un timeout il tentativo e la riserva restano registrati: riconciliare
manualmente prima di un'altra spesa. Nessun retry automatico a pagamento.

Non provati dal vivo: credenziali e fatturazione OpenAI, catalogo/payload/foto
Speaqi e Railway/PostgREST di produzione. I test usano risposte simulate e
nessun dato operativo; nessun deploy.

Verifiche sul branch aggiornato con main `8f11d8b`:
- `npx tsc --noEmit`: superato.
- `npm run test:unit`: 463 passati, 0 falliti, 1 skip preesistente
  (pagina di dettaglio del sito TTG).
- `npm run test:db`: 45 passati, 0 falliti, 0 skip su PostgreSQL 16 locale.
- `npx next build`: superato con configurazione Supabase fittizia, nessun deploy.

Tutte le suite DB dell'ufficio (base, Finanza, Commerciale, Direttore e questo
agente) caricano DDL dalle migration reali. Anche le modifiche alle fixture
sono indipendenti e identiche nelle due PR: nessuna PR richiede l'altra.
