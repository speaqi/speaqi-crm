# Workflow n8n — Speaqi CRM

Tutti i workflow sono **esportati spenti** (`"active": false`): vanno riattivati
sull'istanza n8n uno alla volta. Sono solo "orologi": la logica vive negli
endpoint `/api/automation/*` dell'app, protetti da `x-automation-secret`.

## Variabili d'ambiente richieste su n8n

| Variabile | Uso |
|---|---|
| `APP_BASE_URL` | Base URL dell'app (es. `https://crm.speaqi.it`) — usata da tutti i workflow |
| `AUTOMATION_SECRET` | Deve coincidere con l'env dell'app |
| `REMINDER_EMAIL` | Destinatario di reminder e recap |
| `SPEAQI_WEBHOOK_SECRET` | Solo per 03 (ingestion lead dal sito) |

Variabili lato applicazione per l'invio sicuro:

| Variabile | Uso |
|---|---|
| `AUTOMATION_WORKSPACE_USER_ID` | Owner del workspace autorizzato; non arriva dal body n8n |
| `AUTOMATION_SENDER_USER_ID` | Account Gmail mittente; nella v1 coincide con l'owner |
| `AUTOMATION_TIMEZONE` | Timezone del cap, default `Europe/Rome` |
| `AUTOMATION_SEND_ENABLED` | Kill switch; lasciare `false` fino al rollout live |
| `AUTOMATION_DAILY_SEND_CAP` | Cap atomico giornaliero, default 40 |
| `AUTOMATION_SEND_DELAY_MS` | Pausa opzionale tra invii |
| `AUTOMATION_RECONCILE_FAIL_HOURS` | Finestra di riconciliazione, minimo 24 ore |

## Ordine di riaccensione consigliato

Riattiva un workflow alla volta e osserva per qualche giorno prima del successivo:

1. **00-error-handler** — importalo per primo, configura le credenziali SMTP
   del nodo email e selezionalo come Error Workflow nelle impostazioni degli
   altri workflow. L'ID è assegnato da n8n durante l'importo e non può essere
   precompilato nei JSON.
2. **08-backup** (ogni notte 03:00) — primo workflow operativo: e l'unica rete di
   sicurezza sui dati, visto che il piano Free di Supabase non ha backup ne
   PITR. Non tocca nulla, legge soltanto.
3. **01-followups** (ogni 10 min) — massimo impatto: rigenera i task dovuti,
   gli SLA, il recupero preventivi e la sequenza Wine Project. È quello che
   tiene piena la lista delle cose da fare. Per Wine Project blocca in modo
   automatico le azioni successive se il contatto ha risposto, si è disiscritto
   o la trattativa è chiusa.
4. **06-db-maintenance** (ogni ora) — igiene: riallinea follow-up e task,
   pulisce le bozze scartate. Evita che il disordine si riaccumuli.
5. **07-weekly-recap** (lunedì 07:30) — email di recap settimanale:
   pipeline per stadio, vinte/perse, chiamate dei prossimi 14 giorni,
   contatti da recuperare.
6. **02-stale-leads** (ogni giorno 09:00) — task "Riattiva X" sui contatti
   fermi da più di 5 giorni.
7. **05-reply-monitor** (ogni 30 min) — sync Gmail + classificazione AI delle
   risposte, poi riconciliazione delle bozze `/email` spedite a mano da Gmail.
   Prima di attivarlo verifica che i token OAuth Gmail siano validi.
8. **03-speaqi-webhook** — solo se il form del sito è attivo.
9. **04-orchestrator** (lun-ven 08:00) — bozze email AI del mattino.
10. **09-score-leads** e **10-acumbamail-qualification** — endpoint orfani.
11. **11-send-holding** — soltanto dopo sette giorni di osservazione; è
    esportato in shadow mode con `dry_run: true`.

## Endpoint chiamati

| Workflow | Endpoint | Schedule |
|---|---|---|
| 01-followups | `POST /api/automation/followups` | `*/10 * * * *` |
| 02-stale-leads | `POST /api/automation/stale-leads` | `0 9 * * *` |
| 03-speaqi-webhook | `POST /api/speaqi/leads` (webhook inbound) | — |
| 04-orchestrator | `POST /api/automation/orchestrator` | `0 8 * * 1-5` |
| 05-reply-monitor | `POST /api/automation/reply-monitor` + `POST /api/automation/reconcile-drafts` | `*/30 * * * *` |
| 06-db-maintenance | `POST /api/automation/db-maintenance` | `0 * * * *` |
| 07-weekly-recap | `POST /api/automation/weekly-recap` | `30 7 * * 1` |
| 08-backup | `POST /api/automation/backup` | `0 3 * * *` |
| 09-score-leads | `POST /api/automation/score-leads` | `0 6 * * *` |
| 10-acumbamail-qualification | `POST /api/automation/acumbamail-qualification` | `0 7 * * *` |
| 11-send-holding | `POST /api/automation/send-batch` | `0 9 * * 1-5` |

Il piano di test, shadow mode e rollout è in
[`docs/AUTOMAZIONE-CRM-N8N.md`](../docs/AUTOMAZIONE-CRM-N8N.md).

Test manuale di un endpoint (senza n8n):

```bash
curl -X POST "$APP_BASE_URL/api/automation/weekly-recap" \
  -H "x-automation-secret: $AUTOMATION_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"dry_run": true}'
```
