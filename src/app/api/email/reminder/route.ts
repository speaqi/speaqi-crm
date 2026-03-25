import { NextRequest } from 'next/server'
import { sendReminderEmail } from '@/lib/email'
import { createClient } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const recipientEmail = body.email || process.env.REMINDER_EMAIL

    if (!recipientEmail) {
      return Response.json({ error: 'No recipient email configured' }, { status: 400 })
    }

    // Get all user states from Supabase and find today's calls
    const supabase = createClient()
    const todayStr = new Date().toISOString().split('T')[0]

    const { data: states } = await supabase
      .from('user_state')
      .select('cards, call_scheduled, call_done')

    if (!states?.length) {
      return Response.json({ message: 'No data found' })
    }

    // Collect today's scheduled calls across all users
    const todayCalls: Array<{ name: string; time: string }> = []

    for (const state of states) {
      const cards: Array<{ _u?: string; n: string; s: string; r?: string }> = state.cards || []
      const scheduled: Record<string, string> = state.call_scheduled || {}
      const done: Record<string, boolean> = state.call_done || {}

      cards
        .filter(c => (c.s === 'Da Richiamare' || c.s === 'Da fare') && scheduled[c._u!] === todayStr)
        .filter(c => !done[c._u! + '_' + todayStr])
        .forEach(c => {
          todayCalls.push({ name: c.n, time: c.r ? `Resp: ${c.r}` : '' })
        })
    }

    if (!todayCalls.length) {
      return Response.json({ message: 'No calls scheduled for today' })
    }

    await sendReminderEmail(recipientEmail, todayCalls)

    return Response.json({
      success: true,
      message: `Reminder sent for ${todayCalls.length} calls`,
    })
  } catch (error) {
    console.error('Reminder error:', error)
    return Response.json({ error: 'Failed to send reminder' }, { status: 500 })
  }
}
