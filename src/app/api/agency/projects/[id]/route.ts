import { NextRequest } from 'next/server'
import { agencyBody, agencyRoute, deleteProject, loadProject, projectView, updateProject } from '@/lib/server/agency'
import { createServiceRoleClient } from '@/lib/server/supabase'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, ctx: Ctx) {
  return agencyRoute(request, async (auth) => {
    const row = await loadProject(auth.supabase, auth.user.id, (await ctx.params).id)
    return projectView(auth.supabase, createServiceRoleClient(), row)
  })
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  return agencyRoute(request, async (auth) => {
    const row = await loadProject(auth.supabase, auth.user.id, (await ctx.params).id)
    const saved = await updateProject(auth.supabase, row, await agencyBody(request))
    return projectView(auth.supabase, createServiceRoleClient(), saved)
  })
}

/** Cancella opportunità, presentazioni, versioni e file. I preventivi restano (perdono solo il collegamento). */
export async function DELETE(request: NextRequest, ctx: Ctx) {
  return agencyRoute(request, async (auth) => {
    const row = await loadProject(auth.supabase, auth.user.id, (await ctx.params).id)
    await deleteProject(auth.supabase, createServiceRoleClient(), row)
    return { deleted: true }
  })
}
