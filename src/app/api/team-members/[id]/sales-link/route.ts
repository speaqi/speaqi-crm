import { NextRequest } from 'next/server'
import { errorMessage } from '@/lib/server/http'
import {
  generateSalesToken,
  hashSalesToken,
  salesLinkPath,
  salesTokenHint,
} from '@/lib/server/sales-links'
import { requireRouteUser } from '@/lib/server/supabase'

type RouteContext = {
  params: Promise<{ id: string }>
}

function requestOrigin(request: NextRequest) {
  const configured = String(process.env.NEXT_PUBLIC_APP_URL || process.env.APP_BASE_URL || '').trim()
  if (configured) return configured.replace(/\/$/, '')
  const proto = request.headers.get('x-forwarded-proto')
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host')
  if (proto && host) return `${proto}://${host}`
  return request.nextUrl.origin
}

async function revokeActive(supabase: any, workspaceUserId: string, memberId: string) {
  const { error } = await supabase
    .from('sales_links')
    .update({ revoked_at: new Date().toISOString() })
    .eq('user_id', workspaceUserId)
    .eq('team_member_id', memberId)
    .is('revoked_at', null)
  if (error) throw error
}

/**
 * Genera (o rigenera) il link vendita del membro. Il token si restituisce
 * solo qui: sul database resta l'hash, quindi un link perso si rigenera.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error
  if (!auth.isAdmin) return Response.json({ error: 'Solo admin può gestire i link vendita' }, { status: 403 })

  try {
    const { id } = await context.params
    const { data: member, error: memberError } = await auth.supabase
      .from('team_members')
      .select('id, name')
      .eq('user_id', auth.workspaceUserId)
      .eq('id', id)
      .maybeSingle()
    if (memberError) throw memberError
    if (!member) return Response.json({ error: 'Collaboratore non trovato' }, { status: 404 })

    await revokeActive(auth.supabase, auth.workspaceUserId, member.id)

    const token = generateSalesToken()
    const { data: link, error } = await auth.supabase
      .from('sales_links')
      .insert({
        user_id: auth.workspaceUserId,
        team_member_id: member.id,
        token_hash: hashSalesToken(token),
        token_hint: salesTokenHint(token),
      })
      .select('team_member_id, created_at, token_hint, last_used_at')
      .single()
    if (error) throw error

    return Response.json({ url: `${requestOrigin(request)}${salesLinkPath(token)}`, link }, { status: 201 })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Impossibile generare il link vendita') }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error
  if (!auth.isAdmin) return Response.json({ error: 'Solo admin può gestire i link vendita' }, { status: 403 })

  try {
    const { id } = await context.params
    await revokeActive(auth.supabase, auth.workspaceUserId, id)
    return Response.json({ success: true })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Impossibile revocare il link vendita') }, { status: 500 })
  }
}
