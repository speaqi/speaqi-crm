/**
 * Allineamento delle schede generate sull'app Speaqi con il CRM.
 *
 * Il giro parte sempre da un'email che sta nel CRM: da quella nasce il link
 * firmato, dal link la landing, dalla landing la demo. Quindi una demo generata
 * ha SEMPRE un contatto a cui appartenere, e una discrepanza fra i due conti e'
 * un errore, non una sfumatura.
 *
 * Il webhook resta la strada normale (l'app avvisa quando succede qualcosa),
 * ma un avviso che non parte non lascia traccia da nessuna parte: qui c'e' la
 * riconciliazione, che parte dall'elenco delle analisi e riporta nel CRM quelle
 * che mancano — la stessa idea di `reconcile-sends` e `reconcile-drafts`.
 *
 * L'elenco puo' arrivare incollato a mano dalla schermata dell'app oppure letto
 * da una sua API: il formato in mezzo e' lo stesso.
 */

import { createActivities, syncPendingCallTask, updateContactSummary } from '@/lib/server/crm'
import { stopWineProjectFollowups } from '@/lib/server/wine-project-automation'
import { toCallableSlot } from '@/lib/sla'

export type DemoRecord = {
  /** Il sito analizzato: e' la chiave con cui si riconosce la cantina. */
  source_url?: string | null
  /** L'email lasciata nel form, quando l'app l'ha raccolta. */
  email?: string | null
  /** La demo pronta, se e' stata generata. */
  demo_url?: string | null
  /** Quando la scheda e' stata compilata (default: adesso). */
  occurred_at?: string | null
  /** Id dell'analisi lato Speaqi: rende la riga idempotente fra un giro e l'altro. */
  external_id?: string | null
  company?: string | null
  phone?: string | null
  results_count?: number | null
}

export type DemoReconcileOutcome = {
  source_url: string | null
  email: string | null
  status: 'created' | 'already_present' | 'unmatched' | 'invalid'
  contact_id?: string
  contact_email?: string
  company?: string | null
  matched_by?: 'external_id' | 'email' | 'site' | 'landing'
  demo_ready?: boolean
  reason?: string
}

/** Quanto prima dell'analisi va cercato il click sulla landing che l'ha generata. */
const LANDING_WINDOW_BEFORE_MS = 90 * 60 * 1000
const LANDING_WINDOW_AFTER_MS = 30 * 60 * 1000

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/

function trimmed(value: unknown, max = 1000) {
  return String(value ?? '').trim().slice(0, max)
}

function normalizedEmail(value: unknown) {
  const email = trimmed(value, 320).toLowerCase()
  return EMAIL_PATTERN.test(email) ? email : null
}

/** L'host del sito, normalizzato: senza schema, con le barre rovesciate, con o senza `www`. */
export function siteHost(value: unknown) {
  const raw = trimmed(value).replace(/\\/g, '/')
  if (!raw) return null
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
    return url.hostname.toLowerCase().replace(/^www\./, '') || null
  } catch {
    return null
  }
}

/** Il dominio registrabile: `shop.alfeu.it` e `alfeu.it` sono la stessa cantina. */
function rootHost(host: string | null) {
  if (!host) return null
  const labels = host.split('.')
  return labels.length > 2 ? labels.slice(-2).join('.') : host
}

/**
 * L'elenco incollato dalla schermata dell'app. Una riga per scheda; della riga
 * servono l'URL del sito e, se c'e', l'email — tutto il resto (stato, numero di
 * pagine, etichette) viene ignorato, cosi' si puo' incollare la tabella intera
 * senza ripulirla. Le righe senza URL ne' email non contano.
 *
 * Formato esplicito quando serve precisione:
 *   https://sito.it, email@cantina.it, 2026-09-11, https://speaqi.com/it/slug
 */
