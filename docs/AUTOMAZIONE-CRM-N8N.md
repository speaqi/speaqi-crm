# Automazione Speaqi CRM — piano esecutivo definitivo

## 1. Obiettivo

Mettere in esercizio le automazioni già presenti nel CRM, renderle osservabili e abilitare successivamente l'invio autonomo delle sole email cold appartenenti allo scope `holding`.

Vincoli non negoziabili:

- i contatti `crm` restano sempre human-in-the-loop;
- `personal` non può essere usato dall'automazione;
- n8n è soltanto scheduler e sistema di alert: autorizzazione, selezione e invio vivono nell'applicazione;
- un retry, un timeout o due esecuzioni concorrenti non devono produrre due email;
- il service role non deve permettere accessi tra workspace;
- nessuna bozza con esito incerto viene rimessa automaticamente in coda;
- il `dry_run` non produce alcun effetto esterno o modifica dati;
- le email devono rispettare il modello commerciale Speaqi corrente: piano unico per progetto, nessun tier legacy e nessun credito video esposto.

## 2. Stato attuale

- Gli 8 workflow in `n8n/workflows/` sono esportati con `"active": false`.
- Non esiste un Error Workflow condiviso.
- `/api/automation/score-leads` e `/api/automation/acumbamail-qualification` non sono schedulati.
- Il dry run di `followups` può inviare la reminder email.
- `05-reply-monitor.json` passa `since_minutes`, ma la route non lo usa.
- Alcuni endpoint possono restituire `200` nonostante errori interni.
- `/api/automation/send` invia una sola bozza e usa una sequenza non atomica: legge `pending`, invia, poi aggiorna `sent`.
- `email_drafts.status` ammette soltanto `pending`, `sent`, `dismissed`.
- `email_logs` non contiene `draft_id`, `send_attempt_id` o una chiave univoca di idempotenza.
- Le route automation usano il service role e devono quindi applicare esplicitamente il perimetro workspace.

---

## 3. Fase A — Osservabilità e correzioni bloccanti

Questa fase non abilita invii cold automatici.

### A1. Autenticazione automation condivisa

Creare `src/lib/server/automation-auth.ts` ed estrarre il controllo oggi duplicato nelle route.

Requisiti:

- confronto a tempo costante del secret;
- rifiuto se `AUTOMATION_SECRET` non è configurato;
- risposta uniforme `401` senza dettagli sensibili;
- helper per restituire il contesto autorizzato dell'automazione.

Nella prima versione, che opera su un solo workspace, il contesto è determinato server-side da:

- `AUTOMATION_WORKSPACE_USER_ID`, configurato su Railway;
- lo stesso valore configurato nell'ambiente n8n solo se necessario per diagnostica, mai accettato come autorità dal body HTTP.

Il client non può scegliere il workspace. In futuro la coppia `secret -> workspace_user_id` potrà essere sostituita da credenziali separate per workspace senza cambiare le route operative.

### A2. Correggere il dry run dei follow-up

In `src/app/api/automation/followups/route.ts`, impedire che `sendReminderEmail` venga chiamato quando `dry_run === true`.

Regola generale: durante un dry run sono vietati email, insert, update, chiamate a provider, claim e prenotazioni di quota.

### A3. Errori HTTP osservabili

Adottare una risposta uniforme:

- `200`: esecuzione completata, anche con zero elementi;
- `4xx`: richiesta o autenticazione non valida;
- `500`: almeno un errore interno non recuperato;
- payload con `ok`, `processed`, `skipped`, `errors` e dettagli non sensibili.

Applicare almeno a `followups`, `orchestrator` e `reply-monitor`, mantenendo la convenzione già usata da `backup`.

### A4. Correggere la finestra del reply monitor

Fare rispettare `since_minutes` dalla route:

- intero positivo;
- default esplicito 60;
- massimo server-side prudente;
- stesso valore riportato nella risposta.

### A5. Error Workflow n8n

Creare `n8n/workflows/00-error-handler.json` con `Error Trigger` e invio a `REMINDER_EMAIL` di:

- workflow ed execution ID;
- nodo fallito;
- messaggio;
- timestamp;
- URL dell'esecuzione, se disponibile.

Configurarlo come Error Workflow degli altri workflow e documentarlo in `n8n/README.md`.

### A6. Criteri di completamento

