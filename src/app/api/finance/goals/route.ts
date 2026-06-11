import { NextRequest } from 'next/server'
import { errorMessage } from '@/lib/server/http'
import { requireRouteUser } from '@/lib/server/supabase'

const PERIOD_TYPES = new Set(['annual', 'quarterly', 'monthly'])
const METRICS = new Set(['revenue', 'paid_revenue', 'new_clients', 'quotes_sent'])

export async function POST(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const body = await request.json().catch(() => null)
    const periodType = String(body?.period_type || '')
    const periodStart = String(body?.period_start || '')
    const metric = String(body?.metric || 'revenue')
    const targetAmount = Number(body?.target_amount)
    const label = body?.label ? String(body.label).trim() : null

    if (!PERIOD_TYPES.has(periodType)) {
      return Response.json({ error: 'period_type non valido' }, { status: 400 })
    }
    if (!METRICS.has(metric)) {
      return Response.json({ error: 'metric non valida' }, { status: 400 })
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(periodStart) || Number.isNaN(new Date(periodStart).getTime())) {
      return Response.json({ error: 'period_start non valido (atteso YYYY-MM-DD)' }, { status: 400 })
    }
    if (!Number.isFinite(targetAmount) || targetAmount < 0) {
      return Response.json({ error: 'target_amount non valido' }, { status: 400 })
    }

    const { data, error } = await auth.supabase
      .from('business_goals')
      .upsert(
        {
          user_id: auth.workspaceUserId,
          period_type: periodType,
          period_start: periodStart,
          metric,
          target_amount: targetAmount,
          label,
        },
        { onConflict: 'user_id,period_type,period_start,metric' }
      )
      .select()
      .single()

    if (error) throw error
    return Response.json({ goal: data })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Impossibile salvare l\'obiettivo') }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const id = request.nextUrl.searchParams.get('id')
    if (!id) return Response.json({ error: 'Parametro id obbligatorio' }, { status: 400 })

    const { error } = await auth.supabase
      .from('business_goals')
      .delete()
      .eq('id', id)
      .eq('user_id', auth.workspaceUserId)

    if (error) throw error
    return Response.json({ ok: true })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Impossibile eliminare l\'obiettivo') }, { status: 500 })
  }
}
