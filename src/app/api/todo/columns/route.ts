import { NextRequest } from 'next/server'
import { errorMessage } from '@/lib/server/http'
import { requireRouteUser } from '@/lib/server/supabase'
import { normalizeColumnTone } from '@/lib/todo'

/**
 * Le colonne personalizzate della lavagna /todo.
 *
 * Sono del proprietario del workspace, come le attività standalone: la lavagna
 * personale non è un oggetto condiviso, e una colonna che compare sullo schermo
 * di qualcun altro sarebbe una sorpresa, non una funzione.
 */

/** Oltre questo numero la lavagna diventa un nastro: si scorre e non si legge. */
const MAX_COLUMNS = 12
const MAX_LABEL = 40
const MAX_HINT = 80

function normalizeLabel(value: unknown) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL)
}

function normalizeHint(value: unknown) {
  const hint = String(value || '').replace(/\s+/g, ' ').trim().slice(0, MAX_HINT)
  return hint || null
}

export async function GET(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const { data, error } = await auth.supabase
      .from('todo_board_columns')
      .select('*')
      .eq('user_id', auth.workspaceUserId)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true })

    if (error) throw error
    return Response.json({ columns: data || [] })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Impossibile caricare le colonne') }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const body = await request.json()
    const label = normalizeLabel(body.label)
    if (!label) return Response.json({ error: 'Dai un nome alla colonna' }, { status: 400 })

    const { data: existing, error: countError } = await auth.supabase
      .from('todo_board_columns')
      .select('id, position')
      .eq('user_id', auth.workspaceUserId)
      .order('position', { ascending: false })
      .limit(MAX_COLUMNS)

    if (countError) throw countError
    if ((existing || []).length >= MAX_COLUMNS) {
      return Response.json(
        { error: `Massimo ${MAX_COLUMNS} colonne: cancellane una prima di aggiungerne un'altra.` },
        { status: 400 }
      )
    }

    const nextPosition = Number(existing?.[0]?.position ?? -1) + 1

    const { data, error } = await auth.supabase
      .from('todo_board_columns')
      .insert({
        user_id: auth.workspaceUserId,
        label,
        hint: normalizeHint(body.hint),
        tone: normalizeColumnTone(body.tone),
        position: nextPosition,
      })
      .select('*')
      .single()

    if (error) throw error
    return Response.json({ column: data }, { status: 201 })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Impossibile creare la colonna') }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const body = await request.json()

    // Riordino: arriva l'elenco completo degli id nell'ordine voluto. Scrivere
    // una posizione per volta lascerebbe la lavagna in un ordine intermedio se
    // la seconda scrittura non parte.
    if (Array.isArray(body.order)) {
      const ids = body.order.map((value: unknown) => String(value || '').trim()).filter(Boolean)
      if (ids.length === 0) return Response.json({ error: 'Elenco vuoto' }, { status: 400 })

      const { data: owned, error: ownedError } = await auth.supabase
        .from('todo_board_columns')
        .select('id')
        .eq('user_id', auth.workspaceUserId)
        .in('id', ids)

      if (ownedError) throw ownedError
      const ownedIds = new Set((owned || []).map((row) => row.id))
      if (ownedIds.size !== ids.length) {
        return Response.json({ error: 'Colonna non trovata' }, { status: 404 })
      }

      for (let index = 0; index < ids.length; index += 1) {
        const { error } = await auth.supabase
          .from('todo_board_columns')
          .update({ position: index, updated_at: new Date().toISOString() })
          .eq('user_id', auth.workspaceUserId)
          .eq('id', ids[index])
        if (error) throw error
      }

      const { data, error } = await auth.supabase
        .from('todo_board_columns')
        .select('*')
        .eq('user_id', auth.workspaceUserId)
        .order('position', { ascending: true })
        .order('created_at', { ascending: true })

      if (error) throw error
      return Response.json({ columns: data || [] })
    }

    const id = String(body.id || '').trim()
    if (!id) return Response.json({ error: 'ID colonna mancante' }, { status: 400 })

    const payload: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (body.label !== undefined) {
      const label = normalizeLabel(body.label)
      if (!label) return Response.json({ error: 'Dai un nome alla colonna' }, { status: 400 })
      payload.label = label
    }
    if (body.hint !== undefined) payload.hint = normalizeHint(body.hint)
    if (body.tone !== undefined) payload.tone = normalizeColumnTone(body.tone)

    const { data, error } = await auth.supabase
      .from('todo_board_columns')
      .update(payload)
      .eq('user_id', auth.workspaceUserId)
      .eq('id', id)
      .select('*')
      .maybeSingle()

    if (error) throw error
    if (!data) return Response.json({ error: 'Colonna non trovata' }, { status: 404 })
    return Response.json({ column: data })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Impossibile aggiornare la colonna') }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const id = String(request.nextUrl.searchParams.get('id') || '').trim()
    if (!id) return Response.json({ error: 'ID colonna mancante' }, { status: 400 })

    // Le attività che stavano dentro tornano in "Da smistare" — se lo fa il
    // vincolo `on delete set null` sul database, non il codice, non resta
    // scoperto nessun percorso (import, cancellazione a mano, cascata).
    const { data, error } = await auth.supabase
      .from('todo_board_columns')
      .delete()
      .eq('user_id', auth.workspaceUserId)
      .eq('id', id)
      .select('id')
      .maybeSingle()

    if (error) throw error
    if (!data) return Response.json({ error: 'Colonna non trovata' }, { status: 404 })
    return Response.json({ ok: true })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Impossibile eliminare la colonna') }, { status: 500 })
  }
}
