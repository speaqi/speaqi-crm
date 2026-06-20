import { NextRequest } from 'next/server'
import { parseCsvText, normalizeCsvHeader } from '@/lib/csv-import'
import { errorMessage } from '@/lib/server/http'
import { requireRouteUser } from '@/lib/server/supabase'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const EMAIL_HEADERS = new Set(['email', 'mail', 'emailaddress', 'subscriberemail', 'correo'])
const NAME_HEADERS = new Set(['name', 'fullname', 'subscribername', 'nombre', 'nominativo'])
const OPEN_HEADERS = new Set([
  'opens',
  'openings',
  'opencount',
  'timesopened',
  'aperture',
  'aperturetotali',
  'numeroaperture',
  'numerodiaperture',
  'aperturas',
])

function slugify(value: unknown) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

function findHeader(headers: string[], aliases: Set<string>) {
  return headers.find((header) => aliases.has(normalizeCsvHeader(header))) || null
}

function inferName(email: string) {
  const local = email.split('@')[0].replace(/[._-]+/g, ' ').trim()
  return local
    ? local.split(/\s+/).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
    : email
}

export async function GET(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error
  if (!auth.isAdmin) return Response.json({ error: 'Solo admin' }, { status: 403 })

  const { data, error } = await auth.supabase
    .from('acumbamail_campaigns')
    .select('id,campaign_key,name,list_name,min_opens,responsible,created_at,updated_at')
    .eq('user_id', auth.workspaceUserId)
    .order('updated_at', { ascending: false })
  if (error) return Response.json({ error: error.message }, { status: 500 })

  const campaigns = await Promise.all((data || []).map(async (campaign) => {
    const { data: rows, error: engagementError } = await auth.supabase
      .from('acumbamail_campaign_engagements')
      .select('open_count,promoted_at')
      .eq('user_id', auth.workspaceUserId)
      .eq('campaign_key', campaign.campaign_key)
    if (engagementError) throw engagementError
    return {
      ...campaign,
      tracked: rows?.length || 0,
      qualified: (rows || []).filter((row) => row.open_count >= campaign.min_opens).length,
      webhook_url: (() => {
        const token = process.env.ACUMBAMAIL_WEBHOOK_TOKEN
        if (!token) return null
        const url = new URL('/api/integrations/acumbamail/webhook', request.nextUrl.origin)
        url.searchParams.set('t', token)
        url.searchParams.set('u', auth.workspaceUserId)
        url.searchParams.set('s', 'holding')
        url.searchParams.set('e', 'opens,clicks,unsubscribes')
        url.searchParams.set('l', campaign.list_name)
        url.searchParams.set('tag', campaign.campaign_key)
        url.searchParams.set('m', String(campaign.min_opens))
        if (campaign.responsible) url.searchParams.set('r', campaign.responsible)
        return url.toString()
      })(),
    }
  }))

  return Response.json({ campaigns })
}

export async function POST(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error
  if (!auth.isAdmin) return Response.json({ error: 'Solo admin' }, { status: 403 })

  try {
    const body = await request.json()
    const name = String(body.name || '').trim()
    const campaignKey = slugify(body.campaign_key || name)
    const listName = String(body.list_name || 'Comuni').trim()
    const responsible = String(body.responsible || '').trim() || null
    const minOpens = Math.max(1, Math.round(Number(body.min_opens) || 5))
    const csvText = String(body.csv_text || '')
    if (!name || !campaignKey || !csvText.trim()) {
      return Response.json({ error: 'Nome campagna e CSV sono obbligatori' }, { status: 400 })
    }

    const rows = parseCsvText(csvText)
    if (!rows.length) return Response.json({ error: 'Il CSV non contiene righe' }, { status: 400 })
    const headers = Object.keys(rows[0])
    const emailHeader = findHeader(headers, EMAIL_HEADERS)
    const nameHeader = findHeader(headers, NAME_HEADERS)
    const opensHeader = findHeader(headers, OPEN_HEADERS)
    if (!emailHeader) return Response.json({ error: 'Colonna email non riconosciuta nel CSV' }, { status: 400 })

    const parsed = rows.flatMap((row) => {
      const email = String(row[emailHeader] || '').trim().toLowerCase()
      if (!EMAIL_RE.test(email)) return []
      const rawCount = opensHeader ? Number(String(row[opensHeader] || '0').replace(',', '.')) : 0
      return [{
        user_id: auth.workspaceUserId,
        campaign_key: campaignKey,
        email,
        name: nameHeader ? String(row[nameHeader] || '').trim() || null : null,
        open_count: Number.isFinite(rawCount) ? Math.max(0, Math.round(rawCount)) : 0,
        promoted_at: Number.isFinite(rawCount) && rawCount >= minOpens ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      }]
    })

    const deduped = Array.from(new Map(parsed.map((row) => [row.email, row])).values())
    const { error: campaignError } = await auth.supabase.from('acumbamail_campaigns').upsert({
      user_id: auth.workspaceUserId,
      campaign_key: campaignKey,
      name,
      list_name: listName,
      min_opens: minOpens,
      responsible,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,campaign_key' })
    if (campaignError) throw campaignError

    for (let index = 0; index < deduped.length; index += 200) {
      const { error } = await auth.supabase
        .from('acumbamail_campaign_engagements')
        .upsert(deduped.slice(index, index + 200), { onConflict: 'user_id,campaign_key,email' })
      if (error) throw error
    }

    const qualified = deduped.filter((row) => row.open_count >= minOpens)
    let promoted = 0
    for (const row of qualified) {
      const { data: existing, error: findError } = await auth.supabase
        .from('contacts')
        .select('id,email_open_count')
        .eq('user_id', auth.workspaceUserId)
        .ilike('email', row.email)
        .limit(1)
      if (findError) throw findError

      if (existing?.[0]) {
        const { error } = await auth.supabase.from('contacts').update({
          list_name: listName,
          event_tag: campaignKey,
          source: 'acumbamail',
          contact_scope: 'holding',
          responsible,
          email_open_count: Math.max(Number(existing[0].email_open_count || 0), row.open_count),
          updated_at: new Date().toISOString(),
        }).eq('id', existing[0].id).eq('user_id', auth.workspaceUserId)
        if (error) throw error
      } else {
        const { error } = await auth.supabase.from('contacts').insert({
          user_id: auth.workspaceUserId,
          name: row.name || inferName(row.email),
          email: row.email,
          status: 'Contacted',
          source: 'acumbamail',
          contact_scope: 'holding',
          priority: 2,
          responsible,
          list_name: listName,
          event_tag: campaignKey,
          email_open_count: row.open_count,
          note: `Qualificato dalla campagna Acumbamail ${name}: almeno ${minOpens} aperture.`,
          last_activity_summary: `${row.open_count} aperture nella campagna Acumbamail ${name}.`,
        })
        if (error) throw error
      }
      promoted += 1
    }

    return Response.json({
      ok: true,
      campaign_key: campaignKey,
      parsed: deduped.length,
      qualified: qualified.length,
      promoted,
    })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Import campagna Acumbamail non riuscito') }, { status: 500 })
  }
}
