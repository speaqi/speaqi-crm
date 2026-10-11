import { NextRequest } from 'next/server'
import { errorMessage } from '@/lib/server/http'
import { requireArea, requireRouteUser } from '@/lib/server/supabase'
import {
  isTradeFairStatus,
  newNote,
  normalizeEmail,
  normalizeWebsite,
  parseExhibitorsText,
  scoreExhibitor,
  slugifyExhibitor,
} from '@/lib/trade-fair'

/**
 * Espositori di una fiera (/fiere). Gli espositori sono del workspace e la RLS
 * (`user_id = auth.uid()`) e' la rete di sicurezza; qui si filtra comunque per
 * `workspaceUserId`, come le altre rotte di area.
 */

const FAIR_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/
const IMPORT_CHUNK = 200

function fairOf(value: unknown) {
  const fair = String(value || 'ttg-2026').trim().toLowerCase()
  return FAIR_RE.test(fair) ? fair : null
}

export async function GET(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error
  const areaError = requireArea(auth, 'fiere')
  if (areaError) return areaError

  const fair = fairOf(request.nextUrl.searchParams.get('fair'))
  if (!fair) return Response.json({ error: 'Fiera non valida' }, { status: 400 })

  try {
    // PostgREST tronca a 1000 righe: una fiera ne ha di piu', si pagina.
    const rows: unknown[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await auth.supabase
        .from('trade_fair_exhibitors')
        .select('*')
        .eq('user_id', auth.workspaceUserId)
        .eq('fair', fair)
        .order('id', { ascending: true })
        .range(from, from + 999)
      if (error) throw error
      rows.push(...(data || []))
      if (!data || data.length < 1000) break
    }
    return Response.json({ exhibitors: rows })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Impossibile caricare gli espositori') }, { status: 500 })
  }
}

/**
 * Importa un elenco incollato (CSV/TSV). Un rilancio aggiorna i dati di
 * catalogo e il punteggio, ma non tocca stato, note, follow-up e priorita':
 * sono lavoro fatto a mano.
 */
export async function POST(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error
  const areaError = requireArea(auth, 'fiere')
  if (areaError) return areaError

  try {
    const body = await request.json()
    const fair = fairOf(body.fair)
    if (!fair) return Response.json({ error: 'Fiera non valida' }, { status: 400 })
    const { items, skipped } = parseExhibitorsText(String(body.text || ''))
    if (!items.length) return Response.json({ error: 'Nessun espositore riconosciuto nel testo' }, { status: 400 })

    const userId = auth.workspaceUserId
    const { data: existing, error: existingError } = await auth.supabase
      .from('trade_fair_exhibitors')
      .select('slug')
      .eq('user_id', userId)
      .eq('fair', fair)
      .limit(20000)
    if (existingError) throw existingError
    const known = new Set((existing || []).map((row: { slug: string }) => row.slug))

    const now = new Date().toISOString()
    const records = items.map((item) => {
      const { score, reasons } = scoreExhibitor(item)
      return { ...item, user_id: userId, fair, slug: slugifyExhibitor(item.name), score, score_reasons: reasons, updated_at: now }
    })

    for (let i = 0; i < records.length; i += IMPORT_CHUNK) {
      const { error } = await auth.supabase
        .from('trade_fair_exhibitors')
        .upsert(records.slice(i, i + IMPORT_CHUNK), { onConflict: 'user_id,fair,slug' })
      if (error) throw error
    }

    const created = records.filter((record) => !known.has(record.slug)).length
    return Response.json({ created, updated: records.length - created, skipped })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Impossibile importare gli espositori') }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error
  const areaError = requireArea(auth, 'fiere')
  if (areaError) return areaError

  try {
    const body = await request.json()
    const id = String(body.id || '').trim()
    if (!id) return Response.json({ error: 'ID mancante' }, { status: 400 })

    const { data: current, error: currentError } = await auth.supabase
      .from('trade_fair_exhibitors')
      .select('*')
      .eq('user_id', auth.workspaceUserId)
      .eq('id', id)
      .maybeSingle()
    if (currentError) throw currentError
    if (!current) return Response.json({ error: 'Espositore non trovato' }, { status: 404 })

    const payload: Record<string, unknown> = { updated_at: new Date().toISOString() }

    if (body.status !== undefined) {
      if (!isTradeFairStatus(body.status)) return Response.json({ error: 'Stato non valido' }, { status: 400 })
      payload.status = body.status
      // La data del primo contatto si scrive una volta, quando si esce da "Da contattare".
      if (body.status !== 'new' && !current.contacted_at) payload.contacted_at = new Date().toISOString()
    }
    if (body.priority !== undefined) {
      if (body.priority !== null && ![1, 2, 3].includes(Number(body.priority))) {
        return Response.json({ error: 'Priorita non valida' }, { status: 400 })
      }
      payload.priority = body.priority === null ? null : Number(body.priority)
    }
    if (body.next_followup_at !== undefined) {
      const day = body.next_followup_at
      if (day !== null && !/^\d{4}-\d{2}-\d{2}$/.test(String(day))) {
        return Response.json({ error: 'Data non valida' }, { status: 400 })
      }
      payload.next_followup_at = day
    }
    if (body.email !== undefined) payload.email = body.email ? normalizeEmail(body.email) : null
    if (body.website !== undefined) payload.website = body.website ? normalizeWebsite(body.website) : null
    if (body.phone !== undefined) payload.phone = String(body.phone || '').trim().slice(0, 60) || null
    if (body.note !== undefined) {
      const note = newNote(String(body.note))
      if (!note) return Response.json({ error: 'La nota e vuota' }, { status: 400 })
      const notes = Array.isArray(current.notes) ? current.notes : []
      payload.notes = [note, ...notes].slice(0, 200)
    }
    if (body.delete_note_id !== undefined) {
      const notes = Array.isArray(current.notes) ? current.notes : []
      payload.notes = notes.filter((note: { id: string }) => note.id !== body.delete_note_id)
    }

    // Se cambiano i contatti il punteggio puo' cambiare (contatto diretto).
    if (payload.email !== undefined || payload.phone !== undefined || payload.website !== undefined) {
      const merged = { ...current, ...payload }
      const { score, reasons } = scoreExhibitor(merged)
      payload.score = score
      payload.score_reasons = reasons
    }

    const { data, error } = await auth.supabase
      .from('trade_fair_exhibitors')
      .update(payload)
      .eq('user_id', auth.workspaceUserId)
      .eq('id', id)
      .select('*')
      .maybeSingle()
    if (error) throw error
    if (!data) return Response.json({ error: 'Espositore non trovato' }, { status: 404 })
    return Response.json({ exhibitor: data })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Impossibile aggiornare') }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error
  const areaError = requireArea(auth, 'fiere')
  if (areaError) return areaError

  try {
    const id = String(request.nextUrl.searchParams.get('id') || '').trim()
    if (!id) return Response.json({ error: 'ID mancante' }, { status: 400 })
    const { data, error } = await auth.supabase
      .from('trade_fair_exhibitors')
      .delete()
      .eq('user_id', auth.workspaceUserId)
      .eq('id', id)
      .select('id')
      .maybeSingle()
    if (error) throw error
    if (!data) return Response.json({ error: 'Espositore non trovato' }, { status: 404 })
    return Response.json({ ok: true })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Impossibile eliminare') }, { status: 500 })
  }
}
