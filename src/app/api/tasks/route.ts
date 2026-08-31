import { NextRequest } from 'next/server'
import {
  TASKS_CONTACT_FOREIGN_TABLE,
  contactAssigneeMatchOrFilter,
  workspaceContactsAllFromRequest,
} from '@/lib/server/collaborator-filters'
import { requireRouteUser } from '@/lib/server/supabase'

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message || fallback)
  }
  return fallback
}

function normalizeTaskRow(row: any) {
  return {
    ...row,
    contact: Array.isArray(row.contact) ? row.contact[0] : row.contact,
  }
}

const CONTACT_COLUMNS =
  'id, name, status, source, category, company, phone, responsible, assigned_agent, event_tag, last_activity_summary, contact_scope, priority, next_followup_at'

/** Ordinamento per scadenza con i task senza data in fondo, come fa PostgREST. */
function byDueDate(a: any, b: any) {
  const av = a?.due_date ? Date.parse(a.due_date) : Number.POSITIVE_INFINITY
  const bv = b?.due_date ? Date.parse(b.due_date) : Number.POSITIVE_INFINITY
  return av - bv
}

export async function GET(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const supabase = auth.supabase
    const workspaceUserId = auth.workspaceUserId
    const status = request.nextUrl.searchParams.get('status')
    const workspaceAll = workspaceContactsAllFromRequest(request, auth.isAdmin)

    // Stessa regola dei contatti: l'admin del workspace vede sempre tutto,
    // il filtro per assegnatario resta solo per i collaboratori.
    const assigneeOr =
      auth.memberName && !auth.isAdmin && !workspaceAll
        ? contactAssigneeMatchOrFilter(auth.memberName)
        : null

    function baseQuery(embed: string) {
      let query = supabase
        .from('tasks')
        .select(`*, contact:${embed}(${CONTACT_COLUMNS})`)
        .eq('user_id', workspaceUserId)
        .order('due_date', { ascending: true, nullsFirst: false })
      if (status) query = query.eq('status', status)
      return query
    }

    if (!assigneeOr) {
      const { data, error } = await baseQuery('contacts')
      if (error) throw error
      return Response.json({ tasks: (data || []).map(normalizeTaskRow) })
    }

    // Un filtro su una tabella incorporata svuota l'embed ma NON esclude la
    // riga padre: senza !inner il collaboratore riceveva comunque i task di
    // tutti. L'inner join però scarterebbe i task senza contatto, quindi
    // quelli si recuperano con una seconda query.
    const [assigned, orphan] = await Promise.all([
      baseQuery('contacts!inner').or(assigneeOr, { foreignTable: TASKS_CONTACT_FOREIGN_TABLE }),
      baseQuery('contacts').is('contact_id', null),
    ])
    if (assigned.error) throw assigned.error
    if (orphan.error) throw orphan.error

    const tasks = [...(assigned.data || []), ...(orphan.data || [])]
      .map(normalizeTaskRow)
      .sort(byDueDate)

    return Response.json({ tasks })
  } catch (error) {
    return Response.json(
      { error: errorMessage(error, 'Failed to load tasks') },
      { status: 500 }
    )
  }
}
