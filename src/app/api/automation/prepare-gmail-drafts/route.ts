import { NextRequest } from 'next/server'
import { requireRouteUser } from '@/lib/server/supabase'
import {
  isGmailReconnectRequired,
  openGmailDraftSession,
  saveContactDraftWithSession,
  simpleTextToHtml,
} from '@/lib/server/gmail'
import { errorMessage } from '@/lib/server/http'

type PendingDraftRow = {
  id: string
  subject: string | null
  body_text: string | null
  body_html: string | null
  gmail_draft_id: string | null
  contact: { id: string; name: string | null; email: string | null } | null
}

/**
 * Porta le bozze in attesa dentro Gmail in un colpo solo.
 *
 * Serve al tracking aperture: le estensioni tipo MailSuite agganciano il pixel
 * nella finestra di composizione di Gmail, quindi l'email deve partire da li e
 * non dall'API. Una volta spedita a mano, /api/automation/reconcile-drafts la
 * segna come inviata e la toglie dalla coda.
 */
export async function POST(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const body = await request.json().catch(() => ({}))
    const parsedLimit = Math.floor(Number(body.limit))
    const limit = Number.isFinite(parsedLimit) ? Math.min(40, Math.max(1, parsedLimit)) : 25
    // Di default non ritocca le bozze gia presenti in Gmail: potrebbero essere
    // state modificate a mano.
    const includeExisting = body.include_existing === true

    const { data, error } = await auth.supabase
      .from('email_drafts')
      .select('id, subject, body_text, body_html, gmail_draft_id, contact:contact_id ( id, name, email )')
      .eq('user_id', auth.workspaceUserId)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(200)

    if (error) throw error

    const candidates = ((data || []) as unknown as PendingDraftRow[]).filter(
      (draft) =>
        String(draft.contact?.email || '').trim() &&
        String(draft.body_text || draft.body_html || '').trim() &&
        (includeExisting || !draft.gmail_draft_id)
    )

    if (!candidates.length) {
      return Response.json({ ok: true, prepared: 0, remaining: 0, errors: [] })
    }

    const session = await openGmailDraftSession(auth.supabase, auth.workspaceUserId)
    if (!session) {
      return Response.json({ error: 'Gmail non collegato' }, { status: 400 })
    }

    const queue = candidates.slice(0, limit)
    const errors: string[] = []
    let prepared = 0

    for (const draft of queue) {
      try {
        const text = String(draft.body_text || '')
        const html = String(draft.body_html || '') || simpleTextToHtml(text)
        const saved = await saveContactDraftWithSession(
          session,
          { email: String(draft.contact?.email), name: String(draft.contact?.name || '') },
          {
            subject: draft.subject || '(nessun oggetto)',
            html,
            text,
            appendSignature: true,
            gmailDraftId: draft.gmail_draft_id,
          }
        )

        const { error: updateError } = await auth.supabase
          .from('email_drafts')
          .update({
            gmail_draft_id: saved.draftId,
            gmail_draft_message_id: saved.messageId,
          })
          .eq('id', draft.id)
          .eq('user_id', auth.workspaceUserId)
          .eq('status', 'pending')

        if (updateError) throw updateError
        prepared++
      } catch (err) {
        errors.push(
          `${draft.contact?.name || draft.id}: ${errorMessage(err, 'Bozza Gmail non creata')}`
        )
      }
    }

    return Response.json({
      ok: errors.length === 0,
      prepared,
      remaining: Math.max(0, candidates.length - queue.length),
      gmail_account_email: session.account.email,
      errors,
    })
  } catch (error) {
    if (isGmailReconnectRequired(error)) {
      return Response.json(
        { error: 'Autorizzazione Gmail scaduta: ricollega Gmail e riprova.' },
        { status: 409 }
      )
    }
    console.error('prepare-gmail-drafts failed', error)
    return Response.json(
      { error: errorMessage(error, 'Preparazione bozze Gmail fallita') },
      { status: 500 }
    )
  }
}
