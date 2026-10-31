import { NextRequest } from 'next/server'
import { parseRecurringInput } from '@/lib/office-recurring'
import { officeOwnerRoute } from '@/lib/server/office-api'

export async function GET(request: NextRequest) {
  return officeOwnerRoute(request, async ({ admin, userId }) => {
    const { data, error } = await admin.from('office_recurring_orders').select('*').eq('user_id', userId)
      .order('created_at', { ascending: false }).limit(100)
    if (error && ['42P01', 'PGRST205'].includes(error.code)) return Response.json({ error: 'Agenda non ancora installata nel database.' }, { status: 503 })
    if (error) throw error
    return Response.json({ schedules: data || [] })
  })
}

export async function POST(request: NextRequest) {
  return officeOwnerRoute(request, async ({ admin, userId }) => {
    let input
    try { input = parseRecurringInput(await request.json()); if (!input.enabled) throw new Error('Il nuovo incarico deve essere attivo') }
    catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Incarico non valido' }, { status: 400 }) }
    const { data, error } = await admin.rpc('office_recurring_create', { p_user_id: userId, p_title: input.title,
      p_instruction: input.instruction, p_every_days: input.every_days, p_local_time: input.local_time, p_first_day: input.next_local_date })
    if (error && ['42883', 'PGRST202'].includes(error.code)) return Response.json({ error: 'Agenda non ancora installata nel database.' }, { status: 503 })
    if (error) throw error
    return Response.json({ schedule: data }, { status: 201 })
  })
}
