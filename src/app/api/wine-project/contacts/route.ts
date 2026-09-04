import { NextRequest } from 'next/server'
import { errorMessage } from '@/lib/server/http'
import { requireRouteUser } from '@/lib/server/supabase'

const ENGAGEMENTS = ['all', 'opened', 'clicked', 'silent'] as const
type Engagement = (typeof ENGAGEMENTS)[number]

/**
 * Le cantine della campagna filtrate per reazione all'email. Le statistiche in
 * pagina dicono quante aperture e quanti click ci sono stati, non chi li ha
 * fatti: senza questa lista quei numeri non sono lavorabili.
 */
export async function GET(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error
  if (!auth.isAdmin) return Response.json({ error: 'Solo admin' }, { status: 403 })

  const url = new URL(request.url)
  const requested = String(url.searchParams.get('engagement') || 'all')
  const engagement: Engagement = (ENGAGEMENTS as readonly string[]).includes(requested)
    ? (requested as Engagement)
    : 'all'
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || 200))

  try {
    let query = auth.supabase
      .from('contacts')
      .select('id, name, company, email, status, email_open_count, email_click_count, last_email_open_at, last_email_click_at, last_contact_at', {
        count: 'exact',
      })
      .eq('user_id', auth.workspaceUserId)
      .eq('event_tag', 'wine-project')

    if (engagement === 'opened') query = query.gt('email_open_count', 0)
    if (engagement === 'clicked') query = query.gt('email_click_count', 0)
    if (engagement === 'silent') {
      // Nessuna reazione tracciata: la coda su cui insistere.
      query = query
        .or('email_open_count.is.null,email_open_count.eq.0')
        .or('email_click_count.is.null,email_click_count.eq.0')
    }

    const { data, error, count } = await query
      .order('email_click_count', { ascending: false, nullsFirst: false })
      .order('email_open_count', { ascending: false, nullsFirst: false })
      .order('last_contact_at', { ascending: false, nullsFirst: false })
      .limit(limit)
    if (error) throw error

    return Response.json({ engagement, total: count || 0, contacts: data || [] })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Impossibile caricare le cantine') }, { status: 500 })
  }
}
