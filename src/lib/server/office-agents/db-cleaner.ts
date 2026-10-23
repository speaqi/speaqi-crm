import { createHash } from 'node:crypto'
import type { AgentHandler } from '../office-agents'
import { createServiceRoleClient } from '../supabase'
import { batchGroups, connectDuplicates, groupKey, planDuplicateGroup, type CleanerContact, type DuplicateGroup, type DuplicateKeyRow } from '@/lib/office/db-cleaner'
import { addOfficeOutputOnce } from './shared'

/** Un gruppo rifiutato non si ripropone per tre mesi: qualcuno ha guardato e ha detto no. */
const REJECTED_MEMORY_DAYS = 90

const SCAN_LABELS: Record<string, string> = {
  invalid_emails: 'Email scritte male',
  role_emails: 'Indirizzi noreply / mailer-daemon',
  pec_emails: 'Indirizzi PEC usati come email commerciale',
  stale_pipeline: 'In pipeline da oltre 90 giorni senza attività né prossimo passo',
  old_draft_quotes: 'Preventivi in bozza da oltre 60 giorni',
  open_deals_on_closed: 'Trattative aperte su contatti chiusi',
  tourism_near_duplicates: 'Enti di Tourism Intelligence con nomi quasi uguali',
}

function contactLine(c: CleanerContact) {
  return { id: c.id, nome: c.company || c.name, email: c.email, telefono: c.phone, citta: c.billing_city, stato: c.status, lista: c.contact_scope,
    storia: { attivita: c.activities, task: c.tasks, trattative: c.deals, preventivi: c.quotes, email: c.emails } }
}

function groupBody(g: DuplicateGroup) {
  return { keep: g.keep, drop: g.drop, key: groupKey(g), coincidono: g.matched, motivo: g.reason, contatti: g.contacts.map(contactLine) }
}

/** Gruppi gia' proposti: in attesa (non si duplicano) o rifiutati di recente (non si insiste). */
async function knownGroupKeys(admin: any, userId: string, now: Date) {
  const since = new Date(now.getTime() - REJECTED_MEMORY_DAYS * 86_400_000).toISOString()
  const { data, error } = await admin.from('office_agent_outputs').select('status,body,created_at').eq('user_id', userId)
    .eq('agent_id', 'db_cleaner').eq('kind', 'data_fix').in('status', ['pending', 'rejected']).gte('created_at', since).limit(1000)
  if (error) throw error
  const keys = new Set<string>()
  for (const row of data || []) for (const g of (row.body?.groups as Array<{ key?: string }>) || []) if (g?.key) keys.add(g.key)
  return keys
}

