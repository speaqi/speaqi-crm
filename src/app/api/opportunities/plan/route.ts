import { NextRequest } from 'next/server'
import { requireWorkspaceOwner } from '@/lib/server/owner-auth'
import { errorMessage } from '@/lib/server/http'
import { loadDirectorPlan } from '@/lib/server/opportunities'

/** Il piano del giorno calcolato adesso: gratuito, anche con il Direttore spento. */
export async function GET(request: NextRequest) {
  const auth = await requireWorkspaceOwner(request)
  if ('error' in auth) return auth.error!
  try {
    return Response.json({ plan: await loadDirectorPlan(auth.admin, auth.userId) })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Piano non disponibile') }, { status: 500 })
  }
}