- Tutti gli endpoint supportati passano un dry run senza effetti collaterali.
- Un fallimento applicativo produce HTTP non-2xx e un alert.
- Un run vuoto resta verde.
- Build e lint sono puliti.

---

## 4. Fase B — Accensione graduale delle automazioni esistenti

Attivare un workflow alla volta:

1. `00-error-handler`;
2. `08-backup`;
3. `01-followups`;
4. `06-db-maintenance`;
5. `07-weekly-recap`;
6. `02-stale-leads`;
7. `05-reply-monitor`;
8. `03-speaqi-webhook`;
9. `04-orchestrator`.

Per ogni attivazione:

1. eseguire manualmente in dry run;
2. eseguire un run controllato;
3. verificare dati e alert;
4. osservare almeno un ciclo naturale prima di procedere.

L'orchestrator deve funzionare almeno sette giorni senza invio autonomo. Durante questo periodo si revisiona quotidianamente un campione delle bozze `holding`.

### B1. Workflow mancanti

Creare:

- `09-score-leads.json`: ogni giorno alle 06:00, `POST /api/automation/score-leads`, body `{"limit":500}`;
- `10-acumbamail-qualification.json`: ogni giorno alle 07:00, `POST /api/automation/acumbamail-qualification`, body `{}`.

In `acumbamail-qualification`, sostituire il calcolo locale del follow-up con le funzioni canoniche di `src/lib/sla.ts`.

### B2. Controlli operativi

- Nessun duplicato negli `idempotency_key` dei task.
- Backup presente nel bucket e retention di 30 file.
- Score aggiornati con contatori plausibili.
- Promozioni Acumbamail limitate ai contatti realmente qualificati.
- Nessun errore silenzioso per almeno un ciclo di ogni workflow.

---

## 5. Fase C — Persistenza sicura dell'invio

Questa fase prepara il motore, ma non attiva ancora il cron di invio.

### C1. Migrazione `email_drafts`

Estendere lo stato con:

```text
pending | sending | sent | failed | unknown | dismissed
```

Aggiungere:

- `send_attempt_id uuid`;
- `sending_at timestamptz`;
- `send_attempts integer not null default 0`;
- `last_send_error text`;
- `provider_message_id text`;
- `sent_at`, già esistente, mantenuto;
- indice su `(user_id, status, created_at)`;
- indice univoco parziale su `send_attempt_id` quando valorizzato;
- indice univoco parziale su `provider_message_id` quando valorizzato.

`user_id` continua a rappresentare il workspace owner nei dati CRM. L'eventuale account mittente viene memorizzato separatamente nel tentativo.

### C2. Tabella dei tentativi

Creare `automation_send_attempts`:

- `id uuid primary key`;
- `workspace_user_id uuid not null`;
- `sender_user_id uuid not null`;
- `draft_id uuid not null`;
- `contact_id uuid not null`;
- `status`: `claimed`, `provider_accepted`, `sent`, `failed_pre_send`, `unknown`, `reconciled`;
- `recipient_email`, normalizzata;
- `message_id_header`, univoco;
- `provider_message_id`, univoco quando presente;
- `error_code`, `error_detail` sanitizzato;
- `claimed_at`, `completed_at`, `created_at`, `updated_at`;
- vincolo che consenta un solo tentativo non terminale per bozza.

Ogni email usa un `Message-ID` RFC deterministico derivato dal tentativo. Questo consente di cercare il messaggio in Gmail quando la chiamata ha esito incerto.

### C3. Contatore atomico della quota

Creare `automation_send_daily_counters`:

- `workspace_user_id`;
- `sender_user_id`;
- `local_day` calcolato nella timezone configurata;
- `reserved_count`;
- `sent_count`;
- chiave primaria composta sui primi tre campi.

Creare funzioni SQL transazionali per:

- `reserve_send_slot`: incrementa `reserved_count` soltanto se `reserved_count + sent_count < cap`;
- `commit_send_slot`: trasforma una prenotazione in invio;
- `release_send_slot`: libera solo un tentativo sicuramente fallito prima della consegna al provider.

Le funzioni devono essere idempotenti per `send_attempt_id`. Due processi che vedono `39/40` non possono entrambi ottenere l'ultimo slot.

### C4. Claim atomico

Creare una funzione SQL/RPC che, in un'unica transazione:

