import { NextRequest } from 'next/server'
import {
  campaignSlug,
  ensureCampaignSteps,
  type CommercialCampaign,
} from '@/lib/server/commercial-campaigns'
import { errorMessage } from '@/lib/server/http'
import { requireRouteUser } from '@/lib/server/supabase'

export async function GET(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error
  try {
    const vertical = request.nextUrl.searchParams.get('vertical')
    let query = auth.supabase
      .from('commercial_campaigns')
      .select('*')
      .eq('user_id', auth.workspaceUserId)
      .order('vertical')
      .order('created_at', { ascending: false })
    if (vertical) query = query.eq('vertical', vertical)

    const { data: campaigns, error } = await query
    if (error) throw error

    const ids = (campaigns || []).map((campaign: any) => campaign.id)
    const progress = ids.length ? await loadProgress(auth.supabase, ids) : new Map()

    return Response.json({
      campaigns: (campaigns || []).map((campaign: any) => ({
        ...campaign,
        progress: progress.get(campaign.id) || { enrollments: 0, active: 0, sent: 0, replied: 0 },
      })),
    })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Elenco campagne non disponibile') }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error
  if (!auth.isAdmin) return Response.json({ error: 'Admin access required' }, { status: 403 })
  try {
    const body = await request.json().catch(() => ({}))
    const name = String(body.name || '').trim()
    const vertical = String(body.vertical || '').trim().toLowerCase()
    const eventTag = String(body.event_tag || '').trim()
    if (!name || !vertical || !eventTag) {
      return Response.json({ error: 'Nome, verticale e tag contatti sono obbligatori' }, { status: 400 })
    }

    const slug = campaignSlug(body.slug || `${vertical}-${name}`)
    if (!slug) return Response.json({ error: 'Slug non valido' }, { status: 400 })

    const { data: campaign, error } = await auth.supabase
      .from('commercial_campaigns')
      .insert({
        user_id: auth.workspaceUserId,
        vertical,
        name,
        slug,
        list_name: String(body.list_name || name).trim(),
        event_tag: eventTag,
        // Invio spento alla nascita: nessuna campagna spedisce prima che
        // qualcuno l'abbia guardata e attivata deliberatamente.
        status: 'paused',
        approval_status: 'analysis',
        sender_name: String(body.sender_name || 'Massimo Morgante').trim(),
        sender_email: String(body.sender_email || 'info@speaqi.com').trim(),
        reply_to: body.reply_to ? String(body.reply_to).trim() : null,
        brand_eyebrow: body.brand_eyebrow ? String(body.brand_eyebrow).trim() : `SPEAQI · ${vertical.toUpperCase()}`,
        landing_url: body.landing_url ? String(body.landing_url).trim() : null,
      })
      .select('*')
      .single()
    if (error) {
      if (String(error.code) === '23505') {
        return Response.json({ error: 'Esiste gia una campagna con questo nome o slug' }, { status: 409 })
      }
      throw error
    }

    // Nasce utilizzabile, non vuota: cinque step precompilati da riscrivere.
    const steps = await ensureCampaignSteps(auth.supabase, campaign as CommercialCampaign)
    return Response.json({ campaign, steps }, { status: 201 })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Creazione campagna non riuscita') }, { status: 500 })
  }
}

async function loadProgress(supabase: any, campaignIds: string[]) {
  const [{ data: enrollments, error: enrollmentError }, { data: messages, error: messageError }] = await Promise.all([
    supabase.from('commercial_enrollments').select('campaign_id,status,replied_at').in('campaign_id', campaignIds),
    supabase
      .from('commercial_messages')
      .select('status,commercial_enrollments!inner(campaign_id)')
      .in('commercial_enrollments.campaign_id', campaignIds)
      .eq('status', 'sent'),
  ])
  if (enrollmentError) throw enrollmentError
  if (messageError) throw messageError

  const map = new Map<string, { enrollments: number; active: number; sent: number; replied: number }>()
  const bucket = (id: string) => {
    if (!map.has(id)) map.set(id, { enrollments: 0, active: 0, sent: 0, replied: 0 })
    return map.get(id)!
  }
  for (const row of enrollments || []) {
    const entry = bucket(row.campaign_id)
    entry.enrollments += 1
    if (row.status === 'pending' || row.status === 'active') entry.active += 1
    if (row.replied_at) entry.replied += 1
  }
  for (const row of messages || []) {
    const campaignId = (row as any).commercial_enrollments?.campaign_id
    if (campaignId) bucket(campaignId).sent += 1
  }
  return map
}
