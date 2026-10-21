import { NextRequest } from 'next/server'
import { AgencyInputError, agencyRoute, isUuid, loadProject, projectView, removeProjectAsset } from '@/lib/server/agency'
import { createServiceRoleClient } from '@/lib/server/supabase'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function DELETE(request: NextRequest, ctx: { params: Promise<{ id: string; assetId: string }> }) {
  return agencyRoute(request, async (auth) => {
    const { id, assetId } = await ctx.params
    if (!isUuid(assetId)) throw new AgencyInputError('ID non valido')
    const row = await loadProject(auth.supabase, auth.user.id, id)
    const service = createServiceRoleClient()
    await removeProjectAsset(auth.supabase, service, row, assetId)
    return projectView(auth.supabase, service, row)
  })
}
