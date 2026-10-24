import { NextRequest } from 'next/server'
import { requireWorkspaceOwner } from '@/lib/server/owner-auth'
import { errorMessage } from '@/lib/server/http'
import { filterOpportunities, loadOpenOpportunities } from '@/lib/server/opportunities'
import { newOpportunityRow, OPPORTUNITY_PIPELINES } from '@/lib/opportunities'

/** Le opportunità aperte di tutte le pipeline, con prossimo passo e motivo del blocco. */
export async function GET(request: NextRequest) {
  const auth = await requireWorkspaceOwner(request)
  if ('error' in auth) return auth.error!
  try {
    const params = request.nextUrl.searchParams
    const inputs = await loadOpenOpportunities(auth.admin, auth.userId)
    const all = filterOpportunities(inputs, {})
    const rows = filterOpportunities(inputs, {
      pipeline: params.get('pipeline'), owner: params.get('owner'), view: params.get('view'), q: params.get('q'),
    })
    const counts = Object.fromEntries(OPPORTUNITY_PIPELINES.map((p) => [p, all.filter((row) => row.pipeline === p).length]))
    return Response.json({ rows: rows.slice(0, 300), total: rows.length, counts,
      stuck: all.filter((row) => row.stuck).length, to_activate: all.filter((row) => row.signed_at && !row.activated_at).length })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Opportunità non disponibili') }, { status: 500 })
  }
}

/** Una nuova opportunità Tourism, Distribuzione o Agency su un contatto esistente. */
export async function POST(request: NextRequest) {
  const auth = await requireWorkspaceOwner(request)
  if ('error' in auth) return auth.error!
  let row: Record<string, unknown>
  try {
    row = newOpportunityRow(await request.json().catch(() => null), auth.userId)
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Opportunità non valida') }, { status: 400 })
  }
  try {
    const { data: contact, error: contactError } = await auth.admin.from('contacts').select('id,name')
      .eq('user_id', auth.userId).eq('id', row.contact_id as string).maybeSingle()
    if (contactError) throw contactError
    if (!contact) return Response.json({ error: 'Contatto non trovato' }, { status: 404 })
    const { data, error } = await auth.admin.from('deals').insert(row).select('*').single()
    if (error) {
      if ((error as { code?: string }).code === '23505') {
        return Response.json({ error: 'Questo contatto ha già un’opportunità aperta in questa pipeline' }, { status: 409 })
      }
      throw error
    }
    await auth.admin.from('activities').insert({ user_id: auth.userId, contact_id: contact.id, type: 'system',
      content: `Nuova opportunità ${String(row.pipeline)}: ${String(row.title)}.`, metadata: { event: 'opportunity_created', deal_id: data.id } })
    return Response.json({ opportunity: data }, { status: 201 })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Opportunità non creata') }, { status: 500 })
  }
}