1. verifica che la bozza sia ancora `pending`;
2. verifica `draft.user_id = contact.user_id = workspace_user_id`;
3. verifica che l'account Gmail appartenga al workspace autorizzato;
4. crea il tentativo;
5. prenota la quota;
6. aggiorna la bozza a `sending` con `send_attempt_id` e `sending_at`;
7. restituisce la bozza soltanto al processo che ha ottenuto il claim.

Se uno dei passaggi fallisce, nessuna modifica viene mantenuta.

### C5. Stati ed esiti

Flusso obbligatorio:

```text
pending -> sending -> sent
                  -> failed -> pending solo con retry esplicito
                  -> unknown -> reconciliation -> sent
                                            \-> failed -> retry esplicito
```

Regole:

- errore certo prima della chiamata Gmail: `failed_pre_send`, quota liberabile;
- Gmail restituisce successo: persistere immediatamente provider ID, `sent` e consumo quota;
- timeout, connessione interrotta o errore dopo l'invio: `unknown`, quota mantenuta prenotata;
- `unknown` non torna mai automaticamente `pending`;
- `06-db-maintenance` segnala tentativi bloccati, ma non li rimette in coda;
- solo la riconciliazione può stabilire se un tentativo `unknown` è stato inviato;
- ogni retry è un'azione esplicita e auditata.

### C6. Riconciliazione Gmail

Creare un servizio che cerchi il messaggio mediante `message_id_header` e, se disponibile, provider message ID:

- se trovato: segna tentativo e bozza `sent`, consolida la quota;
- se non trovato entro una finestra configurata: segna `failed`, libera la quota e rende possibile un retry esplicito;
- se Gmail non è interrogabile: mantiene `unknown` e genera alert.

Nessuna assenza momentanea di risposta equivale automaticamente a “non inviato”.

### C7. Criteri di completamento

- Due claim concorrenti sulla stessa bozza producono un solo proprietario.
- Due prenotazioni concorrenti rispettano esattamente il cap.
- Un timeout simulato non rimette la bozza in coda.
- La riconciliazione riconosce un messaggio già accettato da Gmail.
- Tutte le migrazioni hanno test di rollback logico e compatibilità con le bozze esistenti.

---

## 6. Fase D — Motore applicativo e batch

### D1. Servizio condiviso

Creare `src/lib/server/automation-send.ts` e trasformare `/api/automation/send` in un wrapper compatibile.

Il servizio riceve un contesto server-side, non un workspace scelto dal body:

```ts
type AutomationContext = {
  workspaceUserId: string
  senderUserId: string
  timezone: string
}
```

Il mittente deve appartenere al workspace. Il fallback globale “unico account Gmail” non è ammesso nel percorso automatico.

### D2. Rivalidazione immediata

Subito prima del claim verificare:

- bozza `pending`, `source='auto'` e sufficientemente vecchia;
- `contact_scope === 'holding'`;
- contatto e bozza nello stesso workspace autorizzato;
- email presente e valida;
- nessuna disiscrizione;
- marketing non in pausa;
- stage non chiuso;
- nessuna risposta inbound successiva alla creazione della bozza;
- nessun invio equivalente recente allo stesso destinatario;
- oggetto e corpo non vuoti;
- contenuto conforme a `validateGeneratedDraft` e al modello commerciale corrente.

Il controllo viene ripetuto dopo la selezione e prima del claim per ridurre le race condition.

### D3. Endpoint `POST /api/automation/send-batch`

Input consentito:

```json
{
  "limit": 3,
  "min_age_minutes": 60,
  "dry_run": true
}
```

Non accetta `workspace_user_id`, `sender_user_id` o scope arbitrari. Workspace e mittente sono ricavati dalla configurazione autorizzata. La v1 usa esclusivamente `holding`; richieste per `crm` o `personal` sono rifiutate.

Vincoli server-side:

- limite di default 3, massimo iniziale 20;
- elaborazione seriale;
- pausa configurabile tra invii;
- cap giornaliero atomico, default 40;
- timezone esplicita `Europe/Rome` finché il workspace non dispone di una propria configurazione;
- ordinamento deterministico per `created_at`, poi `id`;
- massimo un invio automatico allo stesso destinatario nella finestra configurata.

Risposta:

```json
{
  "ok": true,
  "dry_run": true,
  "processed": 3,
  "sent": 0,
  "skipped": [],
  "unknown": [],
  "errors": []
}
```

