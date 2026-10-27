import {
  autonomySettings, draftEmailText, dueForAutoApproval, outputTrust, queueCounts, queueSummaryText,
  type AutonomySettings, type QueueCounts,
} from '../office/autonomy'
import { draftEmailKeyboard, proposalLines, proposalMessage, queueKeyboard, type QueueView } from '../office/telegram-actions'
import { decideOfficeOutput } from './office-output-decision'
import { sendTelegramButtons, telegramDeliveryConfig } from './whatsapp'
import { errorMessage } from './http'

type Admin = any
type Output = { id: string; agent_id: string; kind: string; title: string; body: Record<string, any>; status: string; created_at: string; target_table: string | null; target_id: string | null }

const baseUrl = () => (process.env.APP_BASE_URL || 'https://crm.speaqi.com').replace(/\/$/, '')
const OUTPUT_FIELDS = 'id,agent_id,kind,title,body,status,created_at,target_table,target_id'
/** Una corsa del giro guarda al massimo queste: la coda normale ne ha poche decine. */
const SCAN_LIMIT = 200
/** Messaggi Telegram per giro: oltre si rimanda a /coda, per non sommergere la chat. */
const TELEGRAM_PER_RUN = 8

async function loadPending(admin: Admin, userId: string, limit = SCAN_LIMIT): Promise<Output[]> {
  const { data, error } = await admin.from('office_agent_outputs').select(OUTPUT_FIELDS).eq('user_id', userId).eq('status', 'pending')
    .order('created_at', { ascending: true }).limit(limit)
  if (error) throw error
  return (data || []) as Output[]
}

/** Impostazioni dal Direttore (`settings.autonomy`) e agenti che hanno chiesto il clic (`settings.auto_approve: false`). */
export async function loadAutonomy(admin: Admin, userId: string): Promise<{ settings: AutonomySettings; optOut: Set<string> }> {
  const { data, error } = await admin.from('office_agents').select('id,settings').eq('user_id', userId)
  if (error) throw error
  const rows = (data || []) as Array<{ id: string; settings: Record<string, any> | null }>
  const director = rows.find((row) => row.id === 'director')
  return {
    settings: autonomySettings(director?.settings?.autonomy),
    optOut: new Set(rows.filter((row) => row.settings?.auto_approve === false).map((row) => row.id)),
  }
}

async function markNotified(admin: Admin, userId: string, output: Output) {
  await admin.from('office_agent_outputs').update({ body: { ...output.body, telegram_sent_at: new Date().toISOString() } })
    .eq('id', output.id).eq('user_id', userId).eq('status', 'pending')
}

/** Una bozza email su Telegram con «Approva e invia». */
async function sendDraftCard(admin: Admin, userId: string, output: Output) {
  const draftId = typeof output.body?.email_draft_id === 'string' ? output.body.email_draft_id : output.target_id
  const { data: draft } = await admin.from('email_drafts').select('id,subject,body_text,status,contact_id').eq('id', draftId).eq('user_id', userId).maybeSingle()
  if (!draft || draft.status !== 'pending') return false
  const { data: contact } = await admin.from('contacts').select('name,company,email').eq('id', draft.contact_id).eq('user_id', userId).maybeSingle()
  const to = contact ? [contact.name || contact.company, contact.email ? `<${contact.email}>` : 'senza email'].filter(Boolean).join(' ') : 'contatto non trovato'
  const text = draftEmailText({ title: output.title, to, subject: draft.subject || '', body: draft.body_text || '', reason: output.body?.motivo || output.body?.note })
  const sent = await sendTelegramButtons(text, draftEmailKeyboard({ id: output.id, editLink: `${baseUrl()}/email` }))
  if (!sent.ok) console.error('[autonomy] bozza non inviata su Telegram:', sent.error)
  return sent.ok
}

async function sendDecisionCard(output: Output) {
  const lines = proposalLines(output.body)
  const message = proposalMessage({ id: output.id, title: output.title, lines, link: `${baseUrl()}/ufficio?uscita=${output.id}` })
  const sent = await sendTelegramButtons(message.text, message.keyboard)
  if (!sent.ok) console.error('[autonomy] proposta non inviata su Telegram:', sent.error)
  return sent.ok
}

export type AutonomyRun = { approved: string[]; failed: Array<{ id: string; error: string }>; notified: number; pending: QueueCounts; enabled: boolean }

/**
 * Il giro dell'autonomia (job `office-autonomy`, ogni 10 minuti):
 * 1. approva le proposte `auto` più vecchie del ritardo di sicurezza, con la stessa decisione
 *    del clic (stesse transazioni, stessi controlli);
 * 2. manda su Telegram, una volta sola, le bozze email e le decisioni appena nate, con i pulsanti;
 * 3. dice in un messaggio cosa ha approvato da solo.
 * Una voce che fallisce resta in coda col motivo e non ferma le altre.
 */
