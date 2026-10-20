import { NextRequest } from 'next/server'
import { agencyRoute, duplicatePresentation, loadPresentation } from '@/lib/server/agency'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return agencyRoute(request, async (auth) => {
    const row = await loadPresentation(auth.supabase, auth.user.id, (await ctx.params).id)
    const copy = await duplicatePresentation(auth.supabase, row)
    return { id: copy.id }
  })
}
