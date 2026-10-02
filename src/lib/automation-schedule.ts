/**
 * Le automazioni pianificate del CRM: cosa parte, quando, con quali parametri.
 *
 * Prima le lanciava n8n, un servizio a parte (~5 $/mese su Railway più il suo
 * Postgres) i cui workflow non facevano altro che chiamare a orario gli
 * endpoint `/api/automation/*`: la logica è sempre stata qui. Orari e corpi
 * sono quelli dei workflow attivi in produzione a ottobre 2026 (letti dai log
 * delle chiamate, non solo dagli export in `n8n/`), con due differenze
 * volute:
 *
 *  - `reply-monitor` non viene più chiamato una seconda volta dalla catena
 *    delle campagne commerciali: lo fa già `replies` alla stessa mezz'ora;
 *  - `wine-project-replies` sta solo nella catena Wine. In n8n stava in due
 *    catene perché un nodo fallito fermava tutti quelli dopo; qui ogni passo
 *    parte comunque, quindi una catena basta.
 *
 * Gli orari sono nel fuso di `AUTOMATION_TIMEZONE` (Europe/Rome), come in
 * n8n: "alle 8" vuol dire le 8 italiane, anche dopo il cambio dell'ora.
 *
 * Aggiungere un'automazione è aggiungere una riga qui: il runner
 * (`src/lib/server/automation-scheduler.ts`) non va toccato.
 */

export type ScheduledStep = {
  path: string
  body?: Record<string, unknown>
  /** Tempo massimo della singola chiamata; senza, `DEFAULT_STEP_TIMEOUT_MS`. */
  timeoutMs?: number
}

export type ScheduledJob = {
  name: string
  /** Cron a cinque campi: minuto ora giorno-del-mese mese giorno-della-settimana. */
  cron: string
  description: string
  /** In ordine. Un passo fallito non ferma i successivi. */
  steps: ScheduledStep[]
}

export const DEFAULT_STEP_TIMEOUT_MS = 180_000

export const AUTOMATION_JOBS: ScheduledJob[] = [
  {
    name: 'followups',
    cron: '*/10 * * * *',
    description: 'Task dovuti, SLA e recupero preventivi',
    steps: [{ path: '/api/automation/followups', body: { sla_mode: true, quote_recovery: true } }],
  },
  {
    name: 'replies',
    cron: '*/30 * * * *',
    description: 'Risposte Gmail e bozze inviate a mano da Gmail',
    steps: [
      { path: '/api/automation/reply-monitor', body: { since_minutes: 60 } },
      { path: '/api/automation/reconcile-drafts', body: { lookback_days: 7 } },
    ],
  },
  {
    name: 'wine-project',
    cron: '*/30 * * * *',
    description: 'Wine Project: sequenza, invii di gruppo, aperture e risposte',
    steps: [
      { path: '/api/automation/wine-project-followups', body: {} },
      { path: '/api/automation/wine-project-campaigns', body: { limit: 150 } },
      { path: '/api/automation/wine-project-engagement', body: {} },
      { path: '/api/automation/wine-project-replies', body: {} },
    ],
  },
  {
    name: 'commercial-outreach',
    cron: '*/30 * * * *',
    description: 'Campagne commerciali (solo prova: dry_run)',
    steps: [{ path: '/api/automation/commercial-outreach', body: { dry_run: true, limit: 100 } }],
  },
  {
    name: 'notifications-digest',
    cron: '5,35 7-21 * * *',
    description: 'Riepilogo notifiche su Telegram',
    steps: [{ path: '/api/automation/whatsapp-digest', body: { dry_run: false }, timeoutMs: 60_000 }],
  },
  {
    name: 'db-maintenance',
    cron: '0 * * * *',
    description: 'Pulizia dati',
    steps: [{ path: '/api/automation/db-maintenance', body: {} }],
  },
  {
    name: 'reconcile-sends',
    cron: '20 * * * *',
    description: 'Chiude gli invii automatici dall\'esito incerto',
    steps: [{ path: '/api/automation/reconcile-sends', body: { limit: 20 }, timeoutMs: 120_000 }],
  },
  {
    name: 'backup',
    cron: '0 3 * * *',
    description: 'Backup notturno del database',
    steps: [{ path: '/api/automation/backup', body: { keep: 30 }, timeoutMs: 300_000 }],
  },
  {
    name: 'score-leads',
    cron: '0 6 * * *',
    description: 'Ricalcolo punteggio lead',
    steps: [{ path: '/api/automation/score-leads', body: { limit: 500 } }],
  },
  {
    name: 'acumbamail-qualification',
    cron: '0 7 * * *',
    description: 'Promozione holding → CRM',
    steps: [{ path: '/api/automation/acumbamail-qualification', body: {} }],
  },
  {
    name: 'weekly-recap',
    cron: '30 7 * * 1',
    description: 'Recap settimanale via email (lunedì)',
    steps: [{ path: '/api/automation/weekly-recap', body: {} }],
  },
  {
    name: 'orchestrator',
    cron: '0 8 * * 1-5',
    description: 'Bozze email AI del mattino',
    steps: [{ path: '/api/automation/orchestrator', body: { days_ahead: 3, max_contacts: 50 } }],
  },
  {
    name: 'stale-leads',
    cron: '0 9 * * *',
    description: 'Lead fermi da 5 giorni',
    steps: [{ path: '/api/automation/stale-leads', body: { stale_days: 5 } }],
  },
  {
    name: 'send-holding',
    cron: '0 9 * * 1-5',
    description: 'Invii holding (solo prova: dry_run)',
    steps: [{ path: '/api/automation/send-batch', body: { limit: 3, min_age_minutes: 60, dry_run: true } }],
  },
]

