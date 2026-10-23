# Presentazioni — consegna

Branch `codex/office-09-presentations` da main aggiornato `7f57b7b`.
PR indipendente verso main; non richiede i branch 07 o 12. Il 03 e il 05 restano
al lavoro di Claude; Napoli e la scena `/ufficio` non sono modificati.

Agente spento, budget 3 EUR/settimana, job lunedì alle 10:00 italiane, massimo
due generazioni per corsa. Gestione e coda in `/ufficio/agenti`:

```json
{"queue":[{"entity_id":"UUID dell’ente","destination_id":"UUID della destinazione"}]}
```

Si può inserire anche solo l'UUID dell'ente se ha una sola relazione COVERS
con fonte verificata verso una destinazione. Le identità devono essere
verificate nel workspace e non disabilitate. Il 08 può aggiungere la stessa
struttura di coda; non è necessaria una sua implementazione per usare il 09.

La generazione usa la pipeline Tourism e il modello salvato, con trasporto
OpenAI coperto dal ledger Ufficio. Non approva deck, non crea PDF prima del
clic umano e non invia email. Le proposte sui segnaposto non modificano slide:
la fonte, il campo e il valore verificato sono visibili nel `data_fix`.
Una proposta approvata nel registro resta una decisione da applicare nell'editor.

Approvando il deck in Tourism, il database prepara la bozza email `office/pending`
nel motore esistente. L'email deve avere una evidenza VERIFIED e un contatto CRM
collegato con la stessa email, visibile e non disiscritto. Una bozza pendente
per quel destinatario blocca la nuova. Il cron può recuperare questo solo passo
gratuito quando i dati sono pronti. Nessuna API Gmail, social, mappe o invio.

Una sola prenotazione persistente per ente/destinazione e un UUID stabile per
il deck impediscono doppi deck/costi. Dopo un timeout o un crash controllare
deck, task e ledger: non cancellare il claim per ripagare alla cieca.
La coda non si svuota automaticamente e non rigenera i deck già presi in carico.
La modifica di un deck approvato usa le regole esistenti (torna in revisione,
link non pubblico). Le bozze preparate restano da controllare prima dell'invio
manuale; non sono inviate o riscritte dall'agente dopo una modifica del deck.

Migration nuova, da far applicare a Claude prima del merge:
`20261023090100_office_presentations.sql`. Generata con Supabase CLI e riordinata
dopo il timestamp del 05 già in main. Ordine dei prerequisiti:

1. Tourism Intelligence `20261017205455_tourism_intelligence.sql`, ricerca
   `20261018185155_tourism_site_research.sql`, esclusioni
   `20261019051155_tourism_sitemap_targeting.sql`, deck
   `20261019190000_tourism_decks.sql`.
2. Ufficio `20261022160000_office_agents.sql`, Finanza
   `20261022170450_office_finance.sql`, Commerciale
   `20261022175856_office_sales_followup.sql`, Direttore
   `20261022183327_office_director.sql` (già presenti in main).
3. La migration del 09. Nessuna dipendenza dalle migration 07/12.

Nessuna migration su database operativi, deploy o merge. I test applicano SQL
solo su PostgreSQL locale usa-e-getta. Le suite nuove e Base/Finanza/Commerciale/
Direttore caricano DDL dalle migration reali, inclusi CHECK di email_drafts;
la suite 05 ereditata da main resta invariata.

Non provati dal vivo: credenziali e fatturazione OpenAI, database/PostgREST e
Railway di produzione, invio manuale email, PDF con Chromium reale. Le prove
simulano OpenAI e non eseguono generazioni a pagamento. Nessuna ricerca esterna
di nuovi fatti: si usano soltanto le evidenze già verificate in Tourism.

Verifiche con main `7f57b7b`:
- `npx tsc --noEmit`: superato.
- `npm run test:unit`: 480 passati, 0 falliti, 1 skip preesistente
  (pagina di dettaglio del sito TTG).
- `npm run test:db`: 54 passati, 0 falliti, 0 skip su PostgreSQL 16 locale.
- `npx next build`: superato con configurazione Supabase fittizia.

Le prime build simultanee si sono fermate per disco locale pieno (ENOSPC).
Ripuliti esclusivamente gli artefatti `.next` dei checkout temporanei di questi
agent, poi build ripetute in sequenza. Nessun file del checkout utente rimosso.
