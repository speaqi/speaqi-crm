import { NextRequest } from 'next/server'
import { errorMessage } from '@/lib/server/http'
import { requireRouteUser } from '@/lib/server/supabase'
import { normalizeReceivableName, parseReceivableAmount } from '@/lib/receivables'

/**
 * Soldi da ricevere (/incassi). Area personale, fuori da Speaqi: ogni riga e'
 * di chi l'ha scritta (`auth.user.id`), non del workspace, e la RLS
 * `user_id = auth.uid()` lo garantisce anche se qui ci si dimenticasse un filtro.
 */

function normalizeRow(row: Record<string, unknown>) {
  return { ...row, amount: Number(row.amount) || 0 }
}

export async function GET(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const { data, error } = await auth.supabase
      .from('receivables')
      .select('*')
      .eq('user_id', auth.user.id)
      .order('created_at', { ascending: true })

    if (error) throw error
    return Response.json({ receivables: (data || []).map(normalizeRow) })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Impossibile caricare gli incassi') }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const body = await request.json()
    const name = normalizeReceivableName(body.name)
    if (!name) return Response.json({ error: 'Scrivi da chi devi ricevere i soldi' }, { status: 400 })
    const amount = parseReceivableAmount(body.amount)
    if (amount === null) return Response.json({ error: 'Importo non valido' }, { status: 400 })

    const { data, error } = await auth.supabase
      .from('receivables')
      .insert({
        user_id: auth.user.id,
        name,
        amount,
        collected_at: body.collected ? new Date().toISOString() : null,
      })
      .select('*')
      .single()

    if (error) throw error
    return Response.json({ receivable: normalizeRow(data) }, { status: 201 })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Impossibile salvare') }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const body = await request.json()
    const id = String(body.id || '').trim()
    if (!id) return Response.json({ error: 'ID mancante' }, { status: 400 })

    const payload: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (body.name !== undefined) {
      const name = normalizeReceivableName(body.name)
      if (!name) return Response.json({ error: 'Il nome non puo essere vuoto' }, { status: 400 })
      payload.name = name
    }
    if (body.amount !== undefined) {
      const amount = parseReceivableAmount(body.amount)
      if (amount === null) return Response.json({ error: 'Importo non valido' }, { status: 400 })
      payload.amount = amount
    }
    if (body.collected !== undefined) {
      payload.collected_at = body.collected ? new Date().toISOString() : null
    }

    const { data, error } = await auth.supabase
      .from('receivables')
      .update(payload)
      .eq('user_id', auth.user.id)
      .eq('id', id)
      .select('*')
      .maybeSingle()

    if (error) throw error
    if (!data) return Response.json({ error: 'Voce non trovata' }, { status: 404 })
    return Response.json({ receivable: normalizeRow(data) })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Impossibile aggiornare') }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const id = String(request.nextUrl.searchParams.get('id') || '').trim()
    if (!id) return Response.json({ error: 'ID mancante' }, { status: 400 })

    const { data, error } = await auth.supabase
      .from('receivables')
      .delete()
      .eq('user_id', auth.user.id)
      .eq('id', id)
      .select('id')
      .maybeSingle()

    if (error) throw error
    if (!data) return Response.json({ error: 'Voce non trovata' }, { status: 404 })
    return Response.json({ ok: true })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Impossibile eliminare') }, { status: 500 })
  }
}
