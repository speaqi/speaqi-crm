import { NextRequest } from 'next/server'
import { agencyBody, agencyRoute, claimGeneration, createPresentation, inBackground, loadProject, presentationView, runGeneration } from '@/lib/server/agency'
import { createServiceRoleClient } from '@/lib/server/supabase'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Una presentazione nuova per l'opportunità: con l'agente (default) o vuota da costruire a mano. */
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return agencyRoute(request, async (auth) => {
    const body = await agencyBody(request)
    const project = await loadProject(auth.supabase, auth.user.id, (await ctx.params).id)
    const service = createServiceRoleClient()
    let row = await createPresentation(auth.supabase, project, body)
    if (body.generate !== false) {
      row = await claimGeneration(auth.supabase, row)
      const claimed = row
      inBackground('generazione', () => runGeneration(auth.supabase, service, claimed))
    }
    return Response.json(await presentationView(auth.supabase, service, row), { status: 201, headers: { 'Cache-Control': 'private, no-store' } })
  })
}
