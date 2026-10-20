import { NextRequest } from 'next/server'
import { AgencyInputError, agencyBody, agencyRoute, attachQuote, attachableQuotes, detachQuote, isUuid, loadProject, projectView } from '@/lib/server/agency'
import { createServiceRoleClient } from '@/lib/server/supabase'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

/** I preventivi del cliente che si possono collegare a questa opportunità. */
export async function GET(request: NextRequest, ctx: Ctx) {
  return agencyRoute(request, async (auth) => {
    const row = await loadProject(auth.supabase, auth.user.id, (await ctx.params).id)
    return { quotes: await attachableQuotes(auth.supabase, row) }
  })
}

/** { quote_id } collega un preventivo esistente. Un preventivo nuovo si crea da /preventivi con l'opportunità già scelta. */
export async function POST(request: NextRequest, ctx: Ctx) {
  return agencyRoute(request, async (auth) => {
    const body = await agencyBody(request)
    const row = await loadProject(auth.supabase, auth.user.id, (await ctx.params).id)
    await attachQuote(auth.supabase, row, String(body.quote_id || ''))
    return projectView(auth.supabase, createServiceRoleClient(), row)
  })
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
  return agencyRoute(request, async (auth) => {
    const quoteId = request.nextUrl.searchParams.get('quote_id')
    if (!isUuid(quoteId)) throw new AgencyInputError('Preventivo non valido')
    const row = await loadProject(auth.supabase, auth.user.id, (await ctx.params).id)
    await detachQuote(auth.supabase, row, quoteId)
    return projectView(auth.supabase, createServiceRoleClient(), row)
  })
}
