import { NextRequest } from 'next/server'
import {
  contactAssigneeMatchOrFilter,
  workspaceContactsAllFromRequest,
} from '@/lib/server/collaborator-filters'
import { requireRouteUser } from '@/lib/server/supabase'
import { applyCrmScope, applyPipelineScope } from '@/lib/server/scope-filters'
import { CLOSED_STATUSES } from '@/lib/data'

/**
 * Conteggi per badge sidebar e tab contatti.
 *
 * Prima venivano calcolati in memoria sul client filtrando l'intero elenco
 * contatti: con 60k+ righe significava scaricare l'intero database solo per
 * scrivere un numero accanto a una voce di menu. Qui sono `count exact` con
 * `head: true`: Postgres li risolve sugli indici, il payload è una manciata
 * di byte.
 */
export async function GET(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const supabase = auth.supabase
    const workspaceAll = workspaceContactsAllFromRequest(request, auth.isAdmin)
    const assigneeOr =
      auth.memberName && !auth.isAdmin && !workspaceAll
        ? contactAssigneeMatchOrFilter(auth.memberName)
        : null
    const restrictToAssignee = Boolean(auth.memberName) && !auth.isAdmin && !workspaceAll

    function base() {
      let query = supabase
        .from('contacts')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', auth.workspaceUserId)
      if (restrictToAssignee) {
        if (assigneeOr) query = query.or(assigneeOr)
        else query = query.eq('responsible', '__no_member__')
      }
      return query
    }

    /** Regola canonica di visibilità (righe legacy con scope null incluse). */
    const crmScope = () => applyCrmScope(base())

    const [total, crm, crmVisible, holding, personal, partner, inbound, marketing] =
      await Promise.all([
        base(),
        crmScope(),
        applyPipelineScope(base()),
        base().eq('contact_scope', 'holding'),
        base().eq('contact_scope', 'personal'),
        // Il flag partner appartiene al set di lavoro (crm/personal): contarlo
        // anche sulle liste separate darebbe un numero che la tab non mostra.
        // `neq` in SQL scarta i NULL, che qui valgono 'crm': serve l'or esplicito.
        base().eq('is_partner', true).or('contact_scope.is.null,contact_scope.neq.holding'),
        crmScope().eq('source', 'speaqi'),
        base()
          .or('contact_scope.is.null,contact_scope.neq.personal')
          // PostgREST non ha un `in` case-insensitive: gli status sono salvati
          // capitalizzati ("Closed"), le righe legacy in minuscolo.
          .not(
            'status',
            'in',
            `(${CLOSED_STATUSES.flatMap((status) => [
              status,
              status.charAt(0).toUpperCase() + status.slice(1),
            ])
              .map((status) => `"${status}"`)
              .join(',')})`
          )
          .or(
            'email.not.is.null,email_draft_note.not.is.null,next_followup_at.not.is.null,email_unsubscribed_at.not.is.null'
          ),
      ])

    const firstError = [total, crm, crmVisible, holding, personal, partner, inbound, marketing].find(
      (result) => result.error
    )
    if (firstError?.error) throw firstError.error

    // Chip "Cartelle": aggregazione lato database (vedi migration
    // contact_scope_folder_counts). Se la funzione non c'è ancora, la pagina
    // resta usabile senza chip invece di fallire.
    const { data: folderRows } = await supabase.rpc('contact_scope_folder_counts', {
      p_scope: 'holding',
      p_user_id: auth.workspaceUserId,
    })

    return Response.json(
      {
        folders: (folderRows || []).map((row: any) => ({
          list_name: row.list_name ?? null,
          event_tag: row.event_tag ?? null,
          source: row.source ?? null,
          count: Number(row.contacts_count || 0),
        })),
        counts: {
          total: total.count ?? 0,
          crm: crm.count ?? 0,
          crm_visible: crmVisible.count ?? 0,
          holding: holding.count ?? 0,
          personal: personal.count ?? 0,
          partner: partner.count ?? 0,
          inbound: inbound.count ?? 0,
          marketing: marketing.count ?? 0,
        },
      },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to load contact counts' },
      { status: 500 }
    )
  }
}
