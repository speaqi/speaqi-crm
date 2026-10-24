import { NextRequest } from 'next/server'
import { requireWorkspaceOwner } from '@/lib/server/owner-auth'
import { errorMessage } from '@/lib/server/http'
import { opportunityPatch, STAGE_LABELS, type OpportunityStage } from '@/lib/opportunities'

/** Prossimo passo, responsabile, fase (solo fuori dalle vendite), guida, ente, prove. */
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireWorkspaceOwner(request)
  if ('error' in auth) return auth.error!
  const { id } = await context.params
  try {
    const { data: current, error } = await auth.admin.from('deals').select('*').eq('user_id', auth.userId).eq('id', id).maybeSingle()
    if (error) throw error
    if (!current) return Response.json({ error: 'Opportunità non trovata' }, { status: 404 })
    let patch: Record<string, unknown>
    try {
      patch = opportunityPatch(await request.json().catch(() => null), { ...current, pipeline: current.pipeline || 'vendite' })
    } catch (err) {
      return Response.json({ error: errorMessage(err, 'Modifica non valida') }, { status: 400 })
    }
    const { data, error: updateError } = await auth.admin.from('deals').update(patch).eq('user_id', auth.userId).eq('id', id).select('*').single()
    if (updateError) {
      if ((updateError as { code?: string }).code === '23505') return Response.json({ error: 'Il contatto ha già un’opportunità aperta in questa pipeline' }, { status: 409 })
      throw updateError
    }
    if (patch.stage && patch.stage !== current.stage) {
      await auth.admin.from('activities').insert({ user_id: auth.userId, contact_id: current.contact_id, type: 'system',
        content: `Opportunità «${current.title}»: ${STAGE_LABELS[current.stage as OpportunityStage] || current.stage} → ${STAGE_LABELS[patch.stage as OpportunityStage]}.`,
        metadata: { event: 'opportunity_stage', deal_id: id, from: current.stage, to: patch.stage } })
    }
    return Response.json({ opportunity: data })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Opportunità non aggiornata') }, { status: 500 })
  }
}
