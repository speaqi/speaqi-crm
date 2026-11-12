import { NextRequest } from 'next/server'
import { parseReportConfig } from '@/lib/office-recurring'
import { officeOwnerRoute } from '@/lib/server/office-api'

export async function GET(request: NextRequest) {
  return officeOwnerRoute(request, async ({ admin, userId }) => {
    const { data, error } = await admin.from('office_report_config').select('*').eq('user_id', userId).maybeSingle()
    if (error && ['42P01', 'PGRST205'].includes(error.code)) return Response.json({ error: 'Report periodico non ancora installato nel database.' }, { status: 503 })
    if (error) throw error
    return Response.json({ config: data })
  })
}

export async function PUT(request: NextRequest) {
  return officeOwnerRoute(request, async ({ admin, userId }) => {
    let input
    try { input = parseReportConfig(await request.json()) }
    catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Impostazioni non valide' }, { status: 400 }) }
    const { data, error } = await admin.rpc('office_report_configure', { p_user_id: userId, p_every_days: input.every_days,
      p_local_time: input.local_time, p_next_day: input.next_local_date, p_enabled: input.enabled, p_revision: input.revision })
    if (error && ['42883', 'PGRST202'].includes(error.code)) return Response.json({ error: 'Report periodico non ancora installato nel database.' }, { status: 503 })
    if (error) throw error
    if (!data) return Response.json({ error: 'Le impostazioni sono cambiate: aggiorna e riprova.' }, { status: 409 })
    return Response.json({ config: data })
  })
}
