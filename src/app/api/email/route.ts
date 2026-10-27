import { NextRequest } from 'next/server'
import { sendCustomEmail, sendFollowupEmail, sendReminderEmail } from '@/lib/email'
import { isWorkspaceRecipient, singleRecipient } from '@/lib/server/email-recipients'
import { createServiceRoleClient, requireRouteUser } from '@/lib/server/supabase'

export async function POST(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error
  // Spedisce HTML scritto da chi chiama col mittente del CRM: solo il titolare.
  if (!auth.isAdmin) return Response.json({ error: 'Solo il titolare può inviare email da qui' }, { status: 403 })

  try {
    const body = await request.json()
    const { subject, html, type } = body

    const to = singleRecipient(body.to)
    if (!to) {
      return Response.json({ error: 'Serve un solo indirizzo email valido in "to"' }, { status: 400 })
    }
    const ownEmail = auth.user.email?.trim().toLowerCase()
    if (to !== ownEmail && !(await isWorkspaceRecipient(auth.supabase, auth.workspaceUserId, to))) {
      return Response.json({ error: 'Il destinatario non è fra i contatti o nel team' }, { status: 403 })
    }

    let result

    if (type === 'followup') {
      result = await sendFollowupEmail(to, body.contactName || '', body.cardName || '')
    } else if (type === 'reminder') {
      result = await sendReminderEmail(to, body.calls || [])
    } else {
      if (!subject || !html) {
        return Response.json({ error: 'Missing subject or html for custom email' }, { status: 400 })
      }
      result = await sendCustomEmail(to, subject, html)
    }

    try {
      const admin = createServiceRoleClient()
      await admin.from('email_logs').insert({
        user_id: auth.workspaceUserId,
        to,
        subject: subject || type,
        type: type || 'custom',
        status: 'sent',
      })
    } catch {
      // Ignore email log failures.
    }

    return Response.json({ success: true, id: (result as { id?: string }).id })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to send email' },
      { status: 500 }
    )
  }
}
