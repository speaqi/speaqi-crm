# Deploy delle correzioni P0

La PR #100 richiede applicazione selettiva delle migration: non eseguire un
push indiscriminato di tutte le migration pendenti prima del deploy dell'app.
Le tre migration della PR sono state riviste prima del merge; usare i file
presenti nel commit finale, non copie precedenti.

## Ordine

1. Su staging, salvare un backup di `quotes`, `quote_secrets` e
   `gmail_oauth_states` (se presenti). Includere `quote_checkout_attempts` nei
   backup successivi alla sua creazione.
2. Applicare `20261026120000_p0_quote_secrets.sql`: crea i secret, sincronizza
   le scritture legacy durante la transizione, installa il blocco economico
   dopo la firma e i tentativi persistenti di checkout. Le RPC pubbliche di
   accettazione continuano a supportare i link precedenti.
3. Applicare `20261026120200_p0_gmail_oauth.sql`.
4. Deployare il codice e attendere che tutte le istanze precedenti siano
   terminate: i nuovi invii usano la rotazione atomica del token.
5. Applicare `20261026120100_p0_quotes_rls.sql`: azzera la colonna legacy
   ormai sincronizzata, rende i collaboratori in sola lettura e limita
   `mark_quote_checkout_created` al service role.
6. Completare gli smoke test prima di ripetere la stessa sequenza in produzione.

Non fare un ulteriore backfill che sovrascriva indiscriminatamente i secret:
un nuovo token potrebbe essere più recente di quello nella colonna legacy.
Il trigger della prima migration cattura già i token emessi dal vecchio codice
tra il backfill e la sostituzione delle istanze.

## Smoke test

- Owner: crea e modifica un'offerta non firmata; invia e rigenera il link.
  Dopo la rigenerazione, il vecchio link deve fallire anche prima della
  migration RLS finale.
- Verificare un link emesso prima del deploy e uno emesso durante la
  transizione: entrambi devono restare utilizzabili se non rigenerati.
- Collaboratore: legge solo i preventivi assegnati; scrittura e lettura dei
  secret devono essere negate. L'area finanza resta necessaria per gli obiettivi.
- Dopo la firma, cambiare prezzi, quantità frazionarie, IVA, valuta o acconto
  deve fallire. Una modifica partita prima della firma deve essere rifiutata
  se tenta di scrivere nuovi importi dopo di essa.
- IVA e acconto a zero devono restare a zero. Un salvataggio con soli id di
  riga rigenerati non deve impedire il checkout.
- Stripe in modalità test: doppi clic e retry dopo un errore di persistenza
  devono condividere la sessione. Una sessione completata o illeggibile non
  autorizza un nuovo pagamento; una sessione verificata scaduta può invece
  essere sostituita. I pagamenti carta una tantum restano bloccati.
- Bozze e invii automatici diretti devono rifiutare contatti disiscritti,
  nascosti, esclusi, soppressi o in pausa. Kill switch disattivo: nessun invio.
- Gmail: collegamento con cookie corretto, rifiuto di cookie errato/scaduto
  e replay del callback. Due callback devono consumare una sola riga state.

## Checkout incerto e rollback

Ogni tentativo mantiene id e parametri Stripe invariati. Non cancellare una
riga di `quote_checkout_attempts` per sbloccare un pagamento: potrebbe esistere
già una sessione presso Stripe. Se manca `stripe_session_id` e il tentativo ha
più di 23 ore, l'app blocca i nuovi checkout e richiede riconciliazione manuale.
Verificare su Stripe l'esito e il preventivo associato prima di intervenire.

Dopo la migration RLS finale non ripristinare il vecchio codice: dipende dalla
colonna legacy e dai privilegi pubblici rimossi. Preferire un nuovo deploy
correttivo, preservando firme, secret e tentativi di pagamento.

## Verifiche locali della revisione

- Typecheck e build di produzione passati con Node 20.20.2.
- 64 test mirati passati: guardie, delivery/OAuth/checkout, migration PGlite e
  contratti quote/subscription.
- 750 test nei 65 file di `test:unit`, eseguiti uno per processo con
  `node --import tsx`: 746 pass, 3 fail, 1 skip. I tre errori sono in
  `office-api.unit.test.ts` e si riproducono sul commit base `bc620a7`.
- Le prove PGlite usano uno schema minimo: non sostituiscono i test su staging
  con schema completo, PostgREST, Gmail e Stripe.

Nessuna migration remota, merge o deploy è stato eseguito durante la correzione.
