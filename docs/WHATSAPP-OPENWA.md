# Notifiche WhatsApp (gateway OpenWA)

Il CRM manda su WhatsApp quello che succede alle email: risposte subito, invii
e reazioni in un riepilogo. Il ponte è [OpenWA](https://github.com/rmyndharis/OpenWA),
un gateway self-hosted (NestJS + whatsapp-web.js/Baileys) che tiene agganciato
un numero WhatsApp vero e lo pilota via REST.

## Prima di tutto: cosa può andare storto

- **Non è l'API ufficiale Meta.** OpenWA pilota un client WhatsApp reale. Usare
  un numero per mandare messaggi non richiesti lo fa segnalare e bloccare.
  Qui viaggia solo traffico interno — notifiche a noi stessi, poche decine di
  messaggi al giorno, sempre alla stessa chat — che è l'uso a rischio basso.
  **Non** usare questo canale per outreach ai contatti.
- **Serve un numero dedicato**, non quello personale: se WhatsApp lo blocca, si
  perde il numero, non solo le notifiche.
- **La sessione si sgancia.** WhatsApp Web scollega i dispositivi inattivi e la
  sessione vive su disco: senza volume persistente ogni redeploy chiede di
  riscansionare il QR. Lo stato si controlla da `/impostazioni/whatsapp`.
- **Il volume è il vero nemico.** Su una lista da migliaia di cantine le
  aperture sono centinaia al giorno: un messaggio per evento rende il telefono
  inutilizzabile e fa sembrare il numero un bot. Per questo solo le risposte
  escono subito, tutto il resto è un riepilogo ogni mezz'ora.

## Come funziona nel CRM

```
fatto nel CRM  →  whatsapp_notification_events  →  messaggio WhatsApp
```

| Fatto | Dove viene intercettato | Consegna |
|---|---|---|
| Email inviata dal CRM o da un'automazione | `sendContactEmail` (`src/lib/server/gmail.ts`) | riepilogo |
| Invio di una sequenza via Acumbamail (Wine Project, campagne commerciali) | `/api/automation/wine-project-campaigns` e `-commercial-outreach`, un evento per batch con `quantity` | riepilogo |
| Email inviata a mano da Gmail | `handleOutboundSyncedMessages` (al sync, finestra 72 h) | riepilogo |
| Apertura / click / disiscrizione | webhook Acumbamail (`applyEventToContact`) | riepilogo |
| Risposta ricevuta | `handleInboundReplies` (al sync Gmail, finestra 72 h) | **subito** |

Le finestre di 72 ore evitano che il primo sync di un contatto — che importa
tutto lo storico — riversi su WhatsApp email di mesi fa.

Un evento sta in coda finché non è **davvero** partito: `notified_at` si
valorizza solo dopo una risposta positiva del gateway. Se il gateway era spento,
il riepilogo successivo recupera la coda invece di perderla. E, per non
accumulare code inutili, con gateway non configurato o interruttore spento gli
eventi non vengono nemmeno registrati.

L'agente che compare nel messaggio è il `responsible` del contatto (o
`assigned_agent`), lo stesso campo su cui girano le analytics di `/attivita`.

- Cron: `POST /api/automation/whatsapp-digest` (`AUTOMATION_SECRET`), workflow
  n8n `14-whatsapp-digest.json`, ogni mezz'ora dalle 7 alle 21.
- Pagina di controllo: `/impostazioni/whatsapp` — stato sessione, coda,
  messaggio di prova, riepilogo forzato.
- Tabelle: `whatsapp_notification_events` (coda) e
  `whatsapp_notification_sends` (storico degli invii, per capire se un
  messaggio non è mai partito o non è stato consegnato).

## Variabili d'ambiente

Nelle env stanno solo le credenziali del gateway, che sono infrastruttura. Il
**numero destinatario, l'interruttore e la scelta degli eventi si impostano da
`/impostazioni/whatsapp`** e vivono su `whatsapp_notification_settings`:
cambiare numero non deve voler dire aprire Railway e riavviare il servizio.

| Variabile | Descrizione |
|---|---|
| `OPENWA_BASE_URL` | URL del gateway con la porta su cui ascolta davvero, es. `http://openwa.railway.internal:8080` |
| `OPENWA_API_KEY` | API key OpenWA (ruolo Operator basta) |
| `OPENWA_SESSION_ID` | **UUID** della sessione, non il nome |
| `WHATSAPP_NOTIFY_TO` | Facoltativa: numero di partenza, vale solo finché non si salva dalla pagina |
| `WHATSAPP_NOTIFY_ENABLED` | Facoltativa: `false` è il freno di emergenza, spegne tutto anche a interruttore acceso |

Un numero italiano scritto senza prefisso (`3896868162`) prende il `+39` da
solo: WhatsApp non segnala un destinatario inesistente, quindi il prefisso lo
mette il CRM.

## Deploy su Railway

1. **Nuovo servizio** nello stesso progetto del CRM, sorgente
   `https://github.com/rmyndharis/OpenWA` (builder Dockerfile: il repo ne ha uno).
   Sulla stessa porta gira sia l'API sia la dashboard React.

   **Quale porta.** `src/main.ts` di OpenWA fa `process.env.PORT || 2785`: il
   2785 e solo il default di chi non impone nulla. Railway **inietta la sua
   `PORT`** (di norma 8080), quindi l'app ascolta li. Non combatterlo forzando
   `PORT=2785` — prendi la porta che Railway assegna e usa la stessa in tre
   punti: il target del dominio, `OPENWA_BASE_URL` sul CRM, e l'indirizzo di
   rete privata. E' l'allineamento che conta, non il numero.
