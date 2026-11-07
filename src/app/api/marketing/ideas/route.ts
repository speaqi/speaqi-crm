import { NextRequest } from 'next/server'
import { errorMessage } from '@/lib/server/http'
import { requireWorkspaceOwner } from '@/lib/server/owner-auth'
import { isSeedKey, normalizeIdeaPatch, normalizeNewIdea } from '@/lib/marketing-ideas'

/**
 * Idee per vendere le guide ai partner (/marketing/idee). Solo del titolare:
 * è un piano interno. Le idee di partenza stanno nel codice; qui si legge e si
 * scrive lo stato di lavoro e si aggiungono le idee scritte a mano.
 * Le scritture passano dal service role, sempre filtrate per `user_id`.
 */

// Tabella non ancora creata (migration non applicata): la pagina deve restare
// in piedi con le idee di partenza, dicendo che lo stato non si salva.
function isMissingTable(error: { code?: string; message?: string } | null) {
  if (!error) return false
  const message = error.message || ''
  return error.code === '42P01' || error.code === 'PGRST205' || (/marketing_ideas/.test(message) && /does not exist|schema cache/.test(message))
}

export async function GET(request: NextRequest) {
  const auth = await requireWorkspaceOwner(request)
  if ('error' in auth) return auth.error

  const { data, error } = await auth.admin
    .from('marketing_ideas')
    .select('idea_key,status,owner,deadline,progress,notes,title,category,budget,description,next_action')
    .eq('user_id', auth.userId)
    .order('created_at', { ascending: true })

  if (isMissingTable(error)) return Response.json({ rows: [], unavailable: true })
  if (error) return Response.json({ error: errorMessage(error, 'Impossibile caricare le idee') }, { status: 500 })
  return Response.json({ rows: data || [], unavailable: false })
}

/** Aggiunge un'idea scritta a mano. */
export async function POST(request: NextRequest) {
  const auth = await requireWorkspaceOwner(request)
  if ('error' in auth) return auth.error

  try {
    const body = (await request.json()) as Record<string, unknown>
    const parsed = normalizeNewIdea(body)
    if ('error' in parsed) return Response.json({ error: parsed.error }, { status: 400 })
    const { idea } = parsed

    const { data, error } = await auth.admin
      .from('marketing_ideas')
      .insert({
        user_id: auth.userId,
        idea_key: `custom-${crypto.randomUUID()}`,
        title: idea.title,
        category: idea.category,
        budget: idea.budget,
        description: idea.description,
        next_action: idea.nextAction,
        status: 'Backlog',
      })
      .select('idea_key,status,owner,deadline,progress,notes,title,category,budget,description,next_action')
      .single()

    if (isMissingTable(error)) {
      return Response.json({ error: 'Applica prima la migration marketing_ideas.' }, { status: 503 })
    }
    if (error) throw error
    return Response.json({ row: data }, { status: 201 })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Impossibile salvare l’idea') }, { status: 500 })
  }
}

/** Cambia lo stato di un'idea (di partenza o scritta a mano). */
export async function PATCH(request: NextRequest) {
  const auth = await requireWorkspaceOwner(request)
  if ('error' in auth) return auth.error

  try {
    const body = (await request.json()) as Record<string, unknown>
    const key = String(body.key ?? '').trim()
    if (!key) return Response.json({ error: 'Idea mancante' }, { status: 400 })
    const parsed = normalizeIdeaPatch(body)
    if ('error' in parsed) return Response.json({ error: parsed.error }, { status: 400 })
    const { patch } = parsed
    if (Object.keys(patch).length === 0) return Response.json({ error: 'Niente da salvare' }, { status: 400 })

    const columns = { ...patch, updated_at: new Date().toISOString() }
    const select = 'idea_key,status,owner,deadline,progress,notes,title,category,budget,description,next_action'

    if (isSeedKey(key)) {
      const { data, error } = await auth.admin
        .from('marketing_ideas')
        .upsert({ user_id: auth.userId, idea_key: key, ...columns }, { onConflict: 'user_id,idea_key' })
        .select(select)
        .single()
      if (isMissingTable(error)) return Response.json({ error: 'Applica prima la migration marketing_ideas.' }, { status: 503 })
      if (error) throw error
      return Response.json({ row: data })
    }

    const { data, error } = await auth.admin
      .from('marketing_ideas')
      .update(columns)
      .eq('user_id', auth.userId)
      .eq('idea_key', key)
      .select(select)
      .maybeSingle()
    if (isMissingTable(error)) return Response.json({ error: 'Applica prima la migration marketing_ideas.' }, { status: 503 })
    if (error) throw error
    if (!data) return Response.json({ error: 'Idea non trovata' }, { status: 404 })
    return Response.json({ row: data })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Impossibile salvare') }, { status: 500 })
  }
}

/** Toglie un'idea scritta a mano. Quelle di partenza non si cancellano: si mettono in «Completata». */
export async function DELETE(request: NextRequest) {
  const auth = await requireWorkspaceOwner(request)
  if ('error' in auth) return auth.error

  const key = request.nextUrl.searchParams.get('key')?.trim() || ''
  if (!key || isSeedKey(key)) {
    return Response.json({ error: 'Si possono togliere solo le idee scritte a mano' }, { status: 400 })
  }
  const { error } = await auth.admin
    .from('marketing_ideas')
    .delete()
    .eq('user_id', auth.userId)
    .eq('idea_key', key)
    .not('title', 'is', null)
  if (error) return Response.json({ error: errorMessage(error, 'Impossibile togliere l’idea') }, { status: 500 })
  return Response.json({ ok: true })
}
