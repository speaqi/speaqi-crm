import { NextRequest } from 'next/server'
import { AgencyInputError, agencyBody, agencyRoute, claimGeneration, inBackground, loadPresentation, presentationView, runRevision, text } from '@/lib/server/agency'
import { createServiceRoleClient } from '@/lib/server/supabase'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Revisione in linguaggio naturale ("più istituzionale, aggiungi una roadmap di sei mesi,
 * togli la parte economica"): l'agente restituisce solo le operazioni necessarie e le altre
 * slide restano come sono. Lavora dopo la risposta, come la generazione.
 */
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return agencyRoute(request, async (auth) => {
    const body = await agencyBody(request)
    const instruction = text(body.instruction, 2000)
    if (instruction.length < 3) throw new AgencyInputError('Scrivi cosa cambiare')
    const row = await loadPresentation(auth.supabase, auth.user.id, (await ctx.params).id)
    if (Number.isInteger(body.version) && body.version !== row.version) throw new Error('Version conflict: la presentazione è cambiata, salva o ricarica prima di chiedere una revisione.')
    const service = createServiceRoleClient()
    const claimed = await claimGeneration(auth.supabase, row)
    inBackground('revisione', () => runRevision(auth.supabase, service, claimed, instruction))
    return presentationView(auth.supabase, service, claimed)
  })
}
