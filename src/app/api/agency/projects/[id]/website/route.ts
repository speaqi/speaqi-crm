import { NextRequest } from 'next/server'
import { AgencyInputError, agencyBody, agencyRoute, importWebsite, loadProject, projectView } from '@/lib/server/agency'
import { createServiceRoleClient } from '@/lib/server/supabase'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/** Legge il sito del cliente e lo salva fra i materiali (sostituisce una lettura precedente dello stesso sito). */
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return agencyRoute(request, async (auth) => {
    const body = await agencyBody(request)
    const url = typeof body.url === 'string' ? body.url.trim() : ''
    if (!url) throw new AgencyInputError('Indica l’indirizzo del sito')
    const row = await loadProject(auth.supabase, auth.user.id, (await ctx.params).id)
    const service = createServiceRoleClient()
    const site = await importWebsite(auth.supabase, service, row, url)
    return { ...(await projectView(auth.supabase, service, row)), website_truncated: site.truncated }
  })
}
