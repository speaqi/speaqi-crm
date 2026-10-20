import { NextRequest } from 'next/server'
import { AgencyInputError, addProjectAssets, agencyRoute, loadProject, projectView, readFiles } from '@/lib/server/agency'
import { MAX_AGENCY_REQUEST_BYTES } from '@/lib/server/agency-assets'
import { createServiceRoleClient } from '@/lib/server/supabase'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/** Aggiunge documenti, foto (campo "files") o il logo del cliente (campo "logo"). */
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return agencyRoute(request, async (auth) => {
    const { files } = await readFiles(request, MAX_AGENCY_REQUEST_BYTES)
    if (!files.length) throw new AgencyInputError('Nessun file')
    const row = await loadProject(auth.supabase, auth.user.id, (await ctx.params).id)
    const service = createServiceRoleClient()
    await addProjectAssets(auth.supabase, service, row, files)
    return Response.json(await projectView(auth.supabase, service, row), { status: 201, headers: { 'Cache-Control': 'private, no-store' } })
  })
}
