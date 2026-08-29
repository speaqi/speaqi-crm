# Hospitality Italia 2026

## Stato

- Implementazione pronta, non distribuita.
- Campagna creata sempre con `status = paused` e `approval_status = analysis`.
- Workflow n8n incluso ma esportato con `active = false`.
- Nessun contatto importato nel database e nessuna email inviata durante lo sviluppo.

## Dry-run del 28 agosto 2026

File: `/Users/massimo/Downloads/Hotel Totale - Hotel Italia Full.csv`

Checksum SHA-256: `1089e2898d87b4d6c7d312ce209223315795c496ba7133609215f368688dedb6`

| Metrica | Valore |
|---|---:|
| Righe | 56.420 |
| Strutture uniche per chiave sorgente | 56.420 |
| Email primarie uniche valide | 55.968 |
| Email alternative uniche valide | 14.839 |
| Classificate ricettive | 52.522 |
| Da revisionare | 2.118 |
| Escluse per categoria | 1.780 |
| Eleggibili dopo controllo email, categorie miste e mailbox condivise | 41.661 |
| In revisione marketing | 12.971 |
| Escluse marketing | 1.788 |

Controllo qualità aggiuntivo del 29 agosto 2026:

- 778 righe appartengono a mailbox primarie condivise tra più strutture e sono state spostate in revisione;
- le categorie miste restano `include` come classificazione ricettiva, ma non sono eleggibili all'invio senza revisione;
- nessun `place_id` duplicato e nessuna struttura duplicata sulla chiave sorgente;
- l'arruolamento richiede sia `marketing_legal_basis` sia `marketing_source_acquired_at` valorizzati.

Questi numeri derivano dalle regole versionate nell'importer e non sono stati forzati per coincidere con una stima precedente. Tutti i record ambigui, misti o con mailbox condivisa devono restare senza invio fino alla revisione.

## Comandi

Dry-run, senza scritture esterne:

```bash
npm run hospitality:import
```

Import riprendibile dopo migrazione e revisione (richiede credenziali service role):

```bash
npm run hospitality:import -- --apply --user-id <WORKSPACE_OWNER_UUID>
```

Lo stesso checksum riusa il batch esistente e riparte da `cursor_row`. La chiave idempotente del contatto usa `place_id`, poi `google_id`, dominio del sito ed email.

## Ordine di rilascio

1. Revisionare un campione di almeno 100 inclusi, 50 esclusi e i casi ambigui.
2. Applicare `20260828180000_hospitality_outreach.sql`.
3. Configurare `ACUMBAMAIL_TRANSACTIONAL_WEBHOOK_URL` e verificare il callback eventi.
4. Eseguire l'import con `--apply` una sola volta.
5. Importare il workflow `12-hospitality-commercial.json` in n8n e abilitarlo.
6. Lasciare la campagna in `analysis`/`paused` finché DPO o consulente privacy non approva la base legale.
7. Dopo approvazione, impostare `approval_status = approved` e avviare il pilota da 100/giorno dal pannello Hospitality.

## Gate di sicurezza

- L'endpoint di invio restituisce `campaign_paused_or_not_approved` se manca uno dei due gate CRM.
- Il cap viene riservato sotto lock includendo messaggi `sending` e `sent`, quindi due scheduler concorrenti non possono superarlo.
- Hard bounce: una sola alternativa, poi stop.
- Reclamo/disiscrizione: soppressione della struttura.
- Risposta Gmail: stop sequenza, passaggio a `Interested`, attività e task.
- Anomalie bounce/reclami: pausa automatica.
- `COMMERCIAL_OUTREACH_SEND_ENABLED=false` resta disponibile come kill switch d'emergenza.
