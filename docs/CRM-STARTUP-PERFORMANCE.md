# Caricamento CRM — verifica del 23 ottobre 2026

Il timeout segnalato è confermato nei log PostgREST: falliscono sia la query
`contacts` del set operativo, ordinata per `id`, sia i conteggi di apertura.
Il database contiene 62.179 contatti: 4.061 `crm` e 58.118 `holding`.
Le misure usano il ruolo `authenticated` e le policy RLS effettive, restituendo
solo aggregati e piani, senza schede dei contatti.

## Cause e interventi

| Punto | Prima | Modifica |
| --- | --- | --- |
| Paginazione contatti | Il cursore `id` usava la PK dell'intero archivio. Per la prima pagina scartava 14.777 righe holding. | Indice parziale `(user_id, id)` per `crm`, `personal` e scope legacy null. |
| Badge e cartelle | Otto conteggi concorrenti più una RPC cartelle; RLS richiede anche i campi assegnatario e rende costose le scansioni ripetute. | Un'unica RPC `contact_workspace_summary`, con RLS e filtro applicativo assegnatario. |
| Aggregazione | Il primo tentativo raggruppava anche per stato e flag, producendo file temporanei. | `GROUPING SETS` per totale e cartelle nel medesimo scan, senza spill su disco nella misura finale. |
| Schermata di apertura | `Promise.allSettled` aspettava anche badge, cartelle e To Do. | Team, stage, contatti e task sbloccano la UI; i dati accessori arrivano dopo. Un workspace vuoto aspetta il controllo legacy. |
| Pipeline | Anche uno stato già aggiornato causava una nuova lettura; nove round-trip consecutivi inutili per le fasi predefinite. | Percorso senza modifiche: una sola lettura iniziale. Restano creazione e correzione degli stati mancanti/incompleti. |
| To Do | Il fallimento dello storico faceva perdere anche la risposta pending riuscita. | Risultati pending/done gestiti separatamente. |

## Misure sul database reale

La stessa query di misura conta gli ID di una pagina operativa da 1.000 righe,
con `ORDER BY id LIMIT 1000`, sotto RLS. Non misura serializzazione del payload,
rete, autenticazione o tempo complessivo nel browser.

| Misura | Prima | Dopo l'indice |
| --- | ---: | ---: |
| Esecuzione prima pagina | 4.483 ms | 505 ms |
| Blocchi condivisi letti/trovati in cache | 15.850 | 994 |
| Righe scartate dal filtro | 14.777 | 0 |
| Indice scelto | `contacts_pkey` | `contacts_working_set_cursor_idx` |

Il tempo della misura è sceso di circa l'89%; il carico del database può far
variare i tempi. Il nuovo riepilogo completo ha richiesto circa 3,7 secondi in
una misura isolata, con zero blocchi temporanei, contro nove letture separate
nel percorso precedente. Non è stato misurato il confronto end-to-end del
riepilogo sotto carico concorrente.

Conteggi restituiti dalla RPC in produzione: totale 62.179, CRM/CRM visibili
4.061, holding 58.118, partner 9, personale 0, inbound 0, marketing 61.970.

## Verifica e stato di rilascio

- Applicate al Supabase **Speaqi Crm** le migrazioni
  `20261023094926_crm_startup_performance.sql` e
  `20261023095127_crm_summary_grouping_sets.sql`; i nomi locali sono allineati
  alle versioni effettivamente registrate dal servizio.
- Nessuna modifica alle policy RLS. La RPC è `SECURITY INVOKER`, eseguibile da
  `authenticated`/`service_role`, non da `anon`/`PUBLIC`. Gli advisor di sicurezza
  non hanno introdotto nuove segnalazioni.
- `npm run test:crm-startup`: tre test pipeline e cinque test SQL/PGlite, con
  5.009 contatti sintetici, scope null, hidden, partner, stati chiusi, cartelle,
  workspace vuoto, assegnatari e isolamento fra utenti.
- `npm run test:crm-startup:ui`: browser Chromium sul build standalone locale,
  API tutte intercettate; riepilogo sospeso con contatti già visibili, errore
  Contatti senza import, workspace vuoto con import legacy controllato e
  storico To Do fallito senza perdita dei pending.
- Build di produzione e controllo TypeScript. Runtime della verifica: Node
  24.19.0; il repository dichiara Node 20.x.
- L'indice è già utilizzabile dall'app attualmente pubblicata. Il nuovo endpoint
  riepilogo, il caricamento progressivo e la riduzione delle letture pipeline
  richiedono il deploy del codice applicativo. Nessun deploy applicativo
  eseguito in questa attività.

## Ulteriore limite rilevato

L'archivio attività contiene 29.243 task pending, di cui 29.095 collegati a
contatti CRM e 55 standalone. L'endpoint `/api/tasks` non pagina e la Data API
limita la risposta a 1.000 righe: l'apertura non riceve quindi l'intera coda.
Questo richiede un intervento distinto sul contratto della coda (paginazione o
riepilogo operativo lato server); scaricare tutti i task al bootstrap
aggraverebbe il caricamento. I task esistenti sono conservati.
