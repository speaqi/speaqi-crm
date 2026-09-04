import { NextRequest } from 'next/server'
import { errorMessage } from '@/lib/server/http'
import { requireRouteUser } from '@/lib/server/supabase'

type RouteContext = { params: Promise<{ id: string }> }

/** Quanti contatti si abilitano al massimo in un colpo solo. */
const MAX_BATCH = 20000

/**
 * Porta i contatti col tag della campagna da `review` a `eligible`.
 *
 * `marketing_eligibility` non e un dettaglio tecnico: dice "a costui posso
 * scrivere". Per questo il passaggio non avviene mai da solo all'import — lo
 * chiede una persona, per una campagna precisa, e resta scritto sul contatto
 * chi lo ha deciso e quando.
 *
 * Non tocca chi e `excluded` o `suppressed`: quelle sono decisioni gia prese,
 * e un import non le ribalta.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error
  if (!auth.isAdmin) return Response.json({ error: 'Admin access required' }, { status: 403 })
  try {
    const { id } = await context.params
    const { data: campaign, error: campaignError } = await auth.supabase
      .from('commercial_campaigns')
      .select('id,name,event_tag')
      .eq('id', id)
      .eq('user_id', auth.workspaceUserId)
      .maybeSingle()
    if (campaignError) throw campaignError
    if (!campaign) return Response.json({ error: 'Campagna non trovata' }, { status: 404 })

    const { data, error } = await auth.supabase
      .from('contacts')
      .update({
        marketing_eligibility: 'eligible',
        marketing_reason: `Abilitato per la campagna ${campaign.name}`,
        marketing_source_acquired_at: new Date().toISOString(),
      })
      .eq('user_id', auth.workspaceUserId)
      .eq('event_tag', campaign.event_tag)
      .eq('marketing_eligibility', 'review')
      .is('email_unsubscribed_at', null)
      .not('email', 'is', null)
      .select('id')
      .limit(MAX_BATCH)
    if (error) throw error

    return Response.json({ enabled: data?.length || 0 })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Abilitazione contatti non riuscita') }, { status: 500 })
  }
}
