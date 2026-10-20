import { NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/server/supabase'
import { loadPublicRow } from '@/lib/server/agency'
import { getOrCreatePresentationPdf, pdfStamp } from '@/lib/server/agency-pdf'
import { fileStem, normalizeAgencySettings } from '@/lib/agency'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

/** Il PDF per chi ha il link: solo approvate. Se Chromium non risponde si ripiega sulla stampa del browser. */
export async function GET(request: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const service = createServiceRoleClient()
  const row = await loadPublicRow(service, token)
  if (!row || row.status !== 'approved') return new Response('Non trovata', { status: 404, headers: { 'Cache-Control': 'no-store' } })
  try {
    const quote = row.quote_id ? (await service.from('quotes').select('updated_at').eq('user_id', row.user_id).eq('id', row.quote_id).maybeSingle()).data : null
    const settings = normalizeAgencySettings((await service.from('agency_settings').select('content').eq('user_id', row.user_id).maybeSingle()).data?.content)
    const pdf = await getOrCreatePresentationPdf(service, row, pdfStamp(row, quote?.updated_at || null, settings))
    return new Response(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${fileStem(row.title)}.pdf"`,
        'Cache-Control': 'private, no-store',
        'Referrer-Policy': 'no-referrer'
      }
    })
  } catch (error) {
    console.error('PDF proposta non generato', { presentation: row.id, message: error instanceof Error ? error.message.slice(0, 300) : 'errore' })
    return Response.redirect(new URL(`/proposta/${token}?print=1`, request.url), 302)
  }
}
