import { randomUUID } from 'crypto'
import { isClosedStatus } from '@/lib/data'
import { nextFollowupAfterEmail } from '@/lib/sla'
import type { CRMContact } from '@/types'
import { validateGeneratedDraft } from '@/lib/server/email-draft-context'
import { sendContactEmail, simpleTextToHtml } from '@/lib/server/gmail'
import { errorMessage } from '@/lib/server/http'
import type { AutomationContext } from '@/lib/server/automation-auth'

const DEFAULT_DAILY_CAP = 40

export type AutomaticSendResult = {
  draft_id: string
  sent: boolean
  skipped?: boolean
  unknown?: boolean
  reason?: string
  detail?: string
  send_attempt_id?: string
  gmail_message_id?: string
}

function dailyCap() {
  const value = Number(process.env.AUTOMATION_DAILY_SEND_CAP)
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_DAILY_CAP
}

function localDay(timezone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

function skip(draftId: string, reason: string, detail: string): AutomaticSendResult {
  return { draft_id: draftId, sent: false, skipped: true, reason, detail }
}

function commercialIssues(subject: string, body: string) {
  const value = `${subject}\n${body}`
  const issues: string[] = []
  if (/\b(?:piano|plan)\s+(?:pro|business|enterprise|start|experience|signature)\b/i.test(value)) {
    issues.push('legacy_plan')
  }
  if (/\bcrediti?\s+(?:video|ai)\b/i.test(value)) issues.push('exposed_video_credits')
  return issues
}

export async function inspectAutomaticDraft(
  supabase: any,
  context: AutomationContext,
  draftId: string,
  minAgeMinutes: number
) {
  const { data: draft, error } = await supabase
    .from('email_drafts')
    .select('*')
    .eq('id', draftId)
    .eq('user_id', context.workspaceUserId)
    .maybeSingle()
  if (error) throw error
  if (!draft) return { result: skip(draftId, 'draft_not_found', 'Bozza non trovata nel workspace') }
  if (draft.status !== 'pending') return { result: skip(draftId, 'draft_not_pending', `Bozza ${draft.status}`) }
  if (draft.source !== 'auto') return { result: skip(draftId, 'manual_draft', 'Bozza non automatica') }
  const age = Date.now() - new Date(draft.created_at).getTime()
  if (!Number.isFinite(age) || age < minAgeMinutes * 60_000) {
    return { result: skip(draftId, 'draft_too_young', 'Età minima non raggiunta') }
  }

  const { data: contact, error: contactError } = await supabase
    .from('contacts').select('*').eq('id', draft.contact_id)
    .eq('user_id', context.workspaceUserId).maybeSingle()
  if (contactError) throw contactError
  if (!contact) return { result: skip(draftId, 'workspace_mismatch', 'Contatto non disponibile nel workspace') }
  if (contact.contact_scope !== 'holding') return { result: skip(draftId, 'scope_not_allowed', 'Solo holding è autorizzato') }
  if (!String(contact.email || '').trim()) return { result: skip(draftId, 'missing_email', 'Email mancante') }
  if (contact.email_unsubscribed_at) return { result: skip(draftId, 'unsubscribed', 'Contatto disiscritto') }
  if (isClosedStatus(String(contact.status || ''))) return { result: skip(draftId, 'closed_status', 'Stage chiuso') }
  if (contact.marketing_status === 'paused' && (!contact.marketing_paused_until || new Date(contact.marketing_paused_until).getTime() > Date.now())) {
    return { result: skip(draftId, 'paused', 'Marketing in pausa') }
  }

  const { count: replies, error: repliesError } = await supabase
    .from('gmail_messages').select('id', { count: 'exact', head: true })
    .eq('user_id', context.workspaceUserId).eq('contact_id', contact.id)
    .eq('direction', 'inbound').gt('sent_at', draft.created_at)
  if (repliesError) throw repliesError
  if ((replies || 0) > 0) return { result: skip(draftId, 'reply_received', 'Risposta ricevuta dopo la bozza') }

  const { count: newerOutbounds, error: outboundError } = await supabase
    .from('gmail_messages').select('id', { count: 'exact', head: true })
    .eq('user_id', context.workspaceUserId).eq('contact_id', contact.id)
    .eq('direction', 'outbound').gt('sent_at', draft.created_at)
  if (outboundError) throw outboundError
  if ((newerOutbounds || 0) > 0) {
    return { result: skip(draftId, 'newer_outbound_exists', 'Esiste già un invio successivo alla bozza') }
  }

  const subject = String(draft.subject || '').trim()
  const bodyText = String(draft.body_text || '').trim()
  if (!subject || !bodyText) return { result: skip(draftId, 'invalid_content', 'Oggetto o corpo mancante') }
  const validation = validateGeneratedDraft(contact as CRMContact, { subject, body_text: bodyText }, false)
  const issues = [...validation.all, ...commercialIssues(subject, bodyText)]
  if (issues.length) return { result: skip(draftId, 'content_guardrail', issues.join('; ')) }

  const { data: sender } = await supabase.from('gmail_accounts').select('user_id')
    .eq('user_id', context.senderUserId).maybeSingle()
  if (!sender || context.senderUserId !== context.workspaceUserId) {
    return { result: skip(draftId, 'workspace_mismatch', 'Mittente non autorizzato per il workspace') }
  }
  return { draft, contact: contact as CRMContact, subject, bodyText }
}

export async function sendDraftAutomatically(
  supabase: any,
  context: AutomationContext,
  options: { draftId: string; minAgeMinutes: number; dryRun?: boolean }
): Promise<AutomaticSendResult> {
  const inspected = await inspectAutomaticDraft(supabase, context, options.draftId, options.minAgeMinutes)
  if ('result' in inspected) return inspected.result!
  if (options.dryRun) return skip(options.draftId, 'dry_run_candidate', 'La bozza supererebbe i controlli')

  const attemptId = randomUUID()
  const messageIdHeader = `<auto-${attemptId}@crm.speaqi.com>`
  const { data: claimed, error: claimError } = await supabase.rpc('claim_automation_draft', {
    p_draft_id: options.draftId,
    p_workspace_user_id: context.workspaceUserId,
    p_sender_user_id: context.senderUserId,
    p_attempt_id: attemptId,
    p_local_day: localDay(context.timezone),
    p_daily_cap: dailyCap(),
    p_message_id_header: messageIdHeader,
  })
  if (claimError) throw claimError
  if (!claimed) return skip(options.draftId, 'claim_or_cap_rejected', 'Bozza già acquisita o cap raggiunto')

  try {
    const result = await sendContactEmail(supabase, context.senderUserId, inspected.contact!, {
      subject: inspected.subject!,
      text: inspected.bodyText!,
      html: String(inspected.draft!.body_html || '').trim() || simpleTextToHtml(inspected.bodyText!),
      followupAt: nextFollowupAfterEmail(inspected.contact!.status).toISOString(),
      appendSignature: true,
      messageIdHeader,
    })
    const providerId = result.message.gmail_message_id
    const { data: finished, error: finishError } = await supabase.rpc('finish_automation_send', {
      p_attempt_id: attemptId, p_provider_message_id: providerId,
    })
    if (finishError || !finished) throw finishError || new Error('Persistenza finale fallita')
    return { draft_id: options.draftId, sent: true, send_attempt_id: attemptId, gmail_message_id: providerId }
  } catch (error) {
    const detail = errorMessage(error, 'Esito provider incerto')
    await supabase.rpc('mark_automation_send_unknown', { p_attempt_id: attemptId, p_error_detail: detail })
    return { draft_id: options.draftId, sent: false, unknown: true, reason: 'provider_outcome_unknown', detail, send_attempt_id: attemptId }
  }
}