export async function runOfficeAutonomy(admin: Admin, userId: string, now = new Date()): Promise<AutonomyRun> {
  const { settings, optOut } = await loadAutonomy(admin, userId)
  const pending = await loadPending(admin, userId)
  const approved: string[] = []
  const approvedIds = new Set<string>()
  const failed: Array<{ id: string; error: string }> = []
  for (const output of dueForAutoApproval(pending, settings, now, (agent) => optOut.has(agent))) {
    try {
      const result = await decideOfficeOutput(admin, userId, output.id, 'approved')
      if (result.ok) { approved.push(output.title); approvedIds.add(output.id) }
      else failed.push({ id: output.id, error: result.error })
    } catch (error) {
      failed.push({ id: output.id, error: errorMessage(error, 'decisione non riuscita') })
    }
  }

  let notified = 0
  const telegram = settings.telegram && !!telegramDeliveryConfig()
  if (telegram) {
    const fresh = pending.filter((o) => !o.body?.telegram_sent_at && !approvedIds.has(o.id)
      && ['send', 'manual'].includes(outputTrust(o)) && now.getTime() - new Date(o.created_at).getTime() < 3 * 86_400_000)
    for (const output of fresh.slice(0, TELEGRAM_PER_RUN)) {
      try {
        const ok = outputTrust(output) === 'send' ? await sendDraftCard(admin, userId, output) : await sendDecisionCard(output)
        if (ok) { notified++; await markNotified(admin, userId, output) }
      } catch (error) {
        console.error('[autonomy] invio Telegram non riuscito', { output: output.id, message: errorMessage(error, '') })
      }
    }
    if (fresh.length > TELEGRAM_PER_RUN) await sendTelegramButtons(`Ce ne sono altre ${fresh.length - TELEGRAM_PER_RUN} da decidere: scrivi /coda.`, [])
    if (approved.length || failed.length) {
      const lines = [`*Approvate da sole: ${approved.length}*`, ...approved.slice(0, 10).map((t) => `• ${t}`)]
      if (approved.length > 10) lines.push(`… e altre ${approved.length - 10}.`)
      if (failed.length) lines.push('', `⚠️ ${failed.length} non riuscite, restano in coda: ${failed[0].error}`)
      await sendTelegramButtons(lines.join('\n'), [])
    }
  }
  const after = pending.filter((o) => !approvedIds.has(o.id))
  return { approved, failed, notified, pending: queueCounts(after), enabled: settings.enabled }
}

/** Il riepilogo di /coda, con i pulsanti. */
export async function queueOverview(admin: Admin, userId: string) {
  const [{ settings }, pending] = await Promise.all([loadAutonomy(admin, userId), loadPending(admin, userId)])
  const counts = queueCounts(pending)
  return { text: queueSummaryText(counts, settings), keyboard: queueKeyboard(counts), counts }
}

/** «Approva le sicure»: archivia gli avvisi e approva le proposte sicure, senza aspettare il ritardo. */
export async function approveSafeOutputs(admin: Admin, userId: string) {
  const pending = await loadPending(admin, userId)
  const notices = pending.filter((o) => o.kind === 'report' && (o.body?.action === undefined || o.body?.action === null)).map((o) => o.id)
  const decisions = pending.filter((o) => ['auto', 'safe'].includes(outputTrust(o)) && !notices.includes(o.id))
  let archived = 0
  for (let i = 0; i < notices.length; i += 50) {
    const { data, error } = await admin.rpc('acknowledge_office_outputs', { p_user_id: userId, p_output_ids: notices.slice(i, i + 50) })
    if (error) throw error
    archived += ((data || []) as Array<{ ok: boolean }>).filter((r) => r.ok).length
  }
  let approvedCount = 0
  const errors: string[] = []
  for (const output of decisions) {
    try {
      const result = await decideOfficeOutput(admin, userId, output.id, 'approved')
      if (result.ok) approvedCount++
      else errors.push(`${output.title}: ${result.error}`)
    } catch (error) {
      errors.push(`${output.title}: ${errorMessage(error, 'errore')}`)
    }
  }
  return { archived, approved: approvedCount, errors }
}

/** I pulsanti di /coda. Restituisce la frase da mostrare; le schede partono come messaggi a parte. */
export async function handleQueueAction(admin: Admin, userId: string, view: QueueView): Promise<string> {
  if (view === 'safe') {
    const result = await approveSafeOutputs(admin, userId)
    const parts = [`Fatto: ${result.approved} approvate, ${result.archived} avvisi archiviati.`]
    if (result.errors.length) parts.push(`⚠️ ${result.errors.length} restano in coda: ${result.errors[0]}`)
    return parts.join('\n')
  }
  const pending = await loadPending(admin, userId)
  const wanted = pending.filter((o) => outputTrust(o) === (view === 'emails' ? 'send' : 'manual')).reverse()
  let sent = 0
  for (const output of wanted.slice(0, 10)) {
    const ok = view === 'emails' ? await sendDraftCard(admin, userId, output) : await sendDecisionCard(output)
    if (ok) { sent++; await markNotified(admin, userId, output) }
  }
  if (!wanted.length) return view === 'emails' ? 'Nessuna email in attesa.' : 'Nessuna decisione in attesa.'
  return `Te ne mando ${sent}${wanted.length > 10 ? ` (le 10 più recenti su ${wanted.length})` : ''}.`
}
