import { NextRequest } from 'next/server'
import { errorMessage } from '@/lib/server/http'
import { requireArea, requireRouteUser } from '@/lib/server/supabase'
import { createActivities, ensurePipelineStages } from '@/lib/server/crm'
import { syncDealWithContactStatus } from '@/lib/server/deal-ops'
import { priorityLevelFromNumber } from '@/lib/server/ai-ready'

/**
 * Trasforma un espositore in contatto della pipeline (scope `crm`, stato New,
 * con follow-up). Se nel workspace c'e' gia' un contatto con la stessa email lo
 * si collega invece di crearne un doppione. Idempotente: un espositore gia'
 * collegato restituisce il suo contatto.
 */

function tomorrow() {
  const day = new Date(Date.now() + 24 * 60 * 60 * 1000)
  return day.toISOString().slice(0, 10)
}

export async function POST(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error
  const areaError = requireArea(auth, 'fiere')
  if (areaError) return areaError

  try {
    const body = await request.json()
    const id = String(body.id || '').trim()
    if (!id) return Response.json({ error: 'ID mancante' }, { status: 400 })

    const { data: exhibitor, error: readError } = await auth.supabase
      .from('trade_fair_exhibitors')
      .select('*')
      .eq('user_id', auth.workspaceUserId)
      .eq('id', id)
      .maybeSingle()
    if (readError) throw readError
    if (!exhibitor) return Response.json({ error: 'Espositore non trovato' }, { status: 404 })

    if (exhibitor.contact_id) {
      return Response.json({ contact_id: exhibitor.contact_id, created: false, exhibitor })
    }

    if (!auth.isAdmin && !auth.memberName) {
      return Response.json({ error: 'Collaboratore non associato a un membro team' }, { status: 403 })
    }

    const link = async (contactId: string, created: boolean) => {
      const { data, error } = await auth.supabase
        .from('trade_fair_exhibitors')
        .update({ contact_id: contactId, updated_at: new Date().toISOString() })
        .eq('user_id', auth.workspaceUserId)
        .eq('id', id)
        .select('*')
        .maybeSingle()
      if (error) throw error
      return Response.json({ contact_id: contactId, created, exhibitor: data })
    }

    // Stessa email gia' in rubrica: si collega, non si duplica.
    if (exhibitor.email) {
      const { data: existing, error: existingError } = await auth.supabase
        .from('contacts')
        .select('id')
        .eq('user_id', auth.workspaceUserId)
        .ilike('email', String(exhibitor.email).replace(/[%_]/g, '\\$&'))
        .limit(1)
        .maybeSingle()
      if (existingError) throw existingError
      if (existing) {
        await createActivities(auth.supabase, [
          {
            user_id: auth.workspaceUserId,
            contact_id: existing.id,
            type: 'system',
            content: `Collegato all'espositore ${exhibitor.name} (${exhibitor.fair}).`,
          },
        ])
        return link(existing.id, false)
      }
    }

    await ensurePipelineStages(auth.supabase, auth.workspaceUserId)

    const followup = exhibitor.next_followup_at || tomorrow()
    // Espositori: 1 = alta ... 3 = bassa. Contatti: 3 = massima ... 1 = bassa.
    const fairPriority = exhibitor.priority ?? (exhibitor.score >= 55 ? 1 : exhibitor.score >= 30 ? 2 : 3)
    const priority = 4 - fairPriority
    const notes = Array.isArray(exhibitor.notes) ? exhibitor.notes : []
    const noteText = notes.map((note: { text: string }) => note.text).join('\n') || null

    const insertPayload: Record<string, unknown> = {
      user_id: auth.workspaceUserId,
      name: exhibitor.name,
      company: exhibitor.name,
      email: exhibitor.email,
      phone: exhibitor.phone,
      category: exhibitor.category,
      country: exhibitor.country,
      event_tag: exhibitor.fair,
      list_name: exhibitor.fair,
      status: 'New',
      source: `fiera-${exhibitor.fair}`,
      contact_scope: 'crm',
      priority,
      score: exhibitor.score,
      note: noteText,
      last_activity_summary: noteText,
      next_action_at: followup,
      next_followup_at: followup,
    }
    if (!auth.isAdmin) insertPayload.responsible = auth.memberName

    const { data: contact, error: insertError } = await auth.supabase
      .from('contacts')
      .insert(insertPayload)
      .select('*')
      .single()
    if (insertError) throw insertError

    await syncDealWithContactStatus(auth.supabase, auth.workspaceUserId, contact.id, contact.status, {})

    const { error: taskError } = await auth.supabase.from('tasks').insert({
      user_id: auth.workspaceUserId,
      contact_id: contact.id,
      type: 'follow-up',
      action: exhibitor.email ? 'email' : 'call',
      due_date: followup,
      priority: priorityLevelFromNumber(contact.priority),
      status: 'pending',
      note: `Follow-up fiera ${exhibitor.fair}: ${exhibitor.name}`,
    })
    if (taskError) throw taskError

    await createActivities(auth.supabase, [
      {
        user_id: auth.workspaceUserId,
        contact_id: contact.id,
        type: 'system',
        content: [
          `Contatto creato dall'area Fiere (${exhibitor.fair}).`,
          exhibitor.hall || exhibitor.stand
            ? `Padiglione ${exhibitor.hall || '—'}, stand ${exhibitor.stand || '—'}.`
            : null,
          exhibitor.website ? `Sito: ${exhibitor.website}.` : null,
          `Punteggio ${exhibitor.score}/100.`,
        ]
          .filter(Boolean)
          .join(' '),
      },
      ...notes.map((note: { text: string; at: string }) => ({
        user_id: auth.workspaceUserId,
        contact_id: contact.id,
        type: 'note',
        content: note.text,
        created_at: note.at,
      })),
    ])

    return link(contact.id, true)
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Impossibile creare il contatto') }, { status: 500 })
  }
}