2. **Volume persistente montato su `/app/data`**. Li dentro stanno la sessione
   WhatsApp, il database SQLite e la chiave di bootstrap: senza volume, ogni
   redeploy azzera tutto e chiede di riscansionare il QR.
3. Variabili del servizio OpenWA: bastano i default. SQLite sul volume regge
   questo uso; Postgres e Redis servono solo con molte sessioni.
4. Il gateway **non va esposto pubblicamente** se non serve: il CRM lo raggiunge
   sulla rete privata Railway (`openwa.railway.internal:<porta>`). La rete
   privata non indovina la porta: se l'indirizzo la sbaglia, il CRM riceve un
   connection refused e la pagina dice solo "Gateway WhatsApp irraggiungibile".
   Per aprire la
   dashboard la prima volta puoi generare un dominio pubblico temporaneo e poi
   toglierlo. Se lo lasci esposto, l'API key e l'unica difesa.

### Da dove arrivano i tre valori

| Variabile | Dove si prende |
|---|---|
| `OPENWA_BASE_URL` | Lo decidi tu: e l'indirizzo del servizio OpenWA. Su Railway, rete privata: `http://openwa.railway.internal:<porta>` (sostituisci `openwa` col nome del servizio). La porta va sempre indicata — vedi sotto: su Railway e la `PORT` iniettata dalla piattaforma, tipicamente 8080. |
| `OPENWA_API_KEY` | La genera OpenWA al primo avvio: la stampa nei **log di deploy** (riquadro "🔑 API Key (newly created)") e la salva in `/app/data/.api-key`. Se ti sfugge, ne crei un'altra dalla dashboard (sezione API Keys): il ruolo **operator** basta. |
| `OPENWA_SESSION_ID` | E l'**UUID** della sessione WhatsApp, che nasce quando crei la sessione. Dalla dashboard: crea la sessione, aprila, copia l'id. Da riga di comando e la risposta di `POST /api/sessions` (campo `id`), oppure `GET /api/sessions`. Il **nome** della sessione non funziona: le rotte accettano solo l'id. |

### La sessione, da riga di comando

Se preferisci non esporre la dashboard:

```bash
curl -X POST "$OPENWA_BASE_URL/api/sessions" \
  -H "X-API-Key: $OPENWA_API_KEY" -H 'Content-Type: application/json' \
  -d '{"name":"speaqi-crm"}'
# il campo "id" della risposta e' OPENWA_SESSION_ID

curl -X POST "$OPENWA_BASE_URL/api/sessions/$OPENWA_SESSION_ID/start" \
  -H "X-API-Key: $OPENWA_API_KEY"

curl "$OPENWA_BASE_URL/api/sessions/$OPENWA_SESSION_ID/qr" \
  -H "X-API-Key: $OPENWA_API_KEY"
```

Scansiona il QR da WhatsApp del numero dedicato (Impostazioni → Dispositivi
collegati). Lo stato passa a `ready`.

### Poi

5. Sul servizio CRM: imposta le tre variabili `OPENWA_*` e riavvia.
6. Apri `/impostazioni/whatsapp`: il numero e gia salvato, verifica che la
   sessione sia `ready` e manda il messaggio di prova. Poi attiva
   `14-whatsapp-digest` su n8n.

## Diagnostica

- **Non arriva niente.** `/impostazioni/whatsapp`: configurazione completa?
  interruttore `true`? sessione `ready`? Se lo stato è `qr_ready` il numero è
  stato sganciato e va riscansionato.
- **Il messaggio non è mai partito.** `whatsapp_notification_sends` conserva
  corpo, esito ed errore di ogni tentativo; gli eventi rimasti indietro sono le
  righe di `whatsapp_notification_events` con `notified_at is null`.
- **Il gateway risponde 409.** La sessione non è connessa (riconnessione o
  reload di WhatsApp Web): l'evento resta in coda e riparte al giro dopo.
- **"Gateway WhatsApp irraggiungibile" oppure "Application failed to respond"
  aprendo il dominio.** Quasi sempre e la porta disallineata: l'app ascolta
  sulla `PORT` iniettata da Railway, non sul 2785 del default. Confronta il
  target del dominio, `OPENWA_BASE_URL` e la porta reale nei log di avvio.
- **Troppi messaggi.** Togli gli eventi rumorosi (di solito le aperture) dalla
  pagina impostazioni, oppure dirada il cron di `14-whatsapp-digest`.

Gli invii sono ripartiti per campagna nel riepilogo, perché sapere che sono
uscite 165 email serve poco se non si sa da quale progetto:

```
📤 165 email inviate
   · Wine Project — Vinitaly · Email 1/5: 98
   · Wine Project — Vinitaly · Email 2/5: 22
   · Hospitality · Email 3/5: 42
   · CRM: 3
```

L'etichetta porta anche lo step della sequenza: due email della stessa campagna
possono partire nella stessa mezz'ora, e un totale unico non direbbe quale passo
è avanzato.

`CRM` raccoglie quello che non nasce da una campagna: bozze AI, invii a mano,
automazioni di holding.

## Cosa non copre (per scelta)

- Le aperture ricalcolate in blocco da `/api/integrations/acumbamail/sync-campaign`
  non generano notifiche: sono conteggi storici, non fatti appena successi.
- Un solo destinatario per workspace. Notificare ogni agente sul proprio numero
  vuole un campo `whatsapp_number` su `team_members` e l'instradamento per
  `responsible`: la coda è già segnata con l'agente, quindi è un'aggiunta, non
  una riscrittura.
- Nessun comando in ingresso: i webhook di OpenWA verso il CRM non sono
  collegati, il canale è di sola uscita.
