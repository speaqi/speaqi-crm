import {
  AUTOMATION_JOBS,
  DEFAULT_STEP_TIMEOUT_MS,
  dueJobs,
  slotOf,
  type ScheduledJob,
} from '@/lib/automation-schedule'
import { errorMessage } from '@/lib/server/http'
import { createServiceRoleClient } from '@/lib/server/supabase'

/**
 * Il pianificatore che ha preso il posto di n8n. Gira dentro il processo del
 * CRM (avviato da `src/instrumentation.ts`) e a ogni minuto chiama gli
 * endpoint `/api/automation/*` dei job dovuti, sullo stesso server, con
 * `AUTOMATION_SECRET`: passa dalle stesse rotte, con la stessa autenticazione,
 * di quando li chiamava n8n.
 *
 * Tre garanzie, ognuna con la sua ragione:
 *
 *  1. **Una corsa per minuto, con qualunque numero di repliche.** Prima di
 *     partire il job prenota la riga `(job, slot)` in `automation_job_runs`;
 *     la chiave primaria fa vincere una replica sola. Senza, scalare il CRM a
 *     due istanze avrebbe raddoppiato follow-up, backup e invii.
 *  2. **Un job lento non si accavalla con se stesso** nella stessa istanza: se
 *     la corsa precedente non e' finita, quella nuova salta il turno, come
 *     sarebbe successo a mano.
 *  3. **Un passo fallito non ferma i successivi, e si sa.** L'errore finisce
 *     nella riga della corsa e via email (`/api/automation/error-alert`, lo
 *     stesso avviso che mandava n8n), al massimo una volta ogni sei ore per
 *     job: un endpoint rotto ogni dieci minuti non deve riempire la casella.
 *
 * Si accende con `AUTOMATION_SCHEDULER_ENABLED=true`. Spento di default perche'
 * accenderlo mentre n8n gira ancora farebbe partire tutto due volte.
 */

const ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000
const RUN_RETENTION_DAYS = 30
const UNDEFINED_TABLE = '42P01'

export type StepResult = { path: string; status: number | null; ok: boolean; ms: number; error?: string }

export type SchedulerDeps = {
  baseUrl: string
  secret: string
  fetch: typeof fetch
  /** true se questa istanza ha vinto la corsa del minuto. */
  claim: (job: string, slot: string) => Promise<boolean>
  finish: (job: string, slot: string, result: { ok: boolean; steps: StepResult[]; error: string | null }) => Promise<void>
  alert: (job: string, slot: string, message: string) => Promise<void>
  log?: (message: string) => void
}

const running = new Set<string>()
const lastAlertAt = new Map<string, number>()

