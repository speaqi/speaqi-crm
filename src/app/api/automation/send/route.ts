import { NextRequest } from 'next/server'
import { isClosedStatus } from '@/lib/data'
import { errorMessage } from '@/lib/server/http'
import { sendContactEmail, simpleTextToHtml } from '@/lib/server/gmail'
import { createServiceRoleClient } from '@/lib/server/supabase'
import { nextFollowupAfterEmail } from '@/lib/sla'
import type { CRMContact } from '@/types'
import { automationContext, validateAutomationSecret } from '@/lib/server/automation-auth'
import { sendDraftAutomatically } from '@/lib/server/automation-send'

/**
 * Invio email machine-to-machine.
 *
 * /api/automation/send-draft richiede una sessione browser (requireRouteUser):
 * n8n e le sequenze non possono usarlo. Questo endpoint fa lo stesso invio
 * autenticandosi con AUTOMATION_SECRET e un mittente esplicito, e applica i
 * guardrail che un invio non presidiato deve avere.
 */

const DEFAULT_DAILY_CAP = 40

function dailyCap() {
  const parsed = Number(process.env.AUTOMATION_DAILY_SEND_CAP)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_DAILY_CAP
}

function startOfTodayIso() {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  return start.toISOString()
}

/** Quante email Gmail ha gia inviato oggi questo mittente. */
async function sentTodayCount(supabase: any, userId: string) {
  const { count, error } = await supabase
    .from('email_logs')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('type', 'gmail')
    .eq('status', 'sent')
    .gte('created_at', startOfTodayIso())

  if (error) throw error
  return count || 0
}

/**
 * Mittente: esplicito, altrimenti proprietario della bozza o del contatto,
 * altrimenti l'unico account Gmail collegato del workspace.
 */
async function resolveSenderUserId(
  supabase: any,
  explicit: string,
  draftUserId?: string | null,
  contactUserId?: string | null
) {
  if (explicit) return explicit
  if (draftUserId) return draftUserId
  if (contactUserId) return contactUserId

  const { data, error } = await supabase.from('gmail_accounts').select('user_id').limit(2)
  if (error) throw error
  if (data?.length === 1) return String(data[0].user_id)
  return ''
}

function skip(reason: string, detail: string) {
  return Response.json({ sent: false, skipped: true, reason, detail })
}

