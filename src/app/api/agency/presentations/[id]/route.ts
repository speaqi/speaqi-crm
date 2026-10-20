import { NextRequest } from 'next/server'
import { agencyBody, agencyRoute, deletePresentation, loadPresentation, loadProject, presentationView, saveEdits } from '@/lib/server/agency'
import { createServiceRoleClient } from '@/lib/server/supabase'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, ctx: Ctx) {
  return agencyRoute(request, async (auth) => {
    const row = await loadPresentation(auth.supabase, auth.user.id, (await ctx.params).id)
    return presentationView(auth.supabase, createServiceRoleClient(), row)
  })
}

/** Modifica a mano: slide, tema, titolo, preventivo mostrato. Ogni salvataggio è una versione. */
export async function PATCH(request: NextRequest, ctx: Ctx) {
  return agencyRoute(request, async (auth) => {
    const row = await loadPresentation(auth.supabase, auth.user.id, (await ctx.params).id)
    const project = await loadProject(auth.supabase, auth.user.id, row.project_id)
    const saved = await saveEdits(auth.supabase, row, project, await agencyBody(request))
    return presentationView(auth.supabase, createServiceRoleClient(), saved)
  })
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
  return agencyRoute(request, async (auth) => {
    const row = await loadPresentation(auth.supabase, auth.user.id, (await ctx.params).id)
    await deletePresentation(auth.supabase, createServiceRoleClient(), row)
    return { deleted: true, project_id: row.project_id }
  })
}
