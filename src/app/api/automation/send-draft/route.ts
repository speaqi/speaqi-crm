import { NextRequest } from 'next/server'
import { requireRouteUser } from '@/lib/server/supabase'
import {
  createContactDraft,
  sendContactEmail,
  simpleTextToHtml,
  updateContactDraft,
} from '@/lib/server/gmail'
import { errorMessage } from '@/lib/server/http'
import { nextFollowupAfterEmail } from '@/lib/sla'
import type { CRMContact } from '@/types'

export async function POST(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const body = await request.json()
    const draftId = String(body.draft_id || '').trim()
    const mode = String(body.mode || 'send').trim() // 'send' | 'save_draft' | 'dismiss'
    const editedSubject = body.subject === undefined ? null : String(body.subject).trim()
    const editedBodyText = body.body_text === undefined ? null : String(body.body_text).trim()

    if (!draftId) {
      return Response.json({ error: 'draft_id obbligatorio' }, { status: 400 })
    }

    // Load the draft
    const { data: draft, error: draftError } = await auth.supabase
      .from('email_drafts')
      .select('*')
      .eq('id', draftId)
      .eq('user_id', auth.workspaceUserId)
      .single()

    if (draftError || !draft) {
      return Response.json({ error: 'Bozza non trovata' }, { status: 404 })
    }

    if (draft.status !== 'pending') {
      return Response.json({ error: `Bozza già ${draft.status === 'sent' ? 'inviata' : 'archiviata'}` }, { status: 409 })
    }

    if (mode === 'dismiss') {
      const { error: updateError } = await auth.supabase
        .from('email_drafts')
        .update({ status: 'dismissed' })
        .eq('id', draftId)

      if (updateError) throw updateError

      return Response.json({ draft_id: draftId, status: 'dismissed' })
    }

    // Load contact
    const { data: contact, error: contactError } = await auth.supabase
      .from('contacts')
      .select('*')
      .eq('id', draft.contact_id)
      .single()

    if (contactError || !contact) {
      return Response.json({ error: 'Contatto non trovato' }, { status: 404 })
    }

    if (!contact.email) {
      return Response.json({ error: 'Contatto senza email' }, { status: 400 })
    }

    const subject = editedSubject || draft.subject || '(nessun oggetto)'
    const bodyText = editedBodyText === null ? (draft.body_text || '') : editedBodyText
    const bodyHtml = editedBodyText === null
      ? (draft.body_html || simpleTextToHtml(bodyText))
      : simpleTextToHtml(bodyText)

    if (!bodyText) {
      return Response.json({ error: 'Il corpo email non puo essere vuoto' }, { status: 400 })
    }

    if (mode === 'save_draft') {
      const gmailDraft = draft.gmail_draft_id
        ? await updateContactDraft(
            auth.supabase,
            auth.workspaceUserId,
            draft.gmail_draft_id,
            { email: contact.email, name: contact.name },
            { subject, html: bodyHtml, text: bodyText, appendSignature: true }
          )
        : await createContactDraft(
            auth.supabase,
            auth.workspaceUserId,
            { email: contact.email, name: contact.name },
            { subject, html: bodyHtml, text: bodyText, appendSignature: true }
          )

      if (!gmailDraft) {
        return Response.json({ error: 'Gmail non collegato' }, { status: 400 })
      }

      const { error: saveError } = await auth.supabase
        .from('email_drafts')
        .update({
          subject,
          body_text: bodyText,
          body_html: bodyHtml,
          gmail_draft_id: gmailDraft.draftId,
          gmail_draft_message_id: gmailDraft.messageId,
        })
        .eq('id', draftId)
        .eq('user_id', auth.workspaceUserId)

      if (saveError) throw saveError

      return Response.json({
        draft_id: draftId,
        status: 'pending',
        gmail_draft_id: gmailDraft.draftId,
        gmail_draft_message_id: gmailDraft.messageId,
      })
    }

    if (editedSubject !== null || editedBodyText !== null) {
      const { error: editError } = await auth.supabase
        .from('email_drafts')
        .update({
          subject,
          body_text: bodyText,
          body_html: bodyHtml,
        })
        .eq('id', draftId)

      if (editError) throw editError
    }

    // Cadenza SLA centralizzata in @/lib/sla
    const followupAt = nextFollowupAfterEmail(contact.status)

    // Send via Gmail
    const result = await sendContactEmail(
      auth.supabase,
      auth.workspaceUserId,
      contact as CRMContact,
      {
        subject,
        html: bodyHtml,
        text: bodyText,
        followupAt: followupAt.toISOString(),
        appendSignature: true,
      }
    )

    // Mark draft as sent
    const { error: updateError } = await auth.supabase
      .from('email_drafts')
      .update({
        status: 'sent',
        sent_at: new Date().toISOString(),
        sent_via: 'crm',
        provider_message_id: result.message.gmail_message_id,
        gmail_draft_id: null, // no longer a draft, it's sent
        gmail_draft_message_id: null,
      })
      .eq('id', draftId)

    if (updateError) {
      console.error('Failed to mark draft as sent', updateError)
    }

    return Response.json({
      draft_id: draftId,
      status: 'sent',
      gmail_message_id: result.message.gmail_message_id,
      followup_at: followupAt.toISOString(),
    })
  } catch (error) {
    console.error('send-draft failed', error)
    return Response.json({ error: errorMessage(error, 'Invio fallito') }, { status: 500 })
  }
}
