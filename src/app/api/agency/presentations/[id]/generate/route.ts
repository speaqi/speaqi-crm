import { NextRequest } from 'next/server'
import { agencyBody, agencyRoute, claimGeneration, inBackground, loadPresentation, presentationView, runGeneration } from '@/lib/server/agency'
import { createServiceRoleClient } from '@/lib/server/supabase'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Rigenera da capo con l'agente (rilegge brief e materiali). Risponde subito: lo stato passa a "In generazione". */
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return agencyRoute(request, async (auth) => {
    const body = await agencyBody(request).catch(() => ({}) as Record<string, unknown>)
    const row = await loadPresentation(auth.supabase, auth.user.id, (await ctx.params).id)
    const service = createServiceRoleClient()
    const claimed = await claimGeneration(auth.supabase, row)
    inBackground('generazione', () => runGeneration(auth.supabase, service, claimed, typeof body.instruction === 'string' ? body.instruction : undefined))
    return presentationView(auth.supabase, service, claimed)
  })
}
