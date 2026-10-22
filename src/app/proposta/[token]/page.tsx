import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import AgencyDeck from '@/components/agency/AgencySlides'
import { createServiceRoleClient } from '@/lib/server/supabase'
import { loadPublicPresentation } from '@/lib/server/agency'

export const dynamic = 'force-dynamic'

// Proposta Speaqi Agency per chi ha il link: solo presentazioni approvate. Una bozza si
// apre soltanto con la chiave di render (è così che Chromium ne stampa il PDF).
// Il token è lungo e non indovinabile; la pagina non si indicizza e non rivela il referrer.
export const metadata: Metadata = {
  title: 'Proposta',
  robots: { index: false, follow: false },
  referrer: 'no-referrer'
}

export default async function ProposalPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ print?: string; render?: string }> }) {
  const { token } = await params
  const { print, render } = await searchParams
  const deck = await loadPublicPresentation(createServiceRoleClient(), token, render)
  if (!deck) notFound()
  return (
    <AgencyDeck
      mode="full"
      slides={deck.slides}
      draft={deck.draft}
      autoPrint={print === '1'}
      pdfHref={deck.draft ? undefined : `/proposta/${token}/pdf`}
      ctx={{
        theme: deck.theme,
        images: deck.images,
        clientName: deck.client_name,
        clientLogo: deck.client_logo,
        agencyName: deck.agency.name,
        agencySignature: deck.agency.signature,
        quote: deck.quote,
        quoteHref: deck.quote?.public_token && !render ? `/preventivo?id=${deck.quote.public_token}` : null
      }}
    />
  )
}
