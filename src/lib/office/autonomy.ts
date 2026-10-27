/**
 * Fiducia per tipo di azione: cosa l'Ufficio può approvare da solo e cosa resta al titolare.
 *
 * La regola è una sola: si approva da sé ciò che resta dentro il CRM e si può rimettere a
 * posto (accodare un lavoro a un agente con il suo budget, creare un To Do, portare un ente
 * verificato nel CRM, inserire un contatto senza doppioni). Resta al clic ciò che esce
 * (email), che nasconde dati (unione contatti) o che spende fuori dal budget dell'agente.
 * Puro e testato: niente rete, niente database.
 */

type OutputLike = { agent_id: string; kind: string; body: Record<string, any> | null; created_at?: string }

/**
 * - `auto`: si approva da sola dopo il ritardo di sicurezza, se non la rifiuti prima;
 * - `safe`: la approva «Approva le sicure» (avvisi da archiviare, bozze di post, segnalazioni);
 * - `send`: una bozza email: si decide con «Approva e invia»;
 * - `manual`: solo con un clic, una per una.
 */
export type OutputTrust = 'auto' | 'safe' | 'send' | 'manual'

export const DIRECTOR_QUEUE_ACTIONS = ['build_map', 'publication_review', 'complete_languages']

const isNotice = (output: OutputLike) => output.kind === 'report' && (output.body?.action === undefined || output.body?.action === null)

export function outputTrust(output: OutputLike): OutputTrust {
  const body = output.body || {}
  const action = typeof body.action === 'string' ? body.action : null
  if (output.kind === 'draft_email') return typeof body.email_draft_id === 'string' ? 'send' : 'manual'
  // Esce dal CRM in modo non reversibile o nasconde dati: sempre a mano.
  if (action === 'merge_contacts' || action === 'refresh_outdated') return 'manual'
  if (output.agent_id === 'director' && output.kind === 'proposal') {
    if (action === 'create_contact') {
      const doubles = Array.isArray(body.possibili_doppioni) ? body.possibili_doppioni.length : 0
      return doubles === 0 ? 'auto' : 'manual'
    }
    return action && DIRECTOR_QUEUE_ACTIONS.includes(action) ? 'auto' : 'manual'
  }
  if (output.agent_id === 'events_scout' && output.kind === 'task' && action === 'decide_event_participation') return 'auto'
  if (output.agent_id === 'entity_enricher' && output.kind === 'proposal' && action === 'enrich_entity') return 'auto'
  if (isNotice(output)) return 'safe'
  // Approvare queste registra solo la decisione: nessun effetto fuori dalla coda.
  if (output.kind === 'draft_post' || (output.kind === 'data_fix' && !action)) return 'safe'
  return 'manual'
}

export type AutonomySettings = {
  /** Approvazione automatica delle `auto`. */
  enabled: boolean
  /** Minuti fra la nascita della proposta e l'approvazione automatica: il tempo per rifiutarla. */
  delayMinutes: number
  /** Agenti le cui proposte restano sempre al clic. */
  agentsOff: string[]
  /** Le proposte da decidere arrivano su Telegram con i pulsanti, appena nascono. */
  telegram: boolean
}

export const DEFAULT_AUTONOMY: AutonomySettings = { enabled: true, delayMinutes: 30, agentsOff: [], telegram: true }

/** Dalle impostazioni del Direttore (`settings.autonomy`); un valore storto prende il predefinito. */
export function autonomySettings(raw: unknown, env: string | undefined = process.env.OFFICE_AUTO_APPROVE): AutonomySettings {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const delay = Number(value.delay_minutes)
  const settings: AutonomySettings = {
    enabled: value.enabled === false ? false : true,
    delayMinutes: Number.isFinite(delay) && delay >= 0 ? Math.min(1440, Math.round(delay)) : DEFAULT_AUTONOMY.delayMinutes,
    agentsOff: Array.isArray(value.agents_off) ? value.agents_off.filter((a): a is string => typeof a === 'string').slice(0, 30) : [],
    telegram: value.telegram === false ? false : true,
  }
  // Il freno di emergenza delle env vince su tutto.
  if (String(env || '').trim().toLowerCase() === 'false') settings.enabled = false
  return settings
}

