import { isClosedStatus } from '../data'
import { nextFollowupAfterEmail } from '../sla'
import { officeRomeDay } from './finance'
import type { CRMContact, Deal, Quote, Task } from '@/types'

export type SalesMessage = { contact_id?: string | null; direction: string; sent_at?: string | null; created_at?: string; from_email?: string | null; to_emails?: string[] }
export type SalesSignature = { quote_id: string; signed_at: string }
export type SalesCandidate = { contact: CRMContact; key: string; reason: 'unsigned' | 'unpaid' | 'renewal' | 'followup' | 'stale_deal'; note: string; value: number; latestOutbound: string | null; quoteId?: string; dealId?: string }
export const SALES_DAILY_CAP = 15
export const SALES_AGENT_OWNER = 'agent:sales_followup'
const time = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null
const ago = (value: string, now: Date) => Math.floor((now.getTime() - Date.parse(value)) / 86400_000)
export const salesEmailKey = (value: string | null | undefined) => String(value || '').trim().toLowerCase()

/** La graduatoria e le esclusioni vengono dal codice, non dal modello. */
export function selectSalesCandidates(input: { contacts: CRMContact[]; quotes: Quote[]; deals: Deal[]; tasks: Task[]; messages: SalesMessage[];
  signatures: SalesSignature[]; pendingContactIds: string[]; existingKeys?: string[]; createdToday?: number }, now = new Date()): SalesCandidate[] {
  const pending = new Set(input.pendingContactIds)
  const pendingEmails = new Set(input.contacts.filter((c) => pending.has(c.id)).map((c) => salesEmailKey(c.email)))
  const keys = new Set(input.existingKeys || [])
  const signed = new Map(input.signatures.map((s) => [s.quote_id, s.signed_at]))
  const quoteGroups = new Map<string, Quote[]>(); const dealGroups = new Map<string, Deal[]>(); const taskGroups = new Map<string, Task[]>()
  for (const q of input.quotes) if (q.contact_id && q.status !== 'cancelled') quoteGroups.set(q.contact_id, [...(quoteGroups.get(q.contact_id) || []), q])
  for (const d of input.deals) if (!d.closed_at) dealGroups.set(d.contact_id, [...(dealGroups.get(d.contact_id) || []), d])
  for (const t of input.tasks) if (t.contact_id && t.status === 'pending') taskGroups.set(t.contact_id, [...(taskGroups.get(t.contact_id) || []), t])
  const messages = new Map<string, SalesMessage[]>()
  for (const m of input.messages) if (m.contact_id) messages.set(m.contact_id, [...(messages.get(m.contact_id) || []), m])
  const today = officeRomeDay(now)
  const candidates: SalesCandidate[] = []
  for (const c of input.contacts) {
    // Un solo responsabile per comunicazione: un'opportunità affidata ad altri non riceve bozze da qui.
    if ((dealGroups.get(c.id) || []).some((d) => d.owner && d.owner !== SALES_AGENT_OWNER)) continue
    if ((c.contact_scope || 'crm') !== 'crm' || c.hidden || c.email_unsubscribed_at || !salesEmailKey(c.email) || pending.has(c.id) || pendingEmails.has(salesEmailKey(c.email))) continue
    const history = messages.get(c.id) || []
    const outbound = history.filter((m) => m.direction === 'outbound' && time(m.sent_at)).sort((a,b) => time(b.sent_at)! - time(a.sent_at)!)[0]?.sent_at || null
    if (history.some((m) => m.direction === 'inbound' && time(m.sent_at) !== null && (!outbound || time(m.sent_at)! > time(outbound)!))) continue
    const quotes = quoteGroups.get(c.id) || []
    const value = Math.max(0, ...quotes.map((q) => Number(q.total_amount) || 0), ...(dealGroups.get(c.id) || []).map((d) => Number(d.value) || 0))
    const options: SalesCandidate[] = []
    for (const q of quotes) {
      const stamp = signed.get(q.id)
      const paid = q.status === 'paid' || q.payment_state === 'paid'
      if (!isClosedStatus(c.status) && !paid && !stamp && q.status === 'sent' && time(q.sent_at) !== null && time(q.sent_at)! < now.getTime() - 5 * 86400_000) {
        options.push({ contact: c, reason: 'unsigned', value, quoteId: q.id, latestOutbound: outbound, key: `sales:unsigned:${q.id}:${q.sent_at}`, note: `Preventivo ${q.quote_number} inviato ${ago(q.sent_at!, now)} giorni fa, non firmato.` })
      }
      if (!isClosedStatus(c.status) && !paid && stamp && time(stamp) !== null && time(stamp)! < now.getTime() - 3 * 86400_000) {
        options.push({ contact: c, reason: 'unpaid', value, quoteId: q.id, latestOutbound: outbound, key: `sales:unpaid:${q.id}:${stamp}`, note: `Preventivo ${q.quote_number} firmato ${ago(stamp, now)} giorni fa, pagamento non registrato.` })
      }
      if (q.billing_interval === 'year' && !q.cancel_at_period_end && q.subscription_status !== 'canceled' && time(q.current_period_end) !== null
        && time(q.current_period_end)! >= now.getTime() && time(q.current_period_end)! <= now.getTime() + 30 * 86400_000) {
        options.push({ contact: c, reason: 'renewal', value, quoteId: q.id, latestOutbound: outbound, key: `sales:renewal:${q.id}:${q.current_period_end}`, note: `Cortesia per il rinnovo di ${q.quote_number} previsto il ${officeRomeDay(new Date(q.current_period_end!))}.` })
      }
    }
    if (!isClosedStatus(c.status)) {
      const due = [c.next_followup_at, c.next_action_at, ...(taskGroups.get(c.id) || []).map((t) => t.due_date)].filter((v): v is string => time(v) !== null).sort()[0]
        || (outbound ? nextFollowupAfterEmail(c.status, new Date(outbound)).toISOString() : null)
      if (due && officeRomeDay(new Date(due)) <= today) options.push({ contact: c, reason: 'followup', value, latestOutbound: outbound,
        key: `sales:followup:${c.id}:${due}`, note: `Follow-up del ${officeRomeDay(new Date(due))}, da preparare oggi secondo il prossimo passo registrato o lo SLA.` })
      for (const d of dealGroups.get(c.id) || []) if (time(d.updated_at) !== null && time(d.updated_at)! < now.getTime() - 14 * 86400_000) options.push({ contact: c, reason: 'stale_deal', value, dealId: d.id, latestOutbound: outbound,
        key: `sales:deal:${d.id}:${d.updated_at}`, note: `Trattativa «${d.title}» ferma da ${ago(d.updated_at, now)} giorni.` })
    }
    const chosen = options.find((o) => !keys.has(o.key))
    if (chosen) candidates.push(chosen)
  }
  const seen = new Set<string>()
  return candidates.sort((a,b) => b.value-a.value || a.key.localeCompare(b.key)).filter((c) => {
    const email = salesEmailKey(c.contact.email)
    if (seen.has(email)) return false
    seen.add(email); return true
  }).slice(0, Math.max(0, SALES_DAILY_CAP - (input.createdToday || 0)))
}

/** Controllo conservativo dei numeri: i testi sono bozze, ma un valore senza
 * riscontro nei dati o nelle condizioni Speaqi non arriva alla coda.
 */
export function salesDraftNumbersAllowed(text: string, sources: string) {
  const numbers = (s: string) => (s.replace(/https?:\/\/\S+/g, '').match(/\d+(?:[.,]\d+)*/g) || []).map((n) => String(Number(/^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(n) ? n.replace(/\./g, '').replace(',', '.') : n.replace(',', '.'))))
  const allowed = new Set(numbers(sources))
  return numbers(text).every((number) => allowed.has(number))
}
