import { NextRequest } from 'next/server'
import { AgencyInputError, agencyBody, agencyRoute, loadPresentation, presentationView, setApproval } from '@/lib/server/agency'
import { createServiceRoleClient } from '@/lib/server/supabase'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** { approve: true } approva (solo senza [DA VERIFICARE]); il link pubblico si accende. { approve: false } la riporta in revisione. */
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return agencyRoute(request, async (auth) => {
    const body = await agencyBody(request)
    if (typeof body.approve !== 'boolean') throw new AgencyInputError('approve richiesto')
    const row = await loadPresentation(auth.supabase, auth.user.id, (await ctx.params).id)
    const saved = await setApproval(auth.supabase, row, body.approve)
    if (body.approve) {
      await auth.supabase.from('agency_projects').update({ stage: 'negotiation', updated_at: new Date().toISOString() }).eq('user_id', row.user_id).eq('id', row.project_id).in('stage', ['brief', 'proposal'])
    }
    return presentationView(auth.supabase, createServiceRoleClient(), saved)
  })
}
