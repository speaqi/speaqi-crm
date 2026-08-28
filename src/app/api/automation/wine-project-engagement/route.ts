import { NextRequest } from 'next/server'
import { collectEmailEvents, fetchAcumbamailFunction, normalizeEmail } from '@/lib/server/acumbamail-api'
import { validateAutomationSecret } from '@/lib/server/automation-auth'
import { errorMessage } from '@/lib/server/http'
import { createServiceRoleClient } from '@/lib/server/supabase'

export async function POST(request: NextRequest) {
  if (!validateAutomationSecret(request)) return Response.json({ error: 'Unauthorized automation' }, { status: 401 })
  const token = process.env.ACUMBAMAIL_AUTH_TOKEN
  if (!token) return Response.json({ error: 'ACUMBAMAIL_AUTH_TOKEN non configurato' }, { status: 500 })
  try {
    const supabase = createServiceRoleClient()
    const { data: campaigns, error } = await supabase
      .from('acumbamail_campaigns')
      .select('user_id,campaign_key,campaign_id')
      .ilike('name', 'Wine Project%')
      .not('campaign_id', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(50)
    if (error) throw error

    let updated = 0
    for (const campaign of campaigns || []) {
      const [opensPayload, clicksPayload] = await Promise.all([
        fetchAcumbamailFunction('getCampaignOpeners', token, String(campaign.campaign_id)),
        fetchAcumbamailFunction('getCampaignClicks', token, String(campaign.campaign_id)),
      ])
      const opens = collectEmailEvents(opensPayload)
      const clicks = collectEmailEvents(clicksPayload)
      const emails = [...new Set([...opens.keys(), ...clicks.keys()])]
      for (const email of emails) {
        const open = opens.get(email)
        const click = clicks.get(email)
        const now = new Date().toISOString()
        await supabase.from('acumbamail_campaign_engagements').upsert({
          user_id: campaign.user_id,
          campaign_key: campaign.campaign_key,
          email,
          name: open?.name || click?.name || null,
          open_count: Number(open?.count || 0),
          click_count: Number(click?.count || 0),
          last_open_at: open?.lastAt || null,
          updated_at: now,
        }, { onConflict: 'user_id,campaign_key,email' })
        const normalized = normalizeEmail(email)
        if (!normalized) continue
        const { data: contact } = await supabase
          .from('contacts')
          .select('id,email_open_count,email_click_count')
          .eq('user_id', campaign.user_id)
          .eq('event_tag', 'wine-project')
          .eq('email', normalized)
          .maybeSingle()
        if (contact) {
          await supabase.from('contacts').update({
            email_open_count: Math.max(Number(contact.email_open_count || 0), Number(open?.count || 0)),
            email_click_count: Math.max(Number(contact.email_click_count || 0), Number(click?.count || 0)),
            last_email_open_at: open?.lastAt || null,
            last_email_click_at: click?.lastAt || null,
            updated_at: now,
          }).eq('id', contact.id)
          updated += 1
        }
      }
      await supabase.from('acumbamail_campaigns').update({ last_synced_at: new Date().toISOString(), last_sync_error: null })
        .eq('user_id', campaign.user_id).eq('campaign_key', campaign.campaign_key)
    }
    return Response.json({ ok: true, campaigns_checked: campaigns?.length || 0, contacts_updated: updated })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Wine Project engagement sync failed') }, { status: 500 })
  }
}
