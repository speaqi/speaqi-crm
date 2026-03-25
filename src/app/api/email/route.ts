import { NextRequest } from 'next/server'
import { sendFollowupEmail, sendReminderEmail, sendCustomEmail } from '@/lib/email'
import { createClient } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { to, subject, html, type } = body

    if (!to) {
      return Response.json({ error: 'Missing required field: to' }, { status: 400 })
    }

    let result

    if (type === 'followup') {
      const { contactName, cardName } = body
      result = await sendFollowupEmail(to, contactName || '', cardName || '')
    } else if (type === 'reminder') {
      const { calls } = body
      result = await sendReminderEmail(to, calls || [])
    } else {
      if (!subject || !html) {
        return Response.json({ error: 'Missing subject or html for custom email' }, { status: 400 })
      }
      result = await sendCustomEmail(to, subject, html)
    }

    // Log to Supabase
    try {
      const supabase = createClient()
      await supabase.from('email_logs').insert({
        to,
        subject: subject || type,
        type: type || 'custom',
        status: 'sent',
        created_at: new Date().toISOString(),
      })
    } catch {
      // Non-critical, ignore logging errors
    }

    return Response.json({ success: true, id: (result as { id?: string }).id })
  } catch (error) {
    console.error('Email error:', error)
    return Response.json({ error: 'Failed to send email' }, { status: 500 })
  }
}
