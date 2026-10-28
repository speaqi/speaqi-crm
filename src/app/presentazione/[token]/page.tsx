import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import DeckPlayer from '@/components/tourism/deck/DeckPlayer'
import { createServiceRoleClient } from '@/lib/server/supabase'
import { loadPublicDeck } from '@/lib/server/tourism-decks'

export const dynamic = 'force-dynamic'

// Pagina pubblica di una presentazione approvata: chi ha il link la vede e la salva in PDF.
// Il token è lungo e non indovinabile; la pagina non si indicizza e non rivela il referrer.
export const metadata: Metadata = {
  title: 'Speaqi',
  robots: { index: false, follow: false },
  referrer: 'no-referrer'
}

export default async function PresentationPage({
  params,
  searchParams
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ print?: string; render?: string }>
}) {
  const { token } = await params
  const { print, render } = await searchParams
  // render: la chiave con cui il server stampa in PDF una bozza (vedi deckRenderKey).
  const deck = await loadPublicDeck(createServiceRoleClient(), token, render)
  if (!deck) notFound()
  return <DeckPlayer mode="full" slides={deck.slides} images={deck.images} credits={deck.credits} destination={deck.destination} lang={deck.lang} printable pdfHref={render ? undefined : `/presentazione/${token}/pdf`} autoPrint={print === '1'} quoteHref={deck.quote?.public_token && !render ? `/preventivo?id=${encodeURIComponent(deck.quote.public_token)}` : undefined} />
}
