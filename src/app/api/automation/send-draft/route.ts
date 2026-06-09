import { NextRequest } from 'next/server'
import { requireRouteUser } from '@/lib/server/supabase'
import { sendContactEmail } from '@/lib/server/gmail'
import { errorMessage } from '@/lib/server/http'
import type { CRMContact } from '@/types'

export async function POST(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const body = await request.json()
    const draftId = String(body.draft_id || '').trim()
    const mode = String(body.mode || 'send').trim() // 'send' | 'dismiss'

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

    // Calculate smart follow-up time based on contact status (SLA)
    function followupHours(status: string): number {
      const s = status.toLowerCase()
      if (s === 'new') return 4
      if (s === 'contacted') return 24
      if (s === 'interested' || s === 'supertop' || s === 'quote') return 24
      if (s.includes('call')) return 12
      return 72
    }

    const followupAt = new Date(Date.now() + followupHours(contact.status) * 60 * 60 * 1000)
    // Move to callable slot (not midnight, not weekend)
    if (followupAt.getHours() === 0) followupAt.setHours(10)
    while (followupAt.getDay() === 0 || followupAt.getDay() === 6) {
      followupAt.setDate(followupAt.getDate() + 1)
      followupAt.setHours(10)
    }

    // Send via Gmail
    const result = await sendContactEmail(
      auth.supabase,
      auth.workspaceUserId,
      contact as CRMContact,
      {
        subject: draft.subject || '(nessun oggetto)',
        html: draft.body_html || '',
        text: draft.body_text || '',
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
        gmail_draft_id: null, // no longer a draft, it's sent
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
