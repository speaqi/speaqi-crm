import { NextRequest } from 'next/server'
import { ensureCampaignSteps, type CommercialCampaign } from '@/lib/server/commercial-campaigns'
import { errorMessage } from '@/lib/server/http'
import { requireRouteUser } from '@/lib/server/supabase'

type RouteContext = { params: Promise<{ id: string }> }

// Slug e verticale non sono modificabili: entrano nelle chiavi Acumbamail e
// negli UTM delle email gia partite. Il database lo impone con un trigger,
// questa lista lo dice prima.
const EDITABLE = new Set([
  'name', 'list_name', 'status', 'daily_cap', 'daily_enrollment_cap',
  'sender_name', 'sender_email', 'reply_to', 'acumbamail_list_id',
  'cadence_days', 'stop_on_open', 'stop_on_click',
  'automatic_pause_bounce_rate', 'automatic_pause_complaint_rate',
  'approval_status', 'approval_note', 'pilot_started_at',
  'brand_eyebrow', 'landing_url',
  'import_exclude_keyword', 'import_required_country',
  'require_marketing_attestation',
])

/** Filtri assenti: la stringa vuota dell'input diventa NULL, non "". */
const NULLABLE = new Set(['import_exclude_keyword', 'import_required_country', 'reply_to', 'landing_url', 'acumbamail_list_id'])

async function loadCampaign(supabase: any, userId: string, id: string) {
  const { data, error } = await supabase
    .from('commercial_campaigns')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  return data as CommercialCampaign | null
}

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error
  try {
    const { id } = await context.params
    const campaign = await loadCampaign(auth.supabase, auth.workspaceUserId, id)
    if (!campaign) return Response.json({ error: 'Campagna non trovata' }, { status: 404 })

    const [steps, enrollments, messages, counter, taggedContacts] = await Promise.all([
      ensureCampaignSteps(auth.supabase, campaign),
      auth.supabase
        .from('commercial_enrollments')
        .select('status,stop_reason,opened_at,clicked_at,replied_at,hard_bounced_at,unsubscribed_at,complained_at')
        .eq('campaign_id', campaign.id),
      auth.supabase
        .from('commercial_messages')
        .select('id,step_number,status,recipient_email,scheduled_at,sent_at,error,commercial_enrollments!inner(campaign_id)')
        .eq('commercial_enrollments.campaign_id', campaign.id)
        .order('scheduled_at', { ascending: false })
        .limit(25),
      auth.supabase
        .from('commercial_campaign_daily_counters')
        .select('enrolled_reserved,enrolled_count,local_day')
        .eq('campaign_id', campaign.id)
        .order('local_day', { ascending: false })
        .limit(1)
        .maybeSingle(),
      auth.supabase
        .from('contacts')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', auth.workspaceUserId)
        .eq('event_tag', campaign.event_tag),
    ])
    if (enrollments.error) throw enrollments.error
    if (messages.error) throw messages.error
    if (counter.error) throw counter.error
    if (taggedContacts.error) throw taggedContacts.error

    const rows = enrollments.data || []
    const count = (key: string, value?: string) =>
      rows.filter((row: any) => (value === undefined ? Boolean(row[key]) : row[key] === value)).length

    return Response.json({
      campaign,
      steps,
      recent_messages: messages.data || [],
      metrics: {
        pool: taggedContacts.count || 0,
        enrollments: rows.length,
        active: count('status', 'pending') + count('status', 'active'),
        stopped: count('status', 'stopped'),
        completed: count('status', 'completed'),
        sent: (messages.data || []).filter((row: any) => row.status === 'sent').length,
        opened: count('opened_at'),
        clicked: count('clicked_at'),
        replied: count('replied_at'),
        hard_bounces: count('hard_bounced_at'),
        unsubscribes: count('unsubscribed_at'),
        complaints: count('complained_at'),
        enrolled_today:
          counter.data?.local_day === new Date().toISOString().slice(0, 10)
            ? (Number(counter.data?.enrolled_count) || 0) + (Number(counter.data?.enrolled_reserved) || 0)
            : 0,
      },
      readiness: {
        acumbamail_api: Boolean(process.env.ACUMBAMAIL_AUTH_TOKEN),
        send_enabled: process.env.COMMERCIAL_OUTREACH_SEND_ENABLED === 'true',
      },
    })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Campagna non disponibile') }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error
  if (!auth.isAdmin) return Response.json({ error: 'Admin access required' }, { status: 403 })
  try {
    const { id } = await context.params
    const campaign = await loadCampaign(auth.supabase, auth.workspaceUserId, id)
    if (!campaign) return Response.json({ error: 'Campagna non trovata' }, { status: 404 })

    const body = await request.json()
    const updates: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(body)) {
      if (!EDITABLE.has(key)) continue
      updates[key] = NULLABLE.has(key) && !String(value ?? '').trim() ? null : value
    }
    if (!Object.keys(updates).length) return Response.json({ campaign })

    if (updates.status === 'active') {
      const approval = (updates.approval_status as string) || campaign.approval_status
      if (approval !== 'approved') {
        return Response.json({ error: 'Serve l’approvazione prima di attivare la campagna' }, { status: 409 })
      }
    }
    if (updates.approval_status === 'approved') {
      updates.approved_at = new Date().toISOString()
      updates.approved_by = auth.user.id
    }

    const { data, error } = await auth.supabase
      .from('commercial_campaigns')
      .update(updates)
      .eq('id', campaign.id)
      .eq('user_id', auth.workspaceUserId)
      .select('*')
      .single()
    if (error) {
      if (String(error.message || '').includes('commercial_campaign_slug_immutable')) {
        return Response.json({ error: 'Lo slug di una campagna non si puo cambiare' }, { status: 409 })
      }
      throw error
    }
    return Response.json({ campaign: data })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Aggiornamento campagna non riuscito') }, { status: 500 })
  }
}
