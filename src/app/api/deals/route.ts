import { NextRequest } from 'next/server'
import { listContactDeals, reopenWithNewDeal } from '@/lib/server/deal-ops'
import { requireRouteUser } from '@/lib/server/supabase'

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message || fallback)
  }
  return fallback
}

function normalizeText(value: unknown) {
  const normalized = String(value || '').trim()
  return normalized || null
}

function normalizeNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * GET /api/deals?contact_id=X  → storico trattative di un contatto
 * GET /api/deals?open=1        → tutte le trattative aperte del workspace
 *                                (usato dal kanban per titolo/controparte)
 */
export async function GET(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const contactId = normalizeText(request.nextUrl.searchParams.get('contact_id'))
    if (contactId) {
      const deals = await listContactDeals(auth.supabase, auth.workspaceUserId, contactId)
      return Response.json({ deals })
    }

    const openOnly = ['1', 'true'].includes(String(request.nextUrl.searchParams.get('open') || '').toLowerCase())
    if (!openOnly) {
      return Response.json({ error: 'contact_id obbligatorio (oppure open=1)' }, { status: 400 })
    }

    try {
      const { data, error } = await auth.supabase
        .from('deals')
        .select('id, contact_id, title, counterparty, stage, value, created_at')
        .eq('user_id', auth.workspaceUserId)
        .is('closed_at', null)
        .limit(2000)
      if (error) throw error
      return Response.json({ deals: data || [] })
    } catch (error) {
      // Tabella deals non ancora migrata: il kanban funziona senza controparti.
      const message = errorMessage(error, '').toLowerCase()
      if (message.includes('deals') || message.includes('does not exist')) {
        return Response.json({ deals: [] })
      }
      throw error
    }
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Errore caricando le trattative') }, { status: 500 })
  }
}

/**
 * Nuova opportunità (rientro in pipeline): POST /api/deals
 * body: { contact_id, title?, counterparty?, value?, followup_at, note? }
 */
export async function POST(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const body = await request.json()
    const contactId = normalizeText(body.contact_id)
    if (!contactId) {
      return Response.json({ error: 'contact_id obbligatorio' }, { status: 400 })
    }

    const followupAt = normalizeText(body.followup_at)
    if (!followupAt || Number.isNaN(new Date(followupAt).getTime())) {
      return Response.json(
        { error: 'Ogni nuova opportunità deve avere un follow-up (followup_at)' },
        { status: 400 }
      )
    }

    const { data: contact, error: contactError } = await auth.supabase
      .from('contacts')
      .select('id, name, contact_scope')
      .eq('user_id', auth.workspaceUserId)
      .eq('id', contactId)
      .maybeSingle()
    if (contactError) throw contactError
    if (!contact) {
      return Response.json({ error: 'Contatto non trovato' }, { status: 404 })
    }

    const result = await reopenWithNewDeal(auth.supabase, auth.workspaceUserId, contactId, {
      title: normalizeText(body.title),
      counterparty: normalizeText(body.counterparty),
      value: normalizeNumber(body.value),
      followupAt: new Date(followupAt).toISOString(),
      note: normalizeText(body.note),
    })

    return Response.json(result)
  } catch (error) {
    const message = errorMessage(error, 'Errore aprendo la nuova opportunità')
    const status = message.includes('già una trattativa aperta') ? 409 : 500
    return Response.json({ error: message }, { status })
  }
}
