import { NextRequest } from 'next/server'
import { errorMessage } from '@/lib/server/http'
import { requireRouteUser } from '@/lib/server/supabase'
import {
  collectEmailEvents,
  fetchAcumbamailFunction,
  inferContactName,
  laterTimestamp,
  slugify,
  normalizeEmail,
  normalizeText,
} from '@/lib/server/acumbamail-api'

function chunk<T>(items: T[], size = 200) {
  const batches: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size))
  }
  return batches
}

type EngagementRow = {
  email: string
  name: string | null
  open_count: number
  click_count: number
  last_open_at: string | null
  last_click_at: string | null
  qualified: boolean
  contact_id: string | null
}

export async function POST(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error
  if (!auth.isAdmin) return Response.json({ error: 'Solo admin puo recuperare dati Acumbamail' }, { status: 403 })

  try {
    const token = process.env.ACUMBAMAIL_AUTH_TOKEN
    if (!token) {
      return Response.json({ error: 'ACUMBAMAIL_AUTH_TOKEN non configurato' }, { status: 500 })
    }

    const body = await request.json().catch(() => ({}))
    const campaignId = normalizeText(body.campaign_id)
    if (!campaignId) return Response.json({ error: 'campaign_id obbligatorio' }, { status: 400 })

    const name = normalizeText(body.name) || `Campagna ${campaignId}`
    const campaignKey = slugify(body.campaign_key || name)
    const minOpens = Math.max(1, Math.round(Number(body.min_opens) || 5))
    const listName = normalizeText(body.list_name) || 'Acumbamail'
    const responsible = normalizeText(body.responsible) || null

    const [openersPayload, clicksPayload] = await Promise.all([
      fetchAcumbamailFunction('getCampaignOpeners', token, campaignId),
      fetchAcumbamailFunction('getCampaignClicks', token, campaignId),
    ])

    const openers = collectEmailEvents(openersPayload)
    const clickers = collectEmailEvents(clicksPayload)
    const allEmails = Array.from(new Set([...openers.keys(), ...clickers.keys()])).sort()

    // Acumbamail's getCampaignOpeners/getCampaignClicks only report "opened/clicked at least
    // once" (no per-subscriber count), so the real repeat counts come from webhook events
    // accumulated over time in acumbamail_campaign_engagements. Merge with the max of the two.
    const existingByEmail = new Map<string, { name: string | null; open_count: number; click_count: number; last_open_at: string | null; promoted_at: string | null }>()
    for (const batch of chunk(allEmails)) {
      const { data: existingEngagements, error: existingEngagementsError } = await auth.supabase
        .from('acumbamail_campaign_engagements')
        .select('email,name,open_count,click_count,last_open_at,promoted_at')
        .eq('user_id', auth.workspaceUserId)
        .eq('campaign_key', campaignKey)
        .in('email', batch)
      if (existingEngagementsError) throw existingEngagementsError
      for (const row of existingEngagements || []) {
        existingByEmail.set(String(row.email || '').toLowerCase(), row)
      }
    }

    const engagementRows = allEmails.map((email) => {
      const open = openers.get(email)
      const click = clickers.get(email)
      const existing = existingByEmail.get(email)
      const openCount = Math.max(Number(existing?.open_count || 0), Number(open?.count || 0))
      const clickCount = Math.max(Number(existing?.click_count || 0), Number(click?.count || 0))
      const displayName = existing?.name || click?.name || open?.name || inferContactName(email)
      return {
        user_id: auth.workspaceUserId,
        campaign_key: campaignKey,
        email,
        name: displayName,
        open_count: openCount,
        click_count: clickCount,
        last_open_at: laterTimestamp(existing?.last_open_at || null, open?.lastAt || null),
        promoted_at:
          existing?.promoted_at || (clickCount > 0 || openCount >= minOpens ? new Date().toISOString() : null),
        updated_at: new Date().toISOString(),
      }
    })

    await auth.supabase.from('acumbamail_campaigns').upsert({
      user_id: auth.workspaceUserId,
      campaign_key: campaignKey,
      name,
      list_name: listName,
      min_opens: minOpens,
      responsible,
      campaign_id: campaignId,
      updated_at: new Date().toISOString(),
      last_synced_at: new Date().toISOString(),
      last_sync_error: null,
    }, { onConflict: 'user_id,campaign_key' })

    for (let index = 0; index < engagementRows.length; index += 200) {
      const batch = engagementRows.slice(index, index + 200)
      const { error } = await auth.supabase
        .from('acumbamail_campaign_engagements')
        .upsert(batch, { onConflict: 'user_id,campaign_key,email' })
      if (error) throw error
    }

    const emailList = allEmails
    const contactMap = new Map<string, string>()
    for (let index = 0; index < emailList.length; index += 200) {
      const batch = emailList.slice(index, index + 200)
      const { data: existingContacts } = await auth.supabase
        .from('contacts')
        .select('id,email')
        .eq('user_id', auth.workspaceUserId)
        .in('email', batch)
      for (const contact of (existingContacts || [])) {
        const normalized = normalizeEmail(contact.email)
        if (normalized) contactMap.set(normalized, contact.id)
      }
    }

    const rows: EngagementRow[] = engagementRows.map((row) => ({
      email: row.email,
      name: row.name,
      open_count: row.open_count,
      click_count: row.click_count,
      last_open_at: row.last_open_at,
      last_click_at: null,
      qualified: row.click_count > 0 || row.open_count >= minOpens,
      contact_id: contactMap.get(row.email) || null,
    }))

    const allTracked = rows.length
    const allOpeners = rows.filter((row) => row.open_count > 0).length
    const allClickers = rows.filter((row) => row.click_count > 0).length

    const summary = {
      tracked: allTracked,
      openers: allOpeners,
      clickers: allClickers,
      qualified: rows.filter((row) => row.qualified).length,
    }

    return Response.json({
      ok: true,
      campaign_id: campaignId,
      campaign_key: campaignKey,
      campaign_name: name,
      min_opens: minOpens,
      rows,
      summary,
      fetched_at: new Date().toISOString(),
    })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Recupero dati Acumbamail non riuscito') }, { status: 500 })
  }
}
