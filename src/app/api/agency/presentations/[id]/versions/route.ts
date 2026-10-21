import { NextRequest } from 'next/server'
import { AgencyInputError, agencyBody, agencyRoute, listVersions, loadPresentation, loadProject, presentationView, restoreVersion } from '@/lib/server/agency'
import { createServiceRoleClient } from '@/lib/server/supabase'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, ctx: Ctx) {
  return agencyRoute(request, async (auth) => {
    const row = await loadPresentation(auth.supabase, auth.user.id, (await ctx.params).id)
    return { versions: await listVersions(auth.supabase, row) }
  })
}

/** { version } ripristina una versione precedente: diventa una versione nuova, lo storico resta. */
export async function POST(request: NextRequest, ctx: Ctx) {
  return agencyRoute(request, async (auth) => {
    const body = await agencyBody(request)
    const version = Number(body.version)
    if (!Number.isInteger(version) || version < 1) throw new AgencyInputError('Versione non valida')
    const row = await loadPresentation(auth.supabase, auth.user.id, (await ctx.params).id)
    const project = await loadProject(auth.supabase, auth.user.id, row.project_id)
    const saved = await restoreVersion(auth.supabase, row, project, version)
    return presentationView(auth.supabase, createServiceRoleClient(), saved)
  })
}