type CronField = { values: Set<number>; any: boolean }
export type ParsedCron = { minute: CronField; hour: CronField; dom: CronField; month: CronField; dow: CronField }

const FIELD_RANGES: Array<[number, number]> = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7],
]

function parseField(raw: string, [min, max]: [number, number]): CronField {
  const values = new Set<number>()
  for (const part of raw.split(',')) {
    const [rangePart, stepPart] = part.split('/')
    const step = stepPart === undefined ? 1 : Number(stepPart)
    if (!Number.isInteger(step) || step < 1) throw new Error(`Passo non valido: ${part}`)
    let from: number
    let to: number
    if (rangePart === '*') {
      from = min
      to = max
    } else if (rangePart.includes('-')) {
      ;[from, to] = rangePart.split('-').map(Number)
    } else {
      from = Number(rangePart)
      to = stepPart === undefined ? from : max
    }
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < min || to > max || from > to) {
      throw new Error(`Valore fuori intervallo: ${part}`)
    }
    for (let value = from; value <= to; value += step) values.add(value)
  }
  return { values, any: raw === '*' }
}

export function parseCron(expression: string): ParsedCron {
  const fields = expression.trim().split(/\s+/)
  if (fields.length !== 5) throw new Error(`Cron a cinque campi atteso: "${expression}"`)
  const [minute, hour, dom, month, dow] = fields.map((field, index) => parseField(field, FIELD_RANGES[index]))
  // 7 e 0 sono entrambi domenica.
  if (dow.values.has(7)) dow.values.add(0)
  return { minute, hour, dom, month, dow }
}

export type LocalTime = { minute: number; hour: number; day: number; month: number; weekday: number }

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

/** L'ora "da orologio da muro" nel fuso indicato, cambio dell'ora compreso. */
export function localTime(date: Date, timeZone: string): LocalTime {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      weekday: 'short',
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value])
  )
  return {
    minute: Number(parts.minute),
    hour: Number(parts.hour),
    day: Number(parts.day),
    month: Number(parts.month),
    weekday: WEEKDAYS[parts.weekday],
  }
}

export function cronMatches(cron: ParsedCron, time: LocalTime) {
  if (!cron.minute.values.has(time.minute)) return false
  if (!cron.hour.values.has(time.hour)) return false
  if (!cron.month.values.has(time.month)) return false
  const domOk = cron.dom.values.has(time.day)
  const dowOk = cron.dow.values.has(time.weekday)
  // Regola classica di cron: se entrambi i giorni sono ristretti basta uno dei due.
  if (!cron.dom.any && !cron.dow.any) return domOk || dowOk
  return domOk && dowOk
}

/** I job da far partire nel minuto che contiene `date`. */
export function dueJobs(date: Date, timeZone: string, jobs: ScheduledJob[] = AUTOMATION_JOBS) {
  const time = localTime(date, timeZone)
  return jobs.filter((job) => cronMatches(parseCron(job.cron), time))
}

/** Il minuto UTC, senza secondi: la chiave con cui una replica prenota la corsa. */
export function slotOf(date: Date) {
  const slot = new Date(date)
  slot.setUTCSeconds(0, 0)
  return slot.toISOString()
}