/** Le `auto` mature: abbastanza vecchie e di un agente che non ha chiesto il clic. */
export function dueForAutoApproval<T extends OutputLike>(outputs: T[], settings: AutonomySettings, now: Date, agentOptOut: (agentId: string) => boolean = () => false): T[] {
  if (!settings.enabled) return []
  const limit = now.getTime() - settings.delayMinutes * 60_000
  return outputs.filter((output) => outputTrust(output) === 'auto'
    && !settings.agentsOff.includes(output.agent_id) && !agentOptOut(output.agent_id)
    && (!output.created_at || new Date(output.created_at).getTime() <= limit))
}

export type QueueCounts = { auto: number; safe: number; send: number; manual: number; total: number }

export function queueCounts(outputs: OutputLike[]): QueueCounts {
  const counts: QueueCounts = { auto: 0, safe: 0, send: 0, manual: 0, total: outputs.length }
  for (const output of outputs) counts[outputTrust(output)]++
  return counts
}

/** Il riepilogo di /coda: quante, di che tipo, e cosa fanno i pulsanti. */
export function queueSummaryText(counts: QueueCounts, settings: AutonomySettings): string {
  if (!counts.total) return 'In coda non c’è niente da decidere. 👌'
  const lines = [`*In coda: ${counts.total}*`]
  if (counts.send) lines.push(`📨 ${counts.send} email pronte: le vedi una per una con «Approva e invia».`)
  if (counts.manual) lines.push(`✋ ${counts.manual} da decidere a mano (unioni, doppioni, spese).`)
  if (counts.auto) lines.push(settings.enabled
    ? `⏱ ${counts.auto} si approvano da sole fra al massimo ${settings.delayMinutes} minuti, se non le rifiuti.`
    : `⏱ ${counts.auto} sicure (l’approvazione automatica è spenta).`)
  if (counts.safe) lines.push(`🗂 ${counts.safe} avvisi e segnalazioni da archiviare.`)
  return lines.join('\n')
}

const firstLines = (text: string, max = 700) => {
  const clean = text.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim()
  return clean.length > max ? `${clean.slice(0, max).replace(/\s+\S*$/, '')}…` : clean
}

/** Una bozza email su Telegram: a chi, l'oggetto, l'inizio del testo e perché. */
export function draftEmailText(input: { title: string; to: string; subject: string; body: string; reason?: string | null }): string {
  return [
    `*${input.title.slice(0, 200)}*`,
    `A: ${input.to}`,
    `Oggetto: ${input.subject.slice(0, 200)}`,
    '',
    firstLines(input.body),
    input.reason ? `\nPerché: ${String(input.reason).slice(0, 300)}` : '',
  ].filter((line) => line !== null).join('\n').slice(0, 3500)
}

/** Un incertezza dopo l'invio non si ritenta: forse è già partita. */
export function sendErrorIsBeforeSend(message: string): boolean {
  return /gmail non collegato|indirizzo email|non ha un indirizzo|invalid_grant|token|refresh|unauthorized|401|403|scope/i.test(message)
}

/** Il giorno italiano di un istante, AAAA-MM-GG, per il tetto giornaliero degli invii. */
export function romeDayStart(now: Date): string {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  // Mezzanotte di Roma in UTC: si prova l'offset delle due ore possibili.
  for (const offset of ['+02:00', '+01:00']) {
    const candidate = new Date(`${day}T00:00:00${offset}`)
    const back = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).format(candidate)
    if (back.startsWith(day) && /\b00$/.test(back)) return candidate.toISOString()
  }
  return new Date(`${day}T00:00:00+01:00`).toISOString()
}

export const OFFICE_SEND_DAILY_CAP_DEFAULT = 30

export function officeSendDailyCap(env: string | undefined = process.env.OFFICE_SEND_DAILY_CAP): number {
  const value = Number(env)
  return Number.isFinite(value) && value >= 0 ? Math.min(500, Math.floor(value)) : OFFICE_SEND_DAILY_CAP_DEFAULT
}
