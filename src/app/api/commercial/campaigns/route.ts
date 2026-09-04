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
        // Hospitality ha ancora la sua scheda dedicata accanto a quella
        // generica, finche non viene ritirata.
        legacy_page: campaign.vertical === 'hospitality' ? '/hospitality' : null,
      })),
      external_projects: vertical ? [] : await loadExternalProjects(auth.supabase, auth.workspaceUserId),
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

/**
 * Progetti commerciali che girano su tabelle proprie e non su
 * `commercial_campaigns`.
 *
 * Oggi solo Wine Project, che resta sul suo motore finche non lo si migra.
 * Compare comunque qui, coi suoi numeri veri, perche l'area Commerciale deve
 * essere l'unico posto dove si vede tutto il commerciale: un progetto
 * raggiungibile solo digitando l'URL e un progetto che prima o poi si dimentica.
 */
async function loadExternalProjects(supabase: any, userId: string) {
  try {
    const [settings, pool, scheduled, queued] = await Promise.all([
      supabase.from('wine_project_automation_settings').select('enabled,campaign_name').eq('user_id', userId).maybeSingle(),
      supabase.from('contacts').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('event_tag', 'wine-project'),
      supabase.from('wine_project_followup_events').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'scheduled'),
      supabase.from('wine_project_followup_events').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'queued'),
    ])
    if (settings.error && String(settings.error.code) !== 'PGRST116') throw settings.error
    return [
      {
        key: 'wine-project',
        vertical: 'wine',
        name: settings.data?.campaign_name || 'Wine Project',
        href: '/impostazioni/wine-project',
        status: settings.data?.enabled ? 'active' : 'paused',
        note: 'Motore proprio: la migrazione su commercial_* e un lavoro separato.',
        progress: {
          enrollments: scheduled.count || 0,
          active: scheduled.count || 0,
          sent: queued.count || 0,
          pool: pool.count || 0,
        },
      },
    ]
  } catch {
    // Un progetto esterno non leggibile non deve far sparire l'elenco delle
    // campagne vere.
    return []
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
