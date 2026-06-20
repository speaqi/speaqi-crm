import { NextRequest } from 'next/server'
import { requireRouteUser } from '@/lib/server/supabase'

type RouteContext = {
  params: Promise<{ campaignKey: string }>
}

type EngagementRow = {
  email: string
  name?: string | null
  open_count: number
  click_count: number
  last_open_at?: string | null
  promoted_at?: string | null
  updated_at?: string | null
}

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error
  if (!auth.isAdmin) return Response.json({ error: 'Solo admin' }, { status: 403 })

  const { campaignKey } = await context.params
  const normalizedKey = decodeURIComponent(campaignKey).trim()
  const { data: campaign, error: campaignError } = await auth.supabase
    .from('acumbamail_campaigns')
    .select('campaign_key,name,min_opens,list_name')
    .eq('user_id', auth.workspaceUserId)
    .eq('campaign_key', normalizedKey)
    .single()
  if (campaignError) return Response.json({ error: campaignError.message }, { status: 404 })

  const rows: EngagementRow[] = []
  const pageSize = 1000
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await auth.supabase
      .from('acumbamail_campaign_engagements')
      .select('email,name,open_count,click_count,last_open_at,promoted_at,updated_at')
      .eq('user_id', auth.workspaceUserId)
      .eq('campaign_key', normalizedKey)
      .order('click_count', { ascending: false })
      .order('open_count', { ascending: false })
      .range(from, from + pageSize - 1)
    if (error) return Response.json({ error: error.message }, { status: 500 })
    rows.push(...((data || []) as EngagementRow[]))
    if ((data || []).length < pageSize) break
  }

  const minOpens = Number(campaign.min_opens || 5)
  return Response.json({
    campaign,
    rows: rows.map((row) => ({
      ...row,
      qualified: Number(row.click_count || 0) > 0 || Number(row.open_count || 0) >= minOpens,
    })),
    summary: {
      tracked: rows.length,
      openers: rows.filter((row) => Number(row.open_count || 0) > 0).length,
      clickers: rows.filter((row) => Number(row.click_count || 0) > 0).length,
      clickers_under_threshold: rows.filter(
        (row) => Number(row.click_count || 0) > 0 && Number(row.open_count || 0) < minOpens
      ).length,
      qualified: rows.filter(
        (row) => Number(row.click_count || 0) > 0 || Number(row.open_count || 0) >= minOpens
      ).length,
    },
    fetched_at: new Date().toISOString(),
  })
}
