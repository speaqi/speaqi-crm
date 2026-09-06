import {
  isWhatsappNotifyEnabled,
  sendWhatsappText,
  whatsappConfig,
} from '@/lib/server/whatsapp'

/**
 * Il ponte fra i fatti del CRM e il messaggio WhatsApp.
 *
 * Chi genera il fatto (invio email, apertura, click, risposta) chiama solo
 * `recordWhatsappEvent` e non aspetta nulla: l'evento entra in coda su
 * `whatsapp_notification_events`. Da li escono due strade:
 *
 *  - `immediate` (le risposte): un messaggio subito, perche sono poche e sono
 *    l'unica cosa che richiede di rispondere a mano entro pochi minuti;
 *  - `digest` (invii, aperture, click, disiscrizioni): confluiscono nel
 *    riepilogo periodico. Sono decine o centinaia al giorno su una lista da
 *    migliaia di cantine — un messaggio per evento renderebbe il telefono
 *    inutilizzabile e farebbe segnalare il numero come spam.
 *
 * Un evento non notificato resta in coda con `notified_at` null: se il gateway
 * era spento, il riepilogo successivo lo recupera invece di perderlo.
 */

export type WhatsappEventType =
  | 'email_sent'
  | 'email_open'
  | 'email_click'
  | 'email_reply'
  | 'email_unsubscribe'

export type WhatsappEventInput = {
  userId: string
  type: WhatsappEventType
  contactId?: string | null
  contact?: {
    id?: string | null
    name?: string | null
    company?: string | null
    email?: string | null
    responsible?: string | null
    assigned_agent?: string | null
    event_tag?: string | null
    list_name?: string | null
  } | null
  detail?: string | null
  campaign?: string | null
  source?: string | null
  occurredAt?: string | null
}

const IMMEDIATE_EVENTS: WhatsappEventType[] = ['email_reply']
const ALL_EVENTS: WhatsappEventType[] = [
  'email_sent',
  'email_open',
  'email_click',
  'email_reply',
  'email_unsubscribe',
]

const EVENT_LABELS: Record<WhatsappEventType, string> = {
  email_sent: 'email inviate',
  email_open: 'aperture',
  email_click: 'click',
  email_reply: 'risposte',
  email_unsubscribe: 'disiscrizioni',
}

const EVENT_ICONS: Record<WhatsappEventType, string> = {
  email_sent: '📤',
  email_open: '👀',
  email_click: '🖱️',
  email_reply: '💬',
  email_unsubscribe: '🚫',
}

const MAX_NAMES_PER_LINE = 6
const DIGEST_EVENT_LIMIT = 2000

/**
 * `WHATSAPP_NOTIFY_EVENTS` spegne singoli tipi senza toccare il codice: utile
 * quando una campagna genera troppe aperture e si vuole tenere solo i click e
 * le risposte. Vuota o assente significa "tutti".
 */
export function enabledWhatsappEvents(): WhatsappEventType[] {
  const raw = String(process.env.WHATSAPP_NOTIFY_EVENTS || '').trim()
  if (!raw) return ALL_EVENTS
  const wanted = new Set(
    raw.split(',').map((value) => value.trim().toLowerCase()).filter(Boolean)
  )
  const selected = ALL_EVENTS.filter((event) => wanted.has(event))
  return selected.length ? selected : ALL_EVENTS
}

function isEventEnabled(type: WhatsappEventType) {
  return enabledWhatsappEvents().includes(type)
}

export function contactLabel(contact?: WhatsappEventInput['contact']): string {
  if (!contact) return 'Contatto'
  const company = String(contact.company || '').trim()
  const name = String(contact.name || '').trim()
  const email = String(contact.email || '').trim()
  if (company && name && company.toLowerCase() !== name.toLowerCase()) return `${company} (${name})`
  return company || name || email || 'Contatto'
}

function agentName(contact?: WhatsappEventInput['contact']): string | null {
  const value = String(contact?.responsible || contact?.assigned_agent || '').trim()
  return value || null
}

function campaignName(input: WhatsappEventInput): string | null {
  const value = String(
    input.campaign || input.contact?.event_tag || input.contact?.list_name || ''
  ).trim()
  return value || null
}