async function runStep(deps: SchedulerDeps, step: ScheduledJob['steps'][number]): Promise<StepResult> {
  const started = Date.now()
  try {
    const response = await deps.fetch(`${deps.baseUrl}${step.path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-automation-secret': deps.secret },
      body: JSON.stringify(step.body || {}),
      signal: AbortSignal.timeout(step.timeoutMs || DEFAULT_STEP_TIMEOUT_MS),
    })
    const ok = response.ok
    let error: string | undefined
    if (!ok) {
      const payload = await response.json().catch(() => null)
      error = String(payload?.error || payload?.message || `HTTP ${response.status}`).slice(0, 500)
    }
    return { path: step.path, status: response.status, ok, ms: Date.now() - started, error }
  } catch (error) {
    return { path: step.path, status: null, ok: false, ms: Date.now() - started, error: errorMessage(error, 'Chiamata fallita') }
  }
}

export async function runJob(deps: SchedulerDeps, job: ScheduledJob, slot: string) {
  if (running.has(job.name)) {
    deps.log?.(`[scheduler] ${job.name}: corsa precedente ancora in corso, salto ${slot}`)
    return { skipped: 'running' as const }
  }
  // Il segno va messo prima della prenotazione, che e' asincrona: altrimenti
  // due giri ravvicinati passerebbero entrambi il controllo qui sopra.
  running.add(job.name)
  try {
    if (!(await deps.claim(job.name, slot))) return { skipped: 'claimed' as const }

    const steps: StepResult[] = []
    for (const step of job.steps) steps.push(await runStep(deps, step))

    const failed = steps.filter((step) => !step.ok)
    const error = failed.length
      ? failed.map((step) => `${step.path}: ${step.error || `HTTP ${step.status}`}`).join(' · ')
      : null
    await deps.finish(job.name, slot, { ok: !error, steps, error })

    if (error) {
      deps.log?.(`[scheduler] ${job.name} ${slot} fallito: ${error}`)
      const last = lastAlertAt.get(job.name) || 0
      if (Date.now() - last >= ALERT_COOLDOWN_MS) {
        lastAlertAt.set(job.name, Date.now())
        await deps.alert(job.name, slot, error).catch(() => undefined)
      }
    }
    return { ok: !error, steps }
  } finally {
    running.delete(job.name)
  }
}

/** Fa partire, senza aspettarli, i job dovuti nel minuto di `now`. */
export function runDueJobs(deps: SchedulerDeps, now: Date, timeZone: string, jobs: ScheduledJob[] = AUTOMATION_JOBS) {
  const slot = slotOf(now)
  return dueJobs(now, timeZone, jobs).map((job) =>
    runJob(deps, job, slot).catch((error) => {
      deps.log?.(`[scheduler] ${job.name} ${slot}: ${errorMessage(error, 'errore')}`)
    })
  )
}

function supabaseDeps(log: (message: string) => void) {
  const supabase = createServiceRoleClient()
  let tableMissingLogged = false

  const claim = async (job: string, slot: string) => {
    const { error } = await supabase.from('automation_job_runs').insert({ job, slot })
    if (!error) return true
    if (error.code === '23505') return false
    // Migration non ancora applicata: meglio far girare il job senza
    // prenotazione (una replica sola, come oggi) che fermare le automazioni.
    if (error.code === UNDEFINED_TABLE) {
      if (!tableMissingLogged) log('[scheduler] automation_job_runs assente: corse senza prenotazione')
      tableMissingLogged = true
      return true
    }
    // Database irraggiungibile: non sappiamo se un'altra replica abbia gia'
    // preso la corsa. Saltare un giro costa meno che fare due backup o due
    // invii.
    log(`[scheduler] prenotazione ${job} ${slot} fallita: ${error.message}`)
    return false
  }

  const finish: SchedulerDeps['finish'] = async (job, slot, result) => {
    await supabase
      .from('automation_job_runs')
      .update({ finished_at: new Date().toISOString(), ok: result.ok, steps: result.steps, error: result.error })
      .eq('job', job)
      .eq('slot', slot)
    // Lo storico serve per capire cosa e' successo di recente, non per sempre.
    if (job === 'db-maintenance') {
      const cutoff = new Date(Date.now() - RUN_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()
      await supabase.from('automation_job_runs').delete().lt('slot', cutoff)
    }
  }

  return { claim, finish }
}

let started = false

export function startAutomationScheduler() {
  if (started) return
  if (String(process.env.AUTOMATION_SCHEDULER_ENABLED || '').trim().toLowerCase() !== 'true') return

  const log = (message: string) => console.log(message)
  const secret = String(process.env.AUTOMATION_SECRET || '').trim()
  if (!secret) {
    log('[scheduler] AUTOMATION_SECRET mancante: pianificatore spento')
    return
  }
  started = true

  const timeZone = String(process.env.AUTOMATION_TIMEZONE || 'Europe/Rome').trim()
  const baseUrl = `http://127.0.0.1:${process.env.PORT || 3000}`
  const { claim, finish } = supabaseDeps(log)

  const deps: SchedulerDeps = {
    baseUrl,
    secret,
    fetch,
    claim,
    finish,
    log,
    alert: async (job, slot, message) => {
      await fetch(`${baseUrl}/api/automation/error-alert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-automation-secret': secret },
        body: JSON.stringify({ workflow: job, execution_id: slot, node: job, message, timestamp: new Date().toISOString() }),
        signal: AbortSignal.timeout(30_000),
      })
    },
  }

  // Un giro all'inizio di ogni minuto. Il timer si riallinea a ogni giro,
  // cosi' la deriva di setInterval non fa saltare o ripetere un minuto.
  const tick = () => {
    const now = new Date()
    runDueJobs(deps, now, timeZone)
    setTimeout(tick, 60_000 - (Date.now() % 60_000) + 500).unref()
  }
  setTimeout(tick, 60_000 - (Date.now() % 60_000) + 500).unref()
  log(`[scheduler] acceso: ${AUTOMATION_JOBS.length} automazioni, fuso ${timeZone}`)
}
