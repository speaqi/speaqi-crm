# Osservatorio novità — consegna

Branch `codex/office-07-news` da main `ee23d62`, PR indipendente verso main.
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
