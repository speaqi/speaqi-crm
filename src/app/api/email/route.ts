import { NextRequest } from 'next/server'
import { sendCustomEmail, sendFollowupEmail, sendReminderEmail } from '@/lib/email'
import { createServiceRoleClient, getBearerToken, createPublicServerClient } from '@/lib/server/supabase'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { to, subject, html, type } = body

    if (!to) {
      return Response.json({ error: 'Missing required field: to' }, { status: 400 })
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

    let userId: string | null = null
    const token = getBearerToken(request)
    if (token) {
      const authClient = createPublicServerClient()
      const {
        data: { user },
      } = await authClient.auth.getUser(token)
      userId = user?.id || null
    }

    try {
      const admin = createServiceRoleClient()
      await admin.from('email_logs').insert({
        user_id: userId,
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