function contactUrl(contactId?: string | null) {
  const base = String(process.env.APP_BASE_URL || '').trim().replace(/\/+$/, '')
  if (!base || !contactId) return null
  return `${base}/contacts/${contactId}`
}

function truncate(value: string, max: number) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  if (text.length <= max) return text
  return `${text.slice(0, max - 1)}…`
}

/**
 * Mette un fatto in coda e, se e di quelli immediati, prova a mandarlo subito.
 * Non lancia mai: un errore qui non deve rompere l'invio di un'email.
 */
export async function recordWhatsappEvent(supabase: any, input: WhatsappEventInput) {
  try {
    if (!input.userId || !isEventEnabled(input.type)) return
    // Senza gateway configurato non accumuliamo coda: al primo collegamento
    // arriverebbe un riepilogo di eventi vecchi di settimane.
    if (!whatsappConfig() || !isWhatsappNotifyEnabled()) return

    const delivery = IMMEDIATE_EVENTS.includes(input.type) ? 'immediate' : 'digest'
    const row = {
      user_id: input.userId,
      event_type: input.type,
      delivery,
      contact_id: input.contactId || input.contact?.id || null,
      contact_label: contactLabel(input.contact),
      agent_name: agentName(input.contact),
      campaign: campaignName(input),
      detail: input.detail ? truncate(input.detail, 400) : null,
      source: input.source || null,
      occurred_at: input.occurredAt || new Date().toISOString(),
    }

    const { data, error } = await supabase
      .from('whatsapp_notification_events')
      .insert(row)
      .select('id')
      .single()
    if (error) throw error

    if (delivery === 'immediate' && data?.id) {
      await deliverImmediateEvent(supabase, { ...row, id: data.id })
    }
  } catch (error) {
    console.error('whatsapp event not recorded', error)
  }
}

function immediateMessage(event: any) {
  const lines: string[] = []
  const icon = EVENT_ICONS[event.event_type as WhatsappEventType] || '🔔'
  lines.push(`${icon} *Risposta email*`)
  lines.push(event.contact_label || 'Contatto')
  if (event.agent_name) lines.push(`Agente: ${event.agent_name}`)
  if (event.campaign) lines.push(`Campagna: ${event.campaign}`)
  if (event.detail) lines.push(`\n"${truncate(event.detail, 300)}"`)
  const url = contactUrl(event.contact_id)
  if (url) lines.push(`\n${url}`)
  return lines.join('\n')
}

async function deliverImmediateEvent(supabase: any, event: any) {
  const body = immediateMessage(event)
  const result = await sendWhatsappText(body)
  await logWhatsappSend(supabase, event.user_id, {
    kind: 'immediate',
    body,
    eventCount: 1,
    result,
  })
  if (result.ok) {
    await supabase
      .from('whatsapp_notification_events')
      .update({ notified_at: new Date().toISOString() })
      .eq('id', event.id)
  }
}

async function logWhatsappSend(
  supabase: any,
  userId: string,
  input: { kind: string; body: string; eventCount: number; result: { ok: boolean; providerMessageId?: string; error?: string } }
) {
  try {
    await supabase.from('whatsapp_notification_sends').insert({
      user_id: userId,
      kind: input.kind,
      chat_id: whatsappConfig()?.chatId || null,
      body: input.body.slice(0, 4096),
      event_count: input.eventCount,
      ok: input.result.ok,
      provider_message_id: input.result.providerMessageId || null,
      error: input.result.error || null,
    })
  } catch (error) {
    console.error('whatsapp send not logged', error)
  }
}

