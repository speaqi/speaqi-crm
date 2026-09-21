# Note vocali → attività del To Do (bot Telegram)

Si manda un vocale al bot mentre si è in macchina — «ho chiuso il preventivo
Rossi, domani devo richiamare Bianchi e mercoledì mandare il contratto» — e in
`/todo` compaiono le attività nuove, mentre quelle già fatte risultano chiuse.
Il bot risponde in chat con l'elenco di quello che ha scritto.

## Perché Telegram e non WhatsApp

Il CRM ha già un canale WhatsApp (`docs/WHATSAPP-OPENWA.md`), ma è di **sola
uscita**: notifiche verso di noi. Farlo diventare anche un canale di comando
avrebbe due problemi che qui non ci sono:

- **niente riconsegna**. Il gateway OpenWA tiene agganciato un numero vero via
  QR; se la sessione si sgancia (succede: stato `qr_ready`), i messaggi mandati
  nel frattempo non arrivano e nessuno li ripropone. Telegram riconsegna ogni
  update finché il webhook non risponde `200`;
- **il download dei media** dipende dalla versione del gateway, mentre
  `getFile` è documentato e stabile.

Il canale WhatsApp resta dov'è e fa quello che faceva.

## Il giro, in ordine

1. Telegram consegna l'update a `POST /api/integrations/telegram/webhook`.
2. L'header `x-telegram-bot-api-secret-token` deve corrispondere a
   `TELEGRAM_WEBHOOK_SECRET`, e `chat.id` deve essere in
   `TELEGRAM_ALLOWED_CHAT_IDS`. A una chat non autorizzata non si risponde
   nemmeno: rispondere confermerebbe che il bot è vivo.
3. Si scrive subito una riga in `telegram_inbox`. `update_id` ha un indice
   unico: **è lì** che una riconsegna viene fermata, non nel codice.
4. Se è un vocale si scarica e si trascrive (`transcribeAudio`, lo stesso
   percorso del microfono nel browser). Se è testo, la trascrizione è il testo.
5. Il modello riceve la trascrizione, le attività aperte (più quelle chiuse
   negli ultimi 7 giorni) e le colonne della lavagna, e propone una lista di
   azioni.
6. `normalizeTodoActions` scarta tutto quello che non regge: un `task_id` che
   non è nell'elenco, una creazione senza titolo, una colonna inventata, un
   aggiornamento che non aggiorna niente. **Solo quello che sopravvive viene
   scritto.**
7. Il bot risponde in chat con cosa ha creato e cosa ha aggiornato, e in coda la
   trascrizione: quando capisce male si vede subito perché.

## Cosa capisce

| Come lo si dice | Cosa scrive |
|---|---|
| «devo chiamare Rossi per il preventivo» | attività nuova |
| «entro domani / mercoledì / la settimana prossima» | `due_date` (senza ora, le 9:00) |
| «ho fatto / ho chiuso / ho finito X» | X chiusa, 100% |
| «sto lavorando a X / sono a metà» | X in corso, con la percentuale se detta |
| «sono fermo su X / aspetto risposta» | X in attesa |
| «è urgente / prioritario» | priorità alta |
| «è una cosa personale» | area `personale` |

Un messaggio può contenerne più di uno: è il caso normale.

## Installazione

1. **Crea il bot** su [@BotFather](https://t.me/BotFather) (`/newbot`) e copia
   il token.
2. **Prendi il tuo chat id**: scrivi a [@userinfobot](https://t.me/userinfobot).
3. **Env** su Railway: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` (una
   stringa lunga a caso), `TELEGRAM_ALLOWED_CHAT_IDS` (il tuo id), e
   `TELEGRAM_WORKSPACE_USER_ID` solo se diverso da
   `AUTOMATION_WORKSPACE_USER_ID`. Servono anche `OPENAI_API_KEY` e
   `SUPABASE_SERVICE_ROLE_KEY`, che ci sono già.
4. **Registra il webhook** — da qui, così il token del bot non passa per la
   cronologia del terminale:

   ```bash
   curl -X POST https://crm.speaqi.it/api/integrations/telegram/setup \
     -H "x-automation-secret: $AUTOMATION_SECRET"
   ```

   `GET` sullo stesso indirizzo restituisce lo stato del webhook secondo
   Telegram (`pending_update_count`, ultimo errore): è la prima cosa da guardare
   quando il bot non risponde.
5. **Prova**: manda `ciao, devo ricordarmi di comprare il caffè` in chat. Deve
   comparire in `/todo`, area Speaqi, senza data.

## Quando non funziona

| Sintomo | Dove guardare |
|---|---|
| Il bot non risponde mai | `GET /api/integrations/telegram/setup`: `last_error_message` dice se Telegram riceve un 401 (segreto sbagliato) o non raggiunge l'URL |
| Risponde «non ho capito» | La trascrizione è in coda al messaggio e in `telegram_inbox.transcript`: di solito il vocale è stato capito male, non il comando |
| Crea due volte la stessa cosa | Non dovrebbe: `telegram_inbox.update_id` è unico e ogni creazione porta un `idempotency_key` `telegram:<update_id>:<n>` |
| Aggiorna l'attività sbagliata | `telegram_inbox.intent` contiene le azioni proposte dal modello, con gli id scelti |

## Cosa non copre (per scelta)

- **Un solo destinatario.** Le attività standalone sono visibili solo al
  proprietario del workspace (la policy RLS `tasks_workspace` passa da
  `contacts`, che i collaboratori non hanno). Aprire il bot al team vuol dire
  prima un `telegram_chat_id` su `team_members` e una rilettura di quella
  policy.
- **Nessun comando sui contatti.** Il bot scrive nel To Do personale, non nella
  pipeline: per i contatti c'è `/voice`, che ha la ricerca della scheda giusta.
- **Nessuna conferma prima di scrivere.** Una nota vocale in macchina deve
  restare un gesto solo; quello che è stato scritto si corregge dalla pagina.
