import { NextRequest } from 'next/server'
import { agencyBody, agencyRoute, listCategories, upsertCategory } from '@/lib/server/agency'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  return agencyRoute(request, async (auth) => ({ categories: await listCategories(auth.supabase, auth.user.id) }))
}

/** Crea (senza id) o modifica (con id) una categoria. Lo slug non cambia: è quello salvato sulle opportunità. */
export async function POST(request: NextRequest) {
  return agencyRoute(request, async (auth) => {
    const category = await upsertCategory(auth.supabase, auth.user.id, await agencyBody(request))
    return { category, categories: await listCategories(auth.supabase, auth.user.id) }
  })
}
