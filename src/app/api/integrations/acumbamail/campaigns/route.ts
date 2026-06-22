import { NextRequest } from 'next/server'
import { parseCsvText, normalizeCsvHeader } from '@/lib/csv-import'
import { isClosedStatus } from '@/lib/data'
import { errorMessage } from '@/lib/server/http'
import { requireRouteUser } from '@/lib/server/supabase'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const EMAIL_HEADERS = new Set(['email', 'mail', 'emailaddress', 'subscriberemail', 'correo'])
const NAME_HEADERS = new Set(['name', 'fullname', 'subscribername', 'nombre', 'nominativo', 'nomecomune'])
const OPEN_HEADERS = new Set([
  'opens',
  'openings',
  'opencount',
  'timesopened',
  'aperture',
  'aperturetotali',
  'numdiaperture',
  'numeroaperture',
  'numerodiaperture',
  'aperturas',
])

type ImportedEngagement = {
  email: string
  name: string | null
  openCount: number
  clickCount: number
}

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

function parseEngagementCsv(csvText: string, kind: 'opens' | 'clicks') {
  if (!csvText.trim()) return [] as ImportedEngagement[]
  const rows = parseCsvText(csvText)
  if (!rows.length) return [] as ImportedEngagement[]
  const headers = Object.keys(rows[0])
  const emailHeader = findHeader(headers, EMAIL_HEADERS)
  const nameHeader = findHeader(headers, NAME_HEADERS)
  const opensHeader = findHeader(headers, OPEN_HEADERS)
  if (!emailHeader) throw new Error(`Colonna email non riconosciuta nel CSV ${kind === 'opens' ? 'aperture' : 'click'}`)

  return rows.flatMap((row) => {
    const email = String(row[emailHeader] || '').trim().toLowerCase()
    if (!EMAIL_RE.test(email)) return []
    const rawOpenCount = opensHeader ? Number(String(row[opensHeader] || '0').replace(',', '.')) : 0
    return [{
      email,
      name: nameHeader ? String(row[nameHeader] || '').trim() || null : null,
      openCount: kind === 'opens' && Number.isFinite(rawOpenCount) ? Math.max(0, Math.round(rawOpenCount)) : 0,
      clickCount: kind === 'clicks' ? 1 : 0,
    }]
  })
}

function parseEmailSet(csvText: string) {
  if (!csvText.trim()) return new Set<string>()
  const rows = parseCsvText(csvText)
  const headers = Object.keys(rows[0] || {})
  const emailHeader = findHeader(headers, EMAIL_HEADERS)
  if (!emailHeader) throw new Error('Colonna email non riconosciuta nel CSV cancellati')
  return new Set(rows.map((row) => String(row[emailHeader] || '').trim().toLowerCase()).filter((email) => EMAIL_RE.test(email)))
}