export function dbCleanerHandler(admin: any, now: () => Date = () => new Date()): AgentHandler {
  return async (ctx) => {
    const userId = ctx.agent.user_id
    const today = now()
    const day = today.toISOString().slice(0, 10)
    const keys = await admin.rpc('office_cleaner_duplicate_keys', { p_user_id: userId, p_limit: 3000 })
    if (keys.error) throw keys.error
    const rows = (keys.data || []) as DuplicateKeyRow[]
    const connected = connectDuplicates(rows)
    const ids = [...new Set(connected.flatMap((g) => g.ids))]
    const contacts: CleanerContact[] = []
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = await admin.rpc('office_cleaner_contacts', { p_user_id: userId, p_ids: ids.slice(i, i + 200) })
      if (chunk.error) throw chunk.error
      contacts.push(...(chunk.data || []).map((c: any) => ({ ...c,
        activities: Number(c.activities), tasks: Number(c.tasks), deals: Number(c.deals), open_deals: Number(c.open_deals),
        quotes: Number(c.quotes), drafts: Number(c.drafts), emails: Number(c.emails) })))
    }
    const byId = new Map(contacts.map((c) => [c.id, c]))
    const known = await knownGroupKeys(admin, userId, today)
    const groups = connected.map((g) => planDuplicateGroup(g.ids, g.matched, byId)).filter((g): g is DuplicateGroup => Boolean(g))
    const fresh = groups.filter((g) => !known.has(groupKey(g)))
    const { batches, review, blocked } = batchGroups(fresh)
    ctx.log(`${rows.length} chiavi doppie, ${groups.length} gruppi, ${fresh.length} nuovi, ${blocked.length} bloccati`)

    let proposals = 0
    for (const batch of batches) {
      const hash = createHash('sha256').update(batch.map(groupKey).sort().join(',')).digest('hex').slice(0, 20)
      const contactsMerged = batch.reduce((sum, g) => sum + g.drop.length, 0)
      const { created } = await addOfficeOutputOnce(admin, ctx, `cleaner:batch:${hash}`, { kind: 'data_fix',
        title: `Unire ${batch.length} gruppi di doppioni (${contactsMerged} schede)`,
        body: { action: 'merge_contacts', reason: 'Doppioni con stessa email o stesso telefono, fuori pipeline e senza trattative né preventivi.',
          effetto: 'Approvando, attività, task, email e legami passano al contatto tenuto; i doppioni restano nascosti con una nota. Nessuna cancellazione.',
          groups: batch.map(groupBody) } })
      if (created) proposals++
    }
    for (const g of review) {
      const name = g.contacts.find((c) => c.id === g.keep)
      const { created } = await addOfficeOutputOnce(admin, ctx, `cleaner:group:${groupKey(g)}`, { kind: 'data_fix',
        title: `Doppione da controllare: ${name?.company || name?.name || g.keep}`,
        body: { action: 'merge_contacts', reason: g.reason,
          effetto: 'Controllare le schede prima di approvare: almeno una è in pipeline, ha trattative o preventivi, o coincide solo per azienda e città.',
          groups: [groupBody(g)] }, target_table: 'contacts', target_id: g.keep })
      if (created) proposals++
    }

    const scan = await admin.rpc('office_cleaner_scan', { p_user_id: userId })
    if (scan.error) throw scan.error
    const findings = (scan.data || {}) as Record<string, { count: number; sample: unknown[] }>
    for (const [category, value] of Object.entries(findings)) {
      if (!value?.count) continue
      const hash = createHash('sha256').update(JSON.stringify(value.sample)).digest('hex').slice(0, 16)
      await addOfficeOutputOnce(admin, ctx, `cleaner:list:${category}:${hash}`, { kind: 'data_fix',
        title: `${SCAN_LABELS[category] || category}: ${value.count}`,
        body: { action: 'review_list', category, count: value.count, sample: value.sample,
          nota: 'Elenco da rivedere a mano: approvare segna solo che è stato visto, non cambia nessun dato.' } })
    }

    await addOfficeOutputOnce(admin, ctx, `cleaner:report:${day}`, { kind: 'report', title: `Pulizia database — ${day}`,
      body: {
        doppioni: { gruppi: groups.length, nuovi: fresh.length, lotti_sicuri: batches.length, gruppi_sicuri: batches.reduce((s, b) => s + b.length, 0),
          da_controllare: review.length, gia_proposti_o_rifiutati: groups.length - fresh.length,
          bloccati: blocked.map((g) => ({ keep: g.keep, drop: g.drop, motivo: g.blocked })) },
        altri_controlli: Object.fromEntries(Object.entries(findings).map(([k, v]) => [SCAN_LABELS[k] || k, v?.count ?? 0])),
        nota: 'Nessun dato è stato modificato: le unioni partono solo approvando le proposte, e non cancellano niente.',
      } })
    return { summary: `${groups.length} gruppi di doppioni (${fresh.length} nuovi): ${proposals} proposte di unione, ${blocked.length} da fare a mano` }
  }
}

export const runDbCleaner: AgentHandler = (ctx) => dbCleanerHandler(createServiceRoleClient())(ctx)
