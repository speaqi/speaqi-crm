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

## Ordine di riaccensione consigliato

Riattiva un workflow alla volta e osserva per qualche giorno prima del successivo:

1. **01-followups** (ogni 10 min) — massimo impatto: rigenera i task dovuti,
   gli SLA e il recupero preventivi. È quello che tiene piena la lista delle
   cose da fare.
2. **06-db-maintenance** (ogni ora) — igiene: riallinea follow-up e task,
   pulisce le bozze scartate. Evita che il disordine si riaccumuli.
3. **07-weekly-recap** (lunedì 07:30) — email di recap settimanale:
   pipeline per stadio, vinte/perse, chiamate dei prossimi 14 giorni,
   contatti da recuperare.
4. **02-stale-leads** (ogni giorno 09:00) — task "Riattiva X" sui contatti
   fermi da più di 5 giorni.
5. **05-reply-monitor** (ogni 30 min) — sync Gmail + classificazione AI delle
   risposte. Prima di attivarlo verifica che i token OAuth Gmail siano validi.
6. **03-speaqi-webhook** — solo se il form del sito è attivo.
7. **04-orchestrator** (lun-ven 08:00) — bozze email AI del mattino
   (restano bozze: l'invio è sempre manuale). Ultimo perché è il più complesso.

## Endpoint chiamati

| Workflow | Endpoint | Schedule |
|---|---|---|
| 01-followups | `POST /api/automation/followups` | `*/10 * * * *` |
| 02-stale-leads | `POST /api/automation/stale-leads` | `0 9 * * *` |
| 03-speaqi-webhook | `POST /api/speaqi/leads` (webhook inbound) | — |
| 04-orchestrator | `POST /api/automation/orchestrator` | `0 8 * * 1-5` |
| 05-reply-monitor | `POST /api/automation/reply-monitor` | `*/30 * * * *` |
| 06-db-maintenance | `POST /api/automation/db-maintenance` | `0 * * * *` |
| 07-weekly-recap | `POST /api/automation/weekly-recap` | `30 7 * * 1` |

Test manuale di un endpoint (senza n8n):

```bash
curl -X POST "$APP_BASE_URL/api/automation/weekly-recap" \
  -H "x-automation-secret: $AUTOMATION_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"dry_run": true}'
```
