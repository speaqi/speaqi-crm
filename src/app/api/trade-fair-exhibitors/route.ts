import { NextRequest } from 'next/server'
import { errorMessage } from '@/lib/server/http'
import { requireArea, requireRouteUser } from '@/lib/server/supabase'
import {
  isTradeFairStatus,
  newNote,
  normalizeEmail,
  normalizeWebsite,
  parseExhibitorsText,
  slugifyExhibitor,
} from '@/lib/trade-fair'
import { FACTOR_KEYS, FactorKey, factorOption, scoreColumns, SosInput } from '@/lib/opportunity-score'

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
      .select('slug, status, contact_person, sos_manual, ttg_flags, meeting_outcome')
      .eq('user_id', userId)
      .eq('fair', fair)
      .limit(20000)
    if (existingError) throw existingError
    const known = new Map<string, Record<string, any>>()
    for (const row of (existing || []) as Record<string, any>[]) known.set(row.slug, row)

    const now = new Date().toISOString()
    const records = items.map((item) => {
      const slug = slugifyExhibitor(item.name)
      // Un reimport aggiorna il catalogo ma il lavoro fatto a mano (criteri, flag, stato) entra nel calcolo.
      const prior = known.get(slug) || {}
      return { ...item, user_id: userId, fair, slug, ...scoreColumns({ ...prior, ...item } as SosInput), updated_at: now }
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
    if (body.contact_person !== undefined) {
      payload.contact_person = String(body.contact_person || '').trim().slice(0, 120) || null
    }
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

    // Criterio SOS impostato a mano (option null = torna alla deduzione), con storico.
    if (body.sos_factor !== undefined) {
      const key = String(body.sos_factor?.key || '') as FactorKey
      if (!FACTOR_KEYS.includes(key)) return Response.json({ error: 'Criterio non valido' }, { status: 400 })
      const option = body.sos_factor.option === null ? null : String(body.sos_factor.option)
      if (option !== null && !factorOption(key, option)) return Response.json({ error: 'Opzione non valida' }, { status: 400 })
      const manual = { ...(current.sos_manual || {}) } as Record<string, { option: string; at: string }>
      const before = manual[key]?.option ?? null
      if (option === null) delete manual[key]
      else manual[key] = { option, at: new Date().toISOString() }
      payload.sos_manual = manual
      if (before !== option) {
        const history = Array.isArray(current.sos_history) ? current.sos_history : []
        payload.sos_history = [{ at: new Date().toISOString(), factor: key, from: before, to: option }, ...history].slice(0, 200)
      }
    }
    if (body.ttg_flags !== undefined) {
      const next = { ...(current.ttg_flags || {}) } as Record<string, boolean>
      for (const flag of ['decision_maker_present', 'partner_intro', 'existing_client']) {
        if (body.ttg_flags?.[flag] !== undefined) next[flag] = Boolean(body.ttg_flags[flag])
      }
      payload.ttg_flags = next
    }
    if (body.meeting_outcome !== undefined) {
      const o = body.meeting_outcome || {}
      payload.meeting_outcome = {
        interest: ['yes', 'maybe', 'no'].includes(o.interest) ? o.interest : null,
        budget_plausible: typeof o.budget_plausible === 'boolean' ? o.budget_plausible : null,
        next_step: String(o.next_step || '').trim().slice(0, 500) || null,
        at: new Date().toISOString(),
      }
    }

    // Ogni modifica puo' spostare il punteggio (contatti, stato, referente, criteri, flag): si ricalcola sempre.
    Object.assign(payload, scoreColumns({ ...current, ...payload }))

    // Se l'espositore e' gia' un contatto del CRM, email/telefono/referente corretti
    // in fiera si riportano anche li', altrimenti il follow-up parte con dati vecchi.
    if (current.contact_id) {
      const contactPatch: Record<string, unknown> = {}
      if (payload.email !== undefined) contactPatch.email = payload.email
      if (payload.phone !== undefined) contactPatch.phone = payload.phone
      if (payload.contact_person) contactPatch.name = payload.contact_person
      if (Object.keys(contactPatch).length) {
        const { error: contactError } = await auth.supabase
          .from('contacts')
          .update(contactPatch)
          .eq('user_id', auth.workspaceUserId)
          .eq('id', current.contact_id)
        if (contactError) throw contactError
      }
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
