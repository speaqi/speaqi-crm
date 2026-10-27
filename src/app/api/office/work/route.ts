import { NextRequest } from 'next/server'
import { officeOwnerRoute } from '@/lib/server/office-api'
import { OFFICE_OPEN_WORK_STATUSES } from '@/lib/office-activity'

const OPEN_STATUSES = [...OFFICE_OPEN_WORK_STATUSES]
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const schemaMissing = (error: { code?: string } | null) => !!error && ['42P01', '42703', 'PGRST205', 'PGRST204'].includes(error.code || '')
function publicWork(row: Record<string, unknown>) {
  const { lease_token: _lease, checkpoint: _checkpoint, ...work } = row
  return work
}

/** I lavori sono visibili solo al titolare del workspace, anche con service role. */
export async function GET(request: NextRequest) {
  return officeOwnerRoute(request, async ({ admin, userId }) => {
    const orderId = request.nextUrl.searchParams.get('order_id')
    const agentId = request.nextUrl.searchParams.get('agent_id')
    const view = request.nextUrl.searchParams.get('view') || 'open'
    const offsetText = request.nextUrl.searchParams.get('offset') || '0'
    if ((orderId && !UUID.test(orderId)) || (agentId !== null && !/^[a-z][a-z0-9_]{0,79}$/.test(agentId)) || !['open', 'all'].includes(view)
      || !/^\d{1,7}$/.test(offsetText)) return Response.json({ error: 'Filtro dei lavori non valido' }, { status: 400 })
    const offset = Math.min(Number(offsetText), 100_000)
    let query = admin.from('office_work_items').select('*', { count: 'exact' }).eq('user_id', userId)
    if (orderId) query = query.eq('order_id', orderId)
    if (agentId) query = query.eq('agent_id', agentId)
    if (view === 'open') query = query.in('status', OPEN_STATUSES)
    const result = await query.order('priority', { ascending: false }).order('created_at', { ascending: true })
      .order('id').range(offset, offset + 24)
    if (schemaMissing(result.error)) return Response.json({ supported: false, works: [], total: 0, offset,
      notice: 'Il registro dei lavori è in aggiornamento. Gli ordini restano salvati.' })
    if (result.error?.code === 'PGRST103') {
      // Un cambiamento di stato può svuotare la pagina appena richiesta.
      let count = admin.from('office_work_items').select('id', { head: true, count: 'exact' }).eq('user_id', userId)
      if (orderId) count = count.eq('order_id', orderId)
      if (agentId) count = count.eq('agent_id', agentId)
      if (view === 'open') count = count.in('status', OPEN_STATUSES)
      const counted = await count
      if (counted.error) throw counted.error
      return Response.json({ supported: true, works: [], total: counted.count || 0, offset })
    }
    if (result.error) throw result.error
    return Response.json({ supported: true, works: (result.data || []).map(publicWork), total: result.count || 0, offset })
  })
}
