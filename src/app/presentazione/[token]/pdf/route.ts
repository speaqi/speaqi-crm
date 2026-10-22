import { NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/server/supabase'
import { loadPublicRow } from '@/lib/server/tourism-decks'
import { getOrCreateDeckPdf, pdfFileName } from '@/lib/server/tourism-deck-pdf'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

/**
 * Il PDF della presentazione per chi ha il link. Solo approvate e con il token giusto;
 * il PDF si genera alla prima richiesta (o all'approvazione) e poi si serve dalla cache.
 * Se Chromium non risponde si ripiega sulla stampa del browser, che dà lo stesso PDF.
 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const service = createServiceRoleClient()
  const row = await loadPublicRow(service, token)
  if (!row) return new Response('Non trovata', { status: 404, headers: { 'Cache-Control': 'no-store' } })
  try {
    const pdf = await getOrCreateDeckPdf(service, row)
    return new Response(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${pdfFileName(row.destination)}"`,
        'Cache-Control': 'private, no-store',
        'Referrer-Policy': 'no-referrer'
      }
    })
  } catch (error) {
    console.error('PDF presentazione non generato', { deck: row.id, message: error instanceof Error ? error.message.slice(0, 300) : 'errore' })
    return Response.redirect(new URL(`/presentazione/${token}?print=1`, request.url), 302)
  }
}
