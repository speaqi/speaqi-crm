import { NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/server/supabase'
import {
  createWineProjectCampaignToken,
  verifyWineProjectShortLinkToken,
} from '@/lib/server/wine-project-campaign-token'

function firstName(value: string) {
  return String(value || '').trim().split(/\s+/)[0] || ''
}

export async function GET(request: NextRequest) {
  const eventId = verifyWineProjectShortLinkToken(request.nextUrl.searchParams.get('t'))
  if (!eventId) return Response.json({ error: 'Link non valido' }, { status: 400 })

  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from('wine_project_followup_events')
    .select('id,user_id,contact_id,contacts!inner(name,company)')
    .eq('id', eventId)
    .maybeSingle()
  if (error || !data) return Response.json({ error: 'Link non trovato' }, { status: 404 })

  const contact = Array.isArray(data.contacts) ? data.contacts[0] : data.contacts
  const demoAccessToken = process.env.WINE_PROJECT_DEMO_ACCESS_TOKEN
  if (!demoAccessToken) return Response.json({ error: 'WINE_PROJECT_DEMO_ACCESS_TOKEN non configurato' }, { status: 500 })

  const destination = new URL('/demo/wine-project', process.env.WINE_PROJECT_URL || 'https://speaqi.com')
  destination.searchParams.set('access', demoAccessToken)
  destination.searchParams.set('first_name', firstName(contact?.name || ''))
  if (contact?.company) destination.searchParams.set('company_name', contact.company)
  destination.searchParams.set('source', 'acumbamail')
  destination.searchParams.set('campaign', 'wine-project-followup')
  destination.searchParams.set('utm_source', 'acumbamail')
  destination.searchParams.set('utm_medium', 'email')
  destination.searchParams.set('utm_campaign', 'wine-project-followup')
  destination.searchParams.set('campaign_token', createWineProjectCampaignToken({
    user_id: data.user_id,
    contact_id: data.contact_id,
    event_id: data.id,
  }))
  return Response.redirect(destination, 302)
}
