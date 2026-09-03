import { NextRequest } from 'next/server'
import { textToHtml } from '@/lib/server/commercial-campaigns'
import { errorMessage } from '@/lib/server/http'
import { requireRouteUser } from '@/lib/server/supabase'

type RouteContext = { params: Promise<{ id: string }> }

export async function PUT(request: NextRequest, context: RouteContext) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error
  if (!auth.isAdmin) return Response.json({ error: 'Admin access required' }, { status: 403 })
  try {
    const { id } = await context.params
    const { data: campaign, error: campaignError } = await auth.supabase
      .from('commercial_campaigns')
      .select('id')
      .eq('id', id)
      .eq('user_id', auth.workspaceUserId)
      .maybeSingle()
    if (campaignError) throw campaignError
    if (!campaign) return Response.json({ error: 'Campagna non trovata' }, { status: 404 })

    const body = await request.json()
    const incoming = Array.isArray(body.steps) ? body.steps : []
    if (!incoming.length) return Response.json({ error: 'Nessuno step da salvare' }, { status: 400 })

    const rows = incoming.map((step: any, index: number) => {
      const text = String(step.body_text_template || '').trim()
      if (!text) throw new Error(`Step ${index + 1}: il testo non puo essere vuoto`)
      return {
        campaign_id: campaign.id,
        step_number: Math.max(1, Math.min(20, Math.floor(Number(step.step_number) || index + 1))),
        day_offset: Math.max(0, Math.floor(Number(step.day_offset) || 0)),
        subject_template: String(step.subject_template || '').trim() || '{{azienda}}',
        body_text_template: text,
        body_html_template: String(step.body_html_template || '').trim() || textToHtml(text),
        only_without_engagement: Boolean(step.only_without_engagement),
      }
    })

    const { data, error } = await auth.supabase
      .from('commercial_campaign_steps')
      .upsert(rows, { onConflict: 'campaign_id,step_number' })
      .select('*')
      .order('step_number')
    if (error) {
      // Il trigger blocca la riscrittura di uno step gia inviato: il testo
      // registrato deve restare quello che il destinatario ha ricevuto.
      if (String(error.message || '').includes('commercial_step_immutable')) {
        return Response.json(
          { error: 'Uno degli step e gia stato inviato e non puo essere modificato' },
          { status: 409 }
        )
      }
      throw error
    }
    return Response.json({ steps: data })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Salvataggio step non riuscito') }, { status: 400 })
  }
}
