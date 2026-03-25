import { NextRequest } from 'next/server'
import { sendReminderEmail } from '@/lib/email'
import { createServiceRoleClient } from '@/lib/server/supabase'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const recipientEmail = body.email || process.env.REMINDER_EMAIL

    if (!recipientEmail) {
      return Response.json({ error: 'No recipient email configured' }, { status: 400 })
    }

    const supabase = createServiceRoleClient()
    const startOfDay = new Date()
    startOfDay.setHours(0, 0, 0, 0)
    const endOfDay = new Date(startOfDay)
    endOfDay.setDate(endOfDay.getDate() + 1)

    const { data, error } = await supabase
      .from('tasks')
      .select('due_date, contact:contacts(name)')
      .eq('status', 'pending')
      .gte('due_date', startOfDay.toISOString())
      .lt('due_date', endOfDay.toISOString())
      .order('due_date', { ascending: true })

    if (error) throw error

    const calls = (data || []).map((row: any) => ({
      name: Array.isArray(row.contact) ? row.contact[0]?.name || 'Contatto' : row.contact?.name || 'Contatto',
      time: row.due_date ? new Date(row.due_date).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '',
    }))

    if (!calls.length) {
      return Response.json({ message: 'No calls scheduled for today' })
    }

    await sendReminderEmail(recipientEmail, calls)

    return Response.json({
      success: true,
      message: `Reminder sent for ${calls.length} tasks`,
    })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to send reminder' },
      { status: 500 }
    )
  }
}