Un batch vuoto restituisce `200`. Errori interni o esiti `unknown` producono stato degradato non-2xx e alert. Il payload non espone contenuti o dati appartenenti ad altri workspace.

### D4. Invio singolo esistente

`/api/automation/send` deve riusare lo stesso motore, claim, quota e riconciliazione. Non devono esistere due percorsi di invio automatico con garanzie differenti.

### D5. Test obbligatori

- dry run senza alcuna scrittura;
- skip per email mancante, unsubscribe, pausa, personal, CRM e stage chiuso;
- blocco se arriva una risposta dopo la creazione della bozza;
- blocco workspace mismatch;
- account Gmail esterno al workspace rifiutato;
- due batch concorrenti, un solo invio per bozza;
- cap concorrente rispettato;
- timeout prima di Gmail: quota liberata;
- timeout con esito incerto: stato `unknown`, nessun retry automatico;
- riconciliazione positiva e negativa;
- nessun piano legacy o credito video nei contenuti;
- build e lint puliti.

---

## 7. Fase E — Workflow e rollout controllato

Creare `n8n/workflows/11-send-holding.json`:

- cron feriale iniziale alle 09:00;
- chiamata a `send-batch` senza identificatori di workspace nel body;
- `limit: 3`, `min_age_minutes: 60`;
- Error Workflow configurato;
- retry automatico disabilitato nella fase iniziale.

L'orario del cron non sostituisce il controllo server-side sull'età della bozza.

### E1. Shadow mode

Per almeno cinque giorni lavorativi:

- eseguire soltanto `dry_run`;
- revisionare ogni candidato;
- registrare falsi positivi, motivi di skip e problemi di copy;
- richiedere zero candidati fuori `holding` e zero mismatch workspace.

### E2. Primo invio live

1. `limit: 3`, concorrenza uno.
2. Verificare bozza, tentativo, quota, `gmail_messages`, `email_logs` e casella Gmail.
3. Simulare un nuovo run e confermare assenza di duplicati.
4. Controllare risposte, bounce e disiscrizioni.
5. Mantenere disponibile un kill switch server-side, ad esempio `AUTOMATION_SEND_ENABLED=false`.

### E3. Aumento progressivo

Aumentare solo dopo approvazione manuale:

```text
3 -> 5 -> 10 -> 20 per run
```

Non aumentare il cap giornaliero finché non sono disponibili dati sufficienti su recapito, bounce, risposte, disiscrizioni e reputazione del mittente.

### E4. Metriche minime

- candidati, inviati, skipped, failed e unknown;
- duplicati, obiettivo zero;
- bounce e disiscrizioni;
- risposte ricevute;
- invii per mittente e giorno;
- età media delle bozze;
- tempo di riconciliazione;
- errori e tentativi bloccati.

---

## 8. Ordine di implementazione

1. Fase A: fix dry run, errori, finestra reply monitor e Error Workflow.
2. Test e attivazione progressiva della Fase B.
3. Migrazione e primitive atomiche della Fase C.
4. Servizio e batch della Fase D.
5. Almeno sette giorni di orchestrator e cinque giorni di shadow mode.
6. Fase E con tre invii reali.
7. Aumento graduale soltanto dopo verifica.

Non iniziare la Fase E se una qualsiasi garanzia della Fase C non è dimostrata dai test.

## 9. Fuori scope ma prioritario

Manca il webhook Stripe che riconcili automaticamente i pagamenti dei preventivi. Finché il pagamento viene aggiornato solo manualmente, `followups` può creare attività di recupero per preventivi già pagati. Questo è il successivo intervento prioritario.

Restano successivi:

- classificazione live delle risposte;
- sincronizzazione bidirezionale del calendario;
- automazione del log degli esiti di chiamata.

## 10. Definizione di completamento

L'invio holding è autonomo soltanto quando:

- dry run e osservabilità sono affidabili;
- il workspace è determinato server-side;
- bozza, contatto e account Gmail sono isolati esplicitamente;
- claim e quota sono atomici;
- `crm` e `personal` sono rifiutati dalla v1;
- timeout e retry non producono duplicati;
- gli esiti incerti vengono riconciliati, mai riciclati automaticamente;
- esiste un kill switch;
- shadow mode e primo run live hanno superato la revisione manuale.
