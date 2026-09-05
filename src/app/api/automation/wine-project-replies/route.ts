import { NextRequest } from 'next/server'
import { validateAutomationSecret } from '@/lib/server/automation-auth'
import { syncContactGmailMessages } from '@/lib/server/gmail'
import { errorMessage } from '@/lib/server/http'
import { createServiceRoleClient } from '@/lib/server/supabase'

const DEFAULT_BATCH = 100
const PAGE = 1000
const ID_CHUNK = 100

type WineContactRow = { id: string; user_id: string; email: string | null; [key: string]: unknown }

/** Legge a pagine: PostgREST tronca a 1000 righe senza dirlo. */
async function readAll<T>(build: (from: number, to: number) => any) {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1)
    if (error) throw error
    rows.push(...((data || []) as T[]))
    if (!data || data.length < PAGE) return rows
  }
}

function chunks<T>(items: T[], size: number) {
  const out: T[][] = []
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size))
  return out
}

/**
 * Contatti da sincronizzare: solo quelli dentro la sequenza, dal piu' vecchio
 * per data di sincronizzazione.
 *
 * Il bacino Wine e' di migliaia di cantine, ma una risposta non vista fa danno
 * soltanto a chi ha ancora email in canna: e' li' che si finisce per riscrivere
 * a chi ha gia' detto no. Prima la rotta prendeva 100 righe del bacino senza
 * alcun ordinamento, quindi ripescava sempre le stesse e la sequenza non veniva
 * coperta. L'ordine per ultima sincronizzazione fa ruotare il giro da solo,
 * senza cursori da mantenere fra un'esecuzione e l'altra.
 */
async function selectContactsToSync(supabase: any, batch: number) {
  const events = await readAll<{ contact_id: string }>((from, to) =>
    supabase
      .from('wine_project_followup_events')
      .select('contact_id')
      .in('status', ['scheduled', 'queued', 'sending', 'sent'])
      .order('contact_id', { ascending: true })
      .range(from, to)
  )
  const enrolledIds = [...new Set(events.map((event) => String(event.contact_id)).filter(Boolean))]
  if (!enrolledIds.length) return []

  const contacts: WineContactRow[] = []
  for (const group of chunks(enrolledIds, ID_CHUNK)) {
    const { data, error } = await supabase
      .from('contacts')
      .select('*')
      .in('id', group)
      .is('email_unsubscribed_at', null)
      .not('status', 'in', '(Closed,Paid,Lost)')
      .not('email', 'is', null)
    if (error) throw error
    contacts.push(...((data || []) as WineContactRow[]))
  }
  if (!contacts.length) return []

  const lastSync = new Map<string, number>()
  for (const group of chunks(contacts.map((contact) => contact.id), ID_CHUNK)) {
    const { data, error } = await supabase
      .from('gmail_messages')
      .select('contact_id, synced_at')
      .in('contact_id', group)
    if (error) throw error
    for (const message of data || []) {
      const id = String(message.contact_id || '')
      if (!id) continue
      const at = new Date(message.synced_at || 0).getTime()
      if (at > (lastSync.get(id) ?? 0)) lastSync.set(id, at)
    }
  }

  return contacts
    .sort((left, right) => (lastSync.get(left.id) ?? 0) - (lastSync.get(right.id) ?? 0))
    .slice(0, batch)
}

export async function POST(request: NextRequest) {
  if (!validateAutomationSecret(request)) return Response.json({ error: 'Unauthorized automation' }, { status: 401 })
  try {
    const body = await request.json().catch(() => ({}))
    const requested = Number(body?.limit)
    const batch = Number.isInteger(requested) && requested > 0 && requested <= 500 ? requested : DEFAULT_BATCH

    const supabase = createServiceRoleClient()
    const contacts = await selectContactsToSync(supabase, batch)

    let synced = 0
    let failures = 0
    for (const contact of contacts) {
      try {
        const result = await syncContactGmailMessages(supabase, contact.user_id, contact as any, 20)
        synced += result.synced
      } catch {
        failures += 1
      }
    }
    return Response.json({ ok: failures === 0, checked: contacts.length, messages_synced: synced, failures })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Wine Project reply sync failed') }, { status: 500 })
  }
}
