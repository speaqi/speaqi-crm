import { NextRequest } from 'next/server'
import { errorMessage } from '@/lib/server/http'
import { requireRouteUser } from '@/lib/server/supabase'

type RouteContext = {
  params: Promise<{ id: string }>
}

/** Firma disegnata e prove: solo nel CRM, con la visibilita' del preventivo (RLS). */
export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const { id } = await context.params
    const { data, error } = await auth.supabase
      .from('quote_signatures')
      .select('quote_id, signer_name, signer_email, signature_png, ip, user_agent, channel, signed_at')
      .eq('quote_id', id)
      .maybeSingle()
    if (error) throw error
    if (!data) return Response.json({ error: 'Firma non trovata' }, { status: 404 })
    return Response.json({ signature: data })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Impossibile leggere la firma') }, { status: 500 })
  }
}