export async function GET(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error
  if (!auth.isAdmin) return Response.json({ error: 'Solo admin' }, { status: 403 })

  const { data, error } = await auth.supabase
    .from('acumbamail_campaigns')
    .select('id,campaign_key,campaign_id,name,list_name,min_opens,responsible,last_synced_at,last_sync_error,created_at,updated_at')
    .eq('user_id', auth.workspaceUserId)
    .order('updated_at', { ascending: false })
  if (error) return Response.json({ error: error.message }, { status: 500 })

  const campaigns = await Promise.all((data || []).map(async (campaign) => {
    const { data: rows, error: engagementError } = await auth.supabase
      .from('acumbamail_campaign_engagements')
      .select('open_count,click_count,promoted_at')
      .eq('user_id', auth.workspaceUserId)
      .eq('campaign_key', campaign.campaign_key)
    if (engagementError) throw engagementError
    return {
      ...campaign,
      tracked: rows?.length || 0,
      qualified: (rows || []).filter((row) => row.open_count >= campaign.min_opens || row.click_count > 0).length,
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
    const campaignId = String(body.campaign_id || '').trim() || null
    const minOpens = Math.max(1, Math.round(Number(body.min_opens) || 5))
    const opensCsvText = String(body.opens_csv_text || body.csv_text || '')
    const clicksCsvText = String(body.clicks_csv_text || '')
    const unsubscribesCsvText = String(body.unsubscribes_csv_text || '')
    if (!name || !campaignKey || (!opensCsvText.trim() && !clicksCsvText.trim())) {
      return Response.json({ error: 'Nome campagna e almeno un CSV sono obbligatori' }, { status: 400 })
    }

    const openRows = parseEngagementCsv(opensCsvText, 'opens')
    const clickRows = parseEngagementCsv(clicksCsvText, 'clicks')
    const unsubscribedEmails = parseEmailSet(unsubscribesCsvText)
    const merged = new Map<string, ImportedEngagement>()
    for (const row of [...openRows, ...clickRows]) {
      const current = merged.get(row.email) || { email: row.email, name: null, openCount: 0, clickCount: 0 }
      current.name = current.name || row.name
      current.openCount = Math.max(current.openCount, row.openCount)
      current.clickCount = Math.max(current.clickCount, row.clickCount)
      merged.set(row.email, current)
    }

    for (const email of unsubscribedEmails) merged.delete(email)
    const deduped = Array.from(merged.values()).map((row) => {
      const isQualified = row.openCount >= minOpens || row.clickCount > 0
      return {
        user_id: auth.workspaceUserId,
        campaign_key: campaignKey,
        email: row.email,
        name: row.name,
        open_count: row.openCount,
        click_count: row.clickCount,
        promoted_at: isQualified ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      }
    })

    const { error: campaignError } = await auth.supabase.from('acumbamail_campaigns').upsert({
      user_id: auth.workspaceUserId,
      campaign_key: campaignKey,
      name,
      list_name: listName,
      min_opens: minOpens,
      responsible,
      campaign_id: campaignId,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,campaign_key' })
    if (campaignError) throw campaignError

    for (let index = 0; index < deduped.length; index += 200) {
      const { error } = await auth.supabase
        .from('acumbamail_campaign_engagements')
        .upsert(deduped.slice(index, index + 200), { onConflict: 'user_id,campaign_key,email' })
      if (error) throw error
    }

    if (unsubscribedEmails.size > 0) {
      const emails = Array.from(unsubscribedEmails)
      for (let index = 0; index < emails.length; index += 200) {
        const batch = emails.slice(index, index + 200)
        const { error: deleteError } = await auth.supabase
          .from('acumbamail_campaign_engagements')
          .delete()
          .eq('user_id', auth.workspaceUserId)
          .eq('campaign_key', campaignKey)
          .in('email', batch)
        if (deleteError) throw deleteError

        const { data: canceledContacts, error: canceledFindError } = await auth.supabase
          .from('contacts')
          .select('id,list_name')
          .eq('user_id', auth.workspaceUserId)
          .in('email', batch)
        if (canceledFindError) throw canceledFindError
        for (const contact of canceledContacts || []) {
          const { error: canceledUpdateError } = await auth.supabase.from('contacts').update({
            status: 'Lost',
            email_unsubscribed_at: new Date().toISOString(),
            email_unsubscribe_source: 'acumbamail',
            next_action_at: null,
            next_followup_at: null,
            list_name: contact.list_name === listName ? null : contact.list_name,
            updated_at: new Date().toISOString(),
          }).eq('id', contact.id).eq('user_id', auth.workspaceUserId)
          if (canceledUpdateError) throw canceledUpdateError
        }
      }
    }

    const qualified = deduped.filter((row) => row.open_count >= minOpens || row.click_count > 0)
    let promoted = 0
    let excludedUnsubscribed = unsubscribedEmails.size
    for (const row of qualified) {
      const { data: existing, error: findError } = await auth.supabase
        .from('contacts')
        .select('id,status,email_open_count,email_click_count,email_unsubscribed_at')
        .eq('user_id', auth.workspaceUserId)
        .ilike('email', row.email)
        .limit(1)
      if (findError) throw findError
      if (existing?.[0]?.email_unsubscribed_at) {
        excludedUnsubscribed += 1
        await auth.supabase
          .from('acumbamail_campaign_engagements')
          .delete()
          .eq('user_id', auth.workspaceUserId)
          .eq('campaign_key', campaignKey)
          .eq('email', row.email)
        continue
      }

      if (existing?.[0]) {
        const { error } = await auth.supabase.from('contacts').update({
          list_name: listName,
          event_tag: campaignKey,
          source: 'acumbamail',
          contact_scope: 'holding',
          responsible,
          email_open_count: Math.max(Number(existing[0].email_open_count || 0), row.open_count),
          email_click_count: Math.max(Number(existing[0].email_click_count || 0), row.click_count),
          status: isClosedStatus(String(existing[0].status || ''))
            ? existing[0].status
            : row.click_count > 0 ? 'Interested' : 'Contacted',
          priority: row.click_count > 0 ? 3 : 2,
          last_activity_summary: row.click_count > 0
            ? `Click nella campagna Acumbamail ${name}.`
            : `${row.open_count} aperture nella campagna Acumbamail ${name}.`,
          updated_at: new Date().toISOString(),
        }).eq('id', existing[0].id).eq('user_id', auth.workspaceUserId)
        if (error) throw error
      } else {
        const { error } = await auth.supabase.from('contacts').insert({
          user_id: auth.workspaceUserId,
          name: row.name || inferName(row.email),
          email: row.email,
          status: row.click_count > 0 ? 'Interested' : 'Contacted',
          source: 'acumbamail',
          contact_scope: 'holding',
          priority: row.click_count > 0 ? 3 : 2,
          responsible,
          list_name: listName,
          event_tag: campaignKey,
          email_open_count: row.open_count,
          email_click_count: row.click_count,
          note: row.click_count > 0
            ? `Qualificato dalla campagna Acumbamail ${name}: ha cliccato un link.`
            : `Qualificato dalla campagna Acumbamail ${name}: almeno ${minOpens} aperture.`,
          last_activity_summary: row.click_count > 0
            ? `Click nella campagna Acumbamail ${name}.`
            : `${row.open_count} aperture nella campagna Acumbamail ${name}.`,
        })
        if (error) throw error
      }
      promoted += 1
    }

    return Response.json({
      ok: true,
      campaign_key: campaignKey,
      parsed: deduped.length,
      openers: openRows.length,
      clickers: new Set(clickRows.map((row) => row.email)).size,
      qualified: promoted,
      promoted,
      excluded_unsubscribed: excludedUnsubscribed,
    })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Import campagna Acumbamail non riuscito') }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error
  if (!auth.isAdmin) return Response.json({ error: 'Solo admin' }, { status: 403 })
  const body = await request.json().catch(() => ({}))
  const campaignKey = String(body.campaign_key || '').trim()
  const campaignId = String(body.campaign_id || '').trim()
  if (!campaignKey || !campaignId) return Response.json({ error: 'Campagna e ID obbligatori' }, { status: 400 })
  const { error } = await auth.supabase
    .from('acumbamail_campaigns')
    .update({ campaign_id: campaignId, last_sync_error: null, updated_at: new Date().toISOString() })
    .eq('user_id', auth.workspaceUserId)
    .eq('campaign_key', campaignKey)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
