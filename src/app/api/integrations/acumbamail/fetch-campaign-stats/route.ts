import { NextRequest } from 'next/server'
import { errorMessage } from '@/lib/server/http'
import { requireRouteUser } from '@/lib/server/supabase'
import {
  fetchAcumbamailFunction,
  inferContactName,
  slugify,
  normalizeEmail,
  normalizeText,
  isRecord,
} from '@/lib/server/acumbamail-api'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type ParsedEntry = {
  email: string
  name: string | null
  count: number
}

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value)
  if (value === null || value === undefined || value === '') return fallback
  const num = Number(String(value).replace(',', '.').trim())
  return Number.isFinite(num) ? Math.round(num) : fallback
}

function findEmail(value: unknown): string | null {
  if (typeof value === 'string' && EMAIL_RE.test(value.trim())) return value.trim().toLowerCase()
  if (isRecord(value)) {
    for (const key of ['email', 'mail', 'subscriber_email', 'email_address', 'recipient']) {
      const val = value[key]
      if (typeof val === 'string' && EMAIL_RE.test(val.trim())) return val.trim().toLowerCase()
    }
  }
  return null
}

function findName(value: unknown): string | null {
  if (!isRecord(value)) return null
  for (const key of ['name', 'full_name', 'subscriber_name', 'nombre', 'nombre_completo']) {
    const val = value[key]
    if (typeof val === 'string' && val.trim()) return val.trim()
  }
  return null
}

function findCount(value: unknown): number {
  if (typeof value === 'number') return Math.max(0, Math.round(value))
  if (typeof value === 'string') {
    const num = toNumber(value)
    if (num > 0) return num
  }
  if (isRecord(value)) {
    for (const key of ['count', 'total', 'opens', 'open_count', 'clicks', 'click_count', 'times_opened', 'times_clicked']) {
      const val = value[key]
      if (typeof val === 'number' && Number.isFinite(val)) return Math.round(val)
      if (typeof val === 'string') {
        const num = toNumber(val)
        if (num > 0) return num
      }
    }
  }
  return 0
}

function parseAcumbamailResponse(payload: unknown): Map<string, ParsedEntry> {
  const result = new Map<string, ParsedEntry>()

  function merge(email: string, name: string | null, count: number) {
    const existing = result.get(email)
    if (existing) {
      existing.count = Math.max(existing.count, count)
      if (!existing.name && name) existing.name = name
    } else {
      result.set(email, { email, name, count })
    }
  }

  function process(value: unknown, depth = 0) {
    if (depth > 5 || value === null || value === undefined) return

    if (Array.isArray(value)) {
      for (const item of value) process(item, depth + 1)
      return
    }

    if (typeof value === 'string') {
      const email = findEmail(value)
      if (email) merge(email, null, 1)
      return
    }

    if (typeof value === 'number' || typeof value === 'boolean') return

    if (!isRecord(value)) return

    const directEmail = findEmail(value)
    if (directEmail) {
      merge(directEmail, findName(value), Math.max(1, findCount(value)))
      return
    }

    for (const [key, val] of Object.entries(value)) {
      const keyEmail = key.trim().toLowerCase()
      if (EMAIL_RE.test(keyEmail)) {
        if (typeof val === 'number') {
          merge(keyEmail, null, val)
        } else if (typeof val === 'string') {
          const num = toNumber(val)
          merge(keyEmail, null, num > 0 ? num : 1)
        } else if (isRecord(val)) {
          merge(keyEmail, findName(val), Math.max(1, findCount(val)))
        } else {
          merge(keyEmail, null, 1)
        }
      } else {
        process(val, depth + 1)
      }
    }
  }

  process(payload)

  if (result.size === 0) {
    const text = typeof payload === 'string' ? payload : JSON.stringify(payload)
    const emails = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g)
    if (emails) {
      for (const email of emails) {
        merge(email.toLowerCase(), null, 1)
      }
    }
  }

  return result
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

    const openers = parseAcumbamailResponse(openersPayload)
    const clickers = parseAcumbamailResponse(clicksPayload)
    const allEmails = Array.from(new Set([...openers.keys(), ...clickers.keys()])).sort()

    const engagementRows = allEmails.map((email) => {
      const open = openers.get(email)
      const click = clickers.get(email)
      const openCount = open?.count || 0
      const clickCount = click?.count || 0
      const displayName = click?.name || open?.name || inferContactName(email)
      return {
        user_id: auth.workspaceUserId,
        campaign_key: campaignKey,
        email,
        name: displayName,
        open_count: openCount,
        click_count: clickCount,
        last_open_at: null,
        promoted_at: clickCount > 0 || openCount >= minOpens ? new Date().toISOString() : null,
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

    const rows: EngagementRow[] = engagementRows
      .filter((row) => row.click_count > 0 || row.open_count >= minOpens)
      .map((row) => ({
      email: row.email,
      name: row.name,
      open_count: row.open_count,
      click_count: row.click_count,
      last_open_at: row.last_open_at,
      last_click_at: null,
      qualified: row.click_count > 0 || row.open_count >= minOpens,
      contact_id: contactMap.get(row.email) || null,
    }))

    const summary = {
      tracked: rows.length,
      openers: rows.filter((row) => row.open_count > 0).length,
      clickers: rows.filter((row) => row.click_count > 0).length,
      qualified: rows.filter((row) => row.qualified).length,
    }

    return Response.json({
      ok: true,
      campaign_id: campaignId,
      campaign_key: campaignKey,
      campaign_name: name,
      rows,
      summary,
      fetched_at: new Date().toISOString(),
      _debug_openers_sample: JSON.stringify(openersPayload).slice(0, 500),
      _debug_clicks_sample: JSON.stringify(clicksPayload).slice(0, 500),
    })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Recupero dati Acumbamail non riuscito') }, { status: 500 })
  }
}