function formatHourMinute(value: string, timezone: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('it-IT', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

/**
 * Il riepilogo e volutamente compatto: totali per tipo, chi ha lavorato, e i
 * nomi solo per gli eventi che meritano una reazione (click, risposte,
 * disiscrizioni). Elencare centinaia di aperture per nome non aiuta nessuno.
 */
export function buildDigestMessage(events: any[], timezone: string) {
  if (!events.length) return null

  const counts = new Map<WhatsappEventType, number>()
  const byAgent = new Map<string, number>()
  const highlights = new Map<WhatsappEventType, string[]>()

  for (const event of events) {
    const type = event.event_type as WhatsappEventType
    counts.set(type, (counts.get(type) || 0) + 1)
    if (type === 'email_sent' && event.agent_name) {
      byAgent.set(event.agent_name, (byAgent.get(event.agent_name) || 0) + 1)
    }
    if (type === 'email_click' || type === 'email_reply' || type === 'email_unsubscribe') {
      const list = highlights.get(type) || []
      const label = String(event.contact_label || '').trim()
      if (label && !list.includes(label)) list.push(label)
      highlights.set(type, list)
    }
  }

  const sorted = [...events].sort((left, right) =>
    String(left.occurred_at || '').localeCompare(String(right.occurred_at || ''))
  )
  const from = formatHourMinute(sorted[0]?.occurred_at, timezone)
  const to = formatHourMinute(sorted[sorted.length - 1]?.occurred_at, timezone)

  const lines: string[] = []
  lines.push(`📊 *Speaqi CRM* — riepilogo ${from}–${to}`)
  lines.push('')

  for (const type of ALL_EVENTS) {
    const count = counts.get(type)
    if (!count) continue
    lines.push(`${EVENT_ICONS[type]} ${count} ${EVENT_LABELS[type]}`)
  }

  if (byAgent.size) {
    const agents = [...byAgent.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, MAX_NAMES_PER_LINE)
      .map(([name, count]) => `${name} ${count}`)
      .join(' · ')
    lines.push('')
    lines.push(`👤 Invii per agente: ${agents}`)
  }

  for (const type of ['email_reply', 'email_click', 'email_unsubscribe'] as WhatsappEventType[]) {
    const names = highlights.get(type)
    if (!names?.length) continue
    const shown = names.slice(0, MAX_NAMES_PER_LINE).join(', ')
    const rest = names.length > MAX_NAMES_PER_LINE ? ` +${names.length - MAX_NAMES_PER_LINE}` : ''
    lines.push('')
    lines.push(`${EVENT_ICONS[type]} ${EVENT_LABELS[type]}: ${shown}${rest}`)
  }

  const base = String(process.env.APP_BASE_URL || '').trim().replace(/\/+$/, '')
  if (base) {
    lines.push('')
    lines.push(`${base}/dashboard`)
  }

  return lines.join('\n')
}

export type WhatsappDigestResult = {
  ok: boolean
  pending: number
  sent: boolean
  dry_run: boolean
  message?: string | null
  error?: string
}

/**
 * Svuota la coda in un solo messaggio. Chiamato dal cron n8n e dal pulsante di
 * prova in impostazioni. Marca `notified_at` solo dopo un invio riuscito.
 */
export async function runWhatsappDigest(
  supabase: any,
  userId: string,
  options?: { dryRun?: boolean; timezone?: string; limit?: number }
): Promise<WhatsappDigestResult> {
  const dryRun = options?.dryRun === true
  const timezone = options?.timezone || process.env.AUTOMATION_TIMEZONE || 'Europe/Rome'
  const limit = Math.min(DIGEST_EVENT_LIMIT, Math.max(1, Number(options?.limit) || DIGEST_EVENT_LIMIT))

  const { data: events, error } = await supabase
    .from('whatsapp_notification_events')
    .select('*')
    .eq('user_id', userId)
    .is('notified_at', null)
    .order('occurred_at', { ascending: true })
    .limit(limit)
  if (error) throw error

  const pending = events?.length || 0
  if (!pending) return { ok: true, pending: 0, sent: false, dry_run: dryRun, message: null }

  const message = buildDigestMessage(events, timezone)
  if (!message) return { ok: true, pending, sent: false, dry_run: dryRun, message: null }
  if (dryRun) return { ok: true, pending, sent: false, dry_run: true, message }

  const result = await sendWhatsappText(message)
  await logWhatsappSend(supabase, userId, {
    kind: 'digest',
    body: message,
    eventCount: pending,
    result,
  })

  if (!result.ok) {
    return { ok: false, pending, sent: false, dry_run: false, message, error: result.error }
  }

  const { error: updateError } = await supabase
    .from('whatsapp_notification_events')
    .update({ notified_at: new Date().toISOString() })
    .in('id', events.map((event: any) => event.id))
  if (updateError) throw updateError

  return { ok: true, pending, sent: true, dry_run: false, message }
}