export function parseDemoList(raw: string): DemoRecord[] {
  const records: DemoRecord[] = []
  for (const line of String(raw || '').split(/\r?\n/)) {
    const text = line.trim()
    if (!text) continue
    const urls = text.match(/https?:[\\/]{2}[^\s,;"'<>]+/gi) || []
    const email = (text.match(EMAIL_PATTERN) || [])[0] || null
    if (!urls.length && !email) continue

    // La demo sta su speaqi.com, il sito analizzato e' quello della cantina.
    const demoUrl = urls.find((url) => /speaqi\.com/i.test(url)) || null
    const sourceUrl = urls.find((url) => url !== demoUrl) || null
    if (!sourceUrl && !email) continue

    const date = (text.match(/\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?/) || [])[0] || null
    records.push({
      source_url: sourceUrl,
      email,
      demo_url: demoUrl,
      occurred_at: date ? new Date(date.replace(' ', 'T')).toISOString() : null,
    })
  }
  return records
}

/** Le schede con lo stesso sito (o la stessa email) sono la stessa scheda. */
function dedupe(records: DemoRecord[]) {
  const seen = new Set<string>()
  const unique: DemoRecord[] = []
  for (const record of records) {
    const key = trimmed(record.external_id).toLowerCase() ||
      siteHost(record.source_url) ||
      normalizedEmail(record.email) ||
      ''
    if (key && seen.has(key)) continue
    if (key) seen.add(key)
    unique.push(record)
  }
  return unique
}

type ContactMatch = { contact: any; matchedBy: 'email' | 'site' | 'landing' }

async function findContact(supabase: any, userId: string, record: DemoRecord): Promise<ContactMatch | null> {
  const email = normalizedEmail(record.email)
  if (email) {
    const { data, error } = await supabase
      .from('contacts')
      .select('id,email,company,name,status,email_unsubscribed_at,priority,responsible,assigned_agent')
      .eq('user_id', userId)
      .ilike('email', email)
      .order('created_at', { ascending: false })
      .limit(1)
    if (error) throw error
    if (data?.length) return { contact: data[0], matchedBy: 'email' as const }
  }

  const host = siteHost(record.source_url)
  const candidates = [host, rootHost(host)].filter((value, index, list): value is string =>
    Boolean(value) && list.indexOf(value) === index)
  for (const candidate of candidates) {
    const { data, error } = await supabase
      .from('contacts')
      .select('id,email,company,name,status,email_unsubscribed_at,priority,responsible,assigned_agent')
      .eq('user_id', userId)
      .eq('event_tag', 'wine-project')
      .or(`email.ilike.%@${candidate},normalized_website.ilike.%${candidate}%`)
      .order('updated_at', { ascending: false })
      .limit(1)
    if (error) throw error
    if (data?.length) return { contact: data[0], matchedBy: 'site' as const }
  }
  return null
}

/**
 * L'ultima rete: chi ha aperto la landing poco prima dell'analisi. Il link
 * porta il codice firmato della cantina, quindi il click la identifica anche
 * quando la sua email sta su un dominio diverso dal sito (`alfeu.it` contro
 * `alfeuwinery@gmail.com`). Vale solo se in quella finestra ha cliccato una
 * cantina sola: davanti a due candidate e' meglio lasciare la riga scoperta che
 * attaccare la scheda alla cantina sbagliata.
 */
async function findContactByLandingClick(supabase: any, userId: string, occurredAt: string | null | undefined) {
  if (!occurredAt) return null
  const at = new Date(occurredAt).getTime()
  if (!Number.isFinite(at)) return null

  const { data, error } = await supabase
    .from('activities')
    .select('contact_id, created_at, contacts!inner(id,email,company,name,status,email_unsubscribed_at,priority,event_tag)')
    .eq('user_id', userId)
    .eq('type', 'landing_clicked')
    .eq('contacts.event_tag', 'wine-project')
    .gte('created_at', new Date(at - LANDING_WINDOW_BEFORE_MS).toISOString())
    .lte('created_at', new Date(at + LANDING_WINDOW_AFTER_MS).toISOString())
    .order('created_at', { ascending: false })
    .limit(10)
  if (error) throw error

  const byContact = new Map<string, any>()
  for (const row of data || []) {
    const contact = Array.isArray(row.contacts) ? row.contacts[0] : row.contacts
    if (contact?.id) byContact.set(contact.id, contact)
  }
  if (byContact.size !== 1) return null
  return byContact.values().next().value
}

/** Una scheda gia' registrata non si registra due volte. */
async function existingForm(supabase: any, userId: string, contactId: string, externalId: string | null) {
  let query = supabase
    .from('activities')
    .select('id')
    .eq('user_id', userId)
    .eq('contact_id', contactId)
    .eq('type', 'demo_form_submitted')
    .limit(1)
  if (externalId) query = query.contains('metadata', { external_id: externalId })
  const { data, error } = await query
  if (error) throw error
  return Boolean(data?.length)
}

/**
 * Scrive nel CRM le schede che mancano. Fa esattamente quello che avrebbe fatto
 * il webhook: attivita' datate, sequenza fermata, chiamata in coda — cosi' una
 * scheda recuperata e una arrivata sul momento sono la stessa cosa per il resto
 * del CRM. `dryRun` risponde senza scrivere: si guarda l'esito e poi si decide.
 */
export async function reconcileWineDemos(
  supabase: any,
  userId: string,
  records: DemoRecord[],
  options: { dryRun?: boolean; source?: string } = {},
) {
  const results: DemoReconcileOutcome[] = []
  // Una cantina conta una volta sola per giro: incollando la tabella dell'app
  // l'email e l'URL della stessa riga finiscono su due righe di testo, e senza
  // questo il controllo a vuoto ne annuncerebbe due.
  const handled = new Set<string>()
  for (const record of dedupe(records)) {
    const base = {
      source_url: trimmed(record.source_url) || null,
      email: normalizedEmail(record.email),
    }
    if (!base.source_url && !base.email) {
      results.push({ ...base, status: 'invalid', reason: 'ne sito ne email' })
      continue
    }

    let match: ContactMatch | null = await findContact(supabase, userId, record)
    if (!match) {
      const byLanding = await findContactByLandingClick(supabase, userId, record.occurred_at)
      if (byLanding) match = { contact: byLanding, matchedBy: 'landing' as const }
    }
    if (!match) {
      results.push({
        ...base,
        status: 'unmatched',
        reason: 'nessun contatto con questo dominio: aggiungi l\'email della cantina alla riga',
      })
      continue
    }

    const contact = match.contact
    const externalId = trimmed(record.external_id, 120) || null
    if (handled.has(contact.id) || await existingForm(supabase, userId, contact.id, externalId)) {
      results.push({
        ...base,
        status: 'already_present',
        contact_id: contact.id,
        contact_email: contact.email,
        company: contact.company,
        matched_by: match.matchedBy,
      })
      continue
    }

    const demoUrl = trimmed(record.demo_url) || null
    const occurredAt = record.occurred_at ? new Date(record.occurred_at).toISOString() : new Date().toISOString()
    const metadata = {
      provider: 'speaqi',
      event_type: 'wine_form_submitted',
      reconciled: true,
      reconcile_source: options.source || 'manuale',
      external_id: externalId,
      source_url: base.source_url,
      demo_project_url: demoUrl,
      submitted_email: base.email,
      results_count: record.results_count ?? null,
      matched_by: match.matchedBy,
    }
    const summary = [
      demoUrl
        ? 'Wine Project completato: scheda compilata e demo generata.'
        : 'Wine Project: scheda compilata sul sito della cantina.',
      base.source_url ? `Sito analizzato: ${base.source_url}.` : null,
      demoUrl ? `Demo: ${demoUrl}.` : null,
      'Recuperata dall\'elenco delle analisi Speaqi.',
    ].filter(Boolean).join(' ')

    handled.add(contact.id)
    if (options.dryRun) {
      results.push({
        ...base,
        status: 'created',
        contact_id: contact.id,
        contact_email: contact.email,
        company: contact.company,
        matched_by: match.matchedBy,
        demo_ready: Boolean(demoUrl),
        reason: 'simulazione: niente e stato scritto',
      })
      continue
    }

    await createActivities(supabase, [
      {
        user_id: userId,
        contact_id: contact.id,
        type: 'demo_form_submitted',
        content: 'Wine Project: form compilato con sito, email e telefono.',
        metadata,
        created_at: occurredAt,
      },
      ...(demoUrl ? [{
        user_id: userId,
        contact_id: contact.id,
        type: 'demo_ready',
        content: 'Wine Project: demo pronta e rilanci automatici interrotti.',
        metadata,
        created_at: occurredAt,
      }] : []),
      {
        user_id: userId,
        contact_id: contact.id,
        type: 'wine_demo',
        content: summary,
        metadata,
        created_at: occurredAt,
      },
    ])

    await stopWineProjectFollowups(supabase, userId, contact.id, 'scheda Wine compilata dal prospect')

    const closed = ['Closed', 'Paid', 'Lost'].includes(String(contact.status || ''))
    const unsubscribed = Boolean(contact.email_unsubscribed_at)
    const callDueAt = toCallableSlot(new Date(Date.now() + 24 * 60 * 60 * 1000)).toISOString()
    if (!closed && !unsubscribed) {
      await supabase
        .from('contacts')
        .update({
          status: 'Interested',
          priority: Math.max(3, Number(contact.priority || 0)),
          next_action_at: callDueAt,
          next_followup_at: callDueAt,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId)
        .eq('id', contact.id)
      await syncPendingCallTask(supabase, userId, contact.id, callDueAt, {
        type: 'call',
        priority: 'high',
        note: [
          'Wine Project: scheda compilata, chiamata prioritaria.',
          contact.company ? `Cantina: ${contact.company}.` : null,
          base.source_url ? `Sito: ${base.source_url}.` : null,
          demoUrl ? `Demo: ${demoUrl}` : null,
        ].filter(Boolean).join(' '),
        overwriteNote: true,
      })
    }
    await updateContactSummary(supabase, contact.id, summary, { touchLastContactAt: true })

    results.push({
      ...base,
      status: 'created',
      contact_id: contact.id,
      contact_email: contact.email,
      company: contact.company,
      matched_by: match.matchedBy,
      demo_ready: Boolean(demoUrl),
    })
  }

  const counted = (status: DemoReconcileOutcome['status']) =>
    results.filter((result) => result.status === status).length
  return {
    results,
    summary: {
      received: records.length,
      created: counted('created'),
      already_present: counted('already_present'),
      unmatched: counted('unmatched'),
      invalid: counted('invalid'),
    },
  }
}
