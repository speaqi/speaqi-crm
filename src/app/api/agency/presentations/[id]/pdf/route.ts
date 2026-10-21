import { NextRequest } from 'next/server'
import { agencyRoute, getSettings, loadPresentation } from '@/lib/server/agency'
import { getOrCreatePresentationPdf, pdfStamp } from '@/lib/server/agency-pdf'
import { createServiceRoleClient } from '@/lib/server/supabase'
import { fileStem } from '@/lib/agency'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

/** Il PDF della versione corrente, anche in bozza (con "Bozza" su ogni pagina). Uno per versione, poi dalla cache. */
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return agencyRoute(request, async (auth) => {
    const row = await loadPresentation(auth.supabase, auth.user.id, (await ctx.params).id)
    const quote = row.quote_id ? (await auth.supabase.from('quotes').select('updated_at').eq('user_id', row.user_id).eq('id', row.quote_id).maybeSingle()).data : null
    const settings = await getSettings(auth.supabase, row.user_id)
    const brand = (await auth.supabase.from('agency_projects').select('client_brand').eq('user_id', row.user_id).eq('id', row.project_id).maybeSingle()).data?.client_brand
    const pdf = await getOrCreatePresentationPdf(createServiceRoleClient(), row, pdfStamp(row, quote?.updated_at || null, settings, brand))
    return new Response(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${fileStem(row.title)}.pdf"`,
        'Cache-Control': 'private, no-store'
      }
    })
  })
}
