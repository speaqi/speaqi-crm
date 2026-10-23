# Agente 06 — Ricercatore eventi

Branch `codex/office-06-events`, base `main` aggiornato a `0033118`.
Gestione in `/ufficio/agenti`; nessuna modifica alla scena `/ufficio`.

Nasce spento con budget 100/350/1500 centesimi giorno/settimana/mese e:

```json
{"sources":[],"queries":[]}
```

Il titolare deve aggiungere fonti vere: massimo trenta URL pubblici. Non ci
sono fonti precompilate o inventate. GET con `fetchResearchPage`, massimo cinque
in parallelo, senza redirect o accesso a indirizzi privati. Nessuna iscrizione,
compilazione di moduli, pubblicazione o invio email.

Il job `office-events-scout` controlla le 06:30 Europe/Rome e parte ogni due
giorni locali, contando dal 1 gennaio 1970. La cadenza attraversa mesi, anni e
cambi dell'ora. Le corse manuali sono permesse anche negli altri giorni, ma il
claim giornaliero del workspace impedisce comunque una seconda spesa.

Le query fisse vengono conservate e dichiarate non eseguite nel report.
La discovery web esistente è dedicata agli enti Tourism e non espone una
ricerca eventi riutilizzabile con costi prenotabili nel ledger Ufficio. Questo
agente usa soltanto `settings.sources`, senza simulare una ricerca web.

JSON-LD Event, iCal VEVENT e RSS/Atom con campi data evento espliciti sono letti
prima del modello. `pubDate` non è una data evento. Per le sole pagine senza
struttura si usa `callModel` con JSON Schema strict e budget prenotato. Il modello
legge al massimo 20.000 caratteri e 100 link per pagina; le prove congelate
contengono fino a 60.000 caratteri, 500 link e 1.000 date. Massimo 100 candidati
strutturati per pagina, 20 dal modello e 200 nuovi eventi per corsa. L'analisi
del modello si ferma dopo 12 minuti più l'ultima richiesta; i limiti e gli
errori sono dichiarati nel resoconto, senza retry automatici.

Nome, città e organizzatore devono apparire nella fonte. Ogni data e link deve
avere riscontro nella pagina; nessuna città, email o paese viene indovinato.
La finestra è da oggi a sei mesi di calendario (fine mese gestita). iCal DTEND
resta la data esclusiva pubblicata, senza sottrarre un giorno non presente
nella fonte; la LOCATION libera non diventa una città senza X-CITY esplicito.
La provenienza ufficiale del sito non viene certificata dall'agente: il
titolare sceglie le fonti e rivede i link proposti.

Il punteggio viene dal codice, dal nome/organizzatore e dal contesto letto
attorno al nome: turismo 25, destinazioni 15, crociere 20, musei 15, DMC 20,
hospitality 20, wine 10, guide digitali 25. Aggiunge il peso del tipo (fair 15,
b2b_workshop 20, grant 25, conference 10), massimo 100. Nessuna parola chiave
pertinente significa zero e l'evento viene escluso; il modello non dà punteggi.

`office_events` conserva i nuovi eventi per slug/data di inizio e non riscrive
i record già noti. Il report «Eventi e bandi» mostra soltanto i nuovi, in ordine
di scadenza. Una proposta per decidere la partecipazione nasce anche per eventi
già noti che entrano nella finestra dei trenta giorni, purché ancora futuri e
senza una proposta precedente. Rifiuti e approvazioni non vengono riproposti.

Solo approvando la proposta si crea un To Do standalone con chiave
`office-event:<UUID evento>`, scadenza a mezzanotte Europe/Rome, contact_id null,
type todo e area speaqi. Otto clic concorrenti o due proposte dello stesso
evento non duplicano l'attività; rifiutare non crea niente. Una scadenza
trascorsa lascia la proposta pending, da rifiutare. La funzione di decisione
copia quella del 05: gli altri due rami sono verificati anche testualmente.

Migration nuova, da applicare a cura del titolare dopo revisione:
`20261023120100_office_events.sql`. Generata con Supabase CLI e riordinata dopo
`20261023090100`. Prerequisiti già in main: schema Ufficio 00, Finanza 11,
Commerciale 10, Direttore 01 e `20261023090000_office_db_cleaner.sql`; per le
attività le migration `20260330094500_ai_ready_crm.sql`,
`20260603100000_standalone_tasks.sql`, `20260722100000_task_planning_trace.sql`
e `20260903100000_todo_board.sql`. Poi applicare la migration del 06.
Non dipende dalle nuove tabelle 07/09/12. Tabelle eventi e batch nei due backup.

Verifiche finali:

- `npx tsc --noEmit`: superato.
- `npm run test:unit`: 506 passati, 0 falliti, 1 skip preesistente (dettaglio TTG).
- `npm run test:db`: 73 passati, 0 falliti, 0 skip, PostgreSQL 16 locale isolato.
- `npx next build`: superato con configurazione Supabase fittizia.

Le nuove prove DB usano `tests/office-schema.ts` e le migration vere elencate
in `tests/office-events-schema.ts`, comprese tutte le dipendenze per eseguire
un merge reale del 05, senza sostituirlo con un mock. Si simula solo il confine
Supabase Auth; CHECK, FK, NOT NULL e RLS restano. Le due pagine salvate sono
esempi di test, non fonti preconfigurate. Nessun dato di produzione usato.

Non provati dal vivo: feed scelti dal titolare, credenziali/fatturazione OpenAI,
runtime Supabase/PostgREST e Railway di produzione. Nessuna chiamata AI a
pagamento, migration operativa, iscrizione, invio o deploy. Un tentativo
incerto resta prenotato per la giornata; verificare batch, corsa e ledger
prima di una riconciliazione manuale.