export async function POST(request: NextRequest) {
  if (!validateAutomationSecret(request)) {
    return Response.json({ error: 'Unauthorized automation' }, { status: 401 })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const draftId = String(body.draft_id || '').trim()
    const requestedContactId = String(body.contact_id || '').trim()
    const dryRun = body.dry_run === true
    const ignoreCap = body.ignore_cap === true
    const supabase = createServiceRoleClient()

    if (draftId) {
      if (!dryRun && process.env.AUTOMATION_SEND_ENABLED !== 'true') {
        return Response.json({ error: 'Automatic sending disabled' }, { status: 503 })
      }
      const context = automationContext()
      if (!context) {
        return Response.json({ error: 'Automation workspace not configured' }, { status: 503 })
      }
      const result = await sendDraftAutomatically(supabase, context, {
        draftId,
        minAgeMinutes: Math.max(0, Math.floor(Number(body.min_age_minutes) || 0)),
        dryRun,
      })
      return Response.json(result, { status: result.unknown ? 500 : 200 })
    }

    if (!draftId && !requestedContactId) {
      return Response.json({ error: 'draft_id oppure contact_id obbligatorio' }, { status: 400 })
    }

    // ─── Bozza (opzionale: si puo inviare anche contenuto ad hoc) ───
    let draft: any = null
    if (draftId) {
      const { data, error } = await supabase
        .from('email_drafts')
        .select('*')
        .eq('id', draftId)
        .maybeSingle()

      if (error) throw error
      if (!data) return Response.json({ error: 'Bozza non trovata' }, { status: 404 })
      if (data.status !== 'pending') {
        return skip('draft_not_pending', `Bozza gia ${data.status}`)
      }
      draft = data
    }

    const contactId = draft?.contact_id || requestedContactId
    const { data: contact, error: contactError } = await supabase
      .from('contacts')
      .select('*')
      .eq('id', contactId)
      .maybeSingle()

    if (contactError) throw contactError
    if (!contact) return Response.json({ error: 'Contatto non trovato' }, { status: 404 })

    // ─── Guardrail: chi non va mai contattato in automatico ───
    if (!String(contact.email || '').trim()) {
      return skip('missing_email', 'Contatto senza indirizzo email')
    }
    if (contact.email_unsubscribed_at) {
      return skip('unsubscribed', 'Contatto disiscritto')
    }
    if (contact.contact_scope === 'personal') {
      return skip('personal_scope', 'Contatto in area personale')
    }
    if (isClosedStatus(String(contact.status || ''))) {
      return skip('closed_status', `Stage chiuso: ${contact.status}`)
    }
    if ((contact.marketing_status || '') === 'paused') {
      const until = contact.marketing_paused_until
      if (!until || new Date(until).getTime() > Date.now()) {
        return skip('paused', 'Marketing in pausa per questo contatto')
      }
    }

    const senderUserId = await resolveSenderUserId(
      supabase,
      String(body.sender_user_id || '').trim(),
      draft?.user_id,
      contact.user_id
    )

    if (!senderUserId) {
      return Response.json(
        { error: 'Mittente non determinabile: passare sender_user_id' },
        { status: 400 }
      )
    }

    // ─── Guardrail: tetto giornaliero per mittente (deliverability) ───
    const cap = dailyCap()
    const alreadySent = await sentTodayCount(supabase, senderUserId)
    if (!ignoreCap && alreadySent >= cap) {
      return skip('daily_cap', `Tetto giornaliero raggiunto: ${alreadySent}/${cap}`)
    }

    const subject = String(body.subject ?? draft?.subject ?? '').trim()
    const bodyText = String(body.body_text ?? draft?.body_text ?? '').trim()
    const bodyHtml = String(body.body_html ?? draft?.body_html ?? '').trim() || simpleTextToHtml(bodyText)

    if (!subject) return Response.json({ error: 'Oggetto mancante' }, { status: 400 })
    if (!bodyText) return Response.json({ error: 'Corpo email mancante' }, { status: 400 })

    const followupAt = nextFollowupAfterEmail(contact.status).toISOString()

    if (dryRun) {
      return Response.json({
        sent: false,
        dry_run: true,
        contact_id: contactId,
        sender_user_id: senderUserId,
        subject,
        followup_at: followupAt,
        sent_today: alreadySent,
        daily_cap: cap,
      })
    }

    const result = await sendContactEmail(supabase, senderUserId, contact as CRMContact, {
      subject,
      html: bodyHtml,
      text: bodyText,
      followupAt,
      appendSignature: true,
    })

    if (draft) {
      const { error: updateError } = await supabase
        .from('email_drafts')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          sent_via: 'automation',
          provider_message_id: result.message.gmail_message_id,
          gmail_draft_id: null,
        })
        .eq('id', draft.id)

      if (updateError) console.error('[automation/send] draft update failed', updateError)
    }

    const { error: marketingError } = await supabase
      .from('contacts')
      .update({ marketing_status: 'sent' })
      .eq('id', contactId)

    if (marketingError) console.error('[automation/send] marketing_status update failed', marketingError)

    return Response.json({
      sent: true,
      draft_id: draft?.id || null,
      contact_id: contactId,
      sender_user_id: senderUserId,
      gmail_message_id: result.message.gmail_message_id,
      followup_at: followupAt,
      sent_today: alreadySent + 1,
      daily_cap: cap,
    })
  } catch (error) {
    console.error('automation/send failed', error)
    return Response.json({ error: errorMessage(error, 'Invio automatico fallito') }, { status: 500 })
  }
}
