# Osservatorio novità — consegna

Branch `codex/office-07-news` da main aggiornato `7f57b7b`, PR indipendente verso main.
Nessuna dipendenza dai branch 02/04 o dal Social 12.

Migration nuova da applicare a cura di Claude prima del merge:
`20261023055356_office_news_watch.sql`, dopo le migration esistenti del
registro 00, Finanza 11, Commerciale 10 e Direttore 01. Non applicata a database
operativi durante lo sviluppo. Le prove applicano i file solo come fixture
su Postgres locale isolato; tabelle esistenti caricate dalle migration reali.

Configurare `settings.feeds` con gli RSS o le pagine datate desiderati;
`settings.competitors` è modificabile. L'agente nasce spento. Non modifica mappe.
Telegram è facoltativo e richiede sempre un clic esplicito del titolare.
La semplice approvazione registra solo la decisione; il pulsante dedicato
approva e invia sul bot configurato, senza fallback su WhatsApp.

Un tentativo incerto del modello o di Telegram resta registrato. Verificare
l'esito reale e il ledger prima di una riconciliazione manuale; non cancellare
le prenotazioni per riprovare alla cieca. Il giorno dopo parte una nuova
rassegna, senza ripagare la precedente. Le notizie senza data non entrano.

Non provati dal vivo: disponibilità dei feed scelti dal titolare, credenziali
OpenAI/Telegram/Railway e PostgREST di produzione. Tutti i servizi nei test sono
simulati; nessun invio reale o deploy.

Verifiche sul branch aggiornato con main `7f57b7b`:
- `npx tsc --noEmit`: superato.
- `npm run test:unit`: 483 passati, 0 falliti, 1 skip preesistente
  (pagina di dettaglio del sito TTG).
- `npm run test:db`: 52 passati, 0 falliti, 0 skip su PostgreSQL 16 locale.
- `npx next build`: superato con configurazione Supabase fittizia, nessun deploy.

Le suite DB Base, Finanza, Commerciale, Direttore e questo agente caricano
DDL dalle migration reali. La suite 05 ereditata da main resta invariata. Anche le modifiche alle fixture
sono indipendenti e identiche nelle due PR: nessuna PR richiede l'altra.
