// La presentazione destinazioni in inglese («Speaqi Guides · Destinations»).
// Struttura, immagini, icone e tono sono quelli della base italiana (`DEFAULT_DECK_TEMPLATE`):
// qui stanno solo le parole, per id di slide. Così le due basi non si allontanano.
import { DEFAULT_DECK_TEMPLATE, type DeckItem, type DeckSlide, type DeckTemplate } from './tourism-deck'

/** Base inglese: stesso id della base italiana con il suffisso della lingua. */
export const DESTINATIONS_BASE_EN = `${DEFAULT_DECK_TEMPLATE.base}-en`

type SlideText = Partial<Pick<DeckSlide, 'kicker' | 'title' | 'body' | 'note' | 'footnote'>> & { items?: Array<Pick<DeckItem, 'title' | 'text'> & { value?: string }> }

export const EN_SLIDE_TEXT: Record<string, SlideText> = {
  cover: {
    kicker: 'Speaqi Guides for {{destinazione}}',
    title: 'Your territory.\nOne map.\nSo much more to experience.',
    body: 'A multilingual digital map of your territory, free for selected destinations.'
  },
  partenza: {
    kicker: 'Where we start',
    title: 'Visitors are coming.\nThe information is scattered.',
    items: [
      { title: 'Many languages', text: 'visitors from all over the world, each with their own' },
      { title: 'Many channels', text: 'website, info points, accommodation, operators' },
      { title: 'No shared map', text: 'everyone describes the territory their own way' }
    ]
  },
  proposta: {
    kicker: 'The proposal',
    title: 'A map of your territory, on every visitor’s phone.',
    items: [
      { title: 'Places, routes, points of interest', text: 'in a single digital experience' },
      { title: 'Opens from a link or QR code', text: 'no app to download' },
      { title: 'Before and during the stay', text: 'on the visitor’s phone' }
    ]
  },
  'cosa-ottieni': {
    kicker: 'What you get',
    title: 'What {{destinazione}} gets.',
    items: [
      { title: 'A map of the territory', text: 'places, routes and points of interest' },
      { title: 'Multilingual welcome', text: 'without a separate guide for each language' },
      { title: 'Updates managed together', text: 'in the agreed way' },
      { title: 'A reference for the network', text: 'info points, accommodation and operators' },
      { title: 'On the phone, no app', text: 'with a link or QR code' },
      { title: 'An ongoing collaboration', text: 'within the agreed scope' }
    ]
  },
  lingue: {
    kicker: 'Multilingual',
    title: 'One map, in every visitor’s language.',
    note: 'Multilingual welcome',
    body: 'For visitors from abroad, without a separate guide for each language.'
  },
  catalogo: {
    kicker: 'Examples from the Speaqi catalogue',
    title: 'The maps are already online.',
    items: [
      { title: 'Naples', text: '' },
      { title: 'Rome', text: '' },
      { title: 'Lisbon', text: '' },
      { title: 'Pompeii', text: '' },
      { title: 'Capri', text: '' }
    ],
    note: 'In production',
    body: 'Amalfi Coast · Florence · Milan · Venice · and more',
    footnote: 'Images generated with AI.'
  },
  provala: {
    kicker: 'Try it now',
    title: 'Open the map\nof Naples.',
    body: 'Scan the QR code with your phone'
  },
  'in-azione': {
    kicker: 'Speaqi Guides in action',
    title: 'Speaqi Guides in action'
  },
  collaborazione: {
    kicker: 'The collaboration model',
    title: 'You distribute. We build the map.',
    items: [
      { title: 'The destination', text: 'Distributes Speaqi guides through the agreed channels\nInvolves the local network\nNames a contact person and provides information about the territory' },
      { title: 'Speaqi', text: 'Builds the multilingual map\nKeeps it updated within the agreed scope\nSupports the project as it evolves' }
    ],
    note: 'For selected destinations, the map is free.',
    footnote: 'Duration, scope and continuity of the free offer are defined in the agreement.'
  },
  servizi: {
    kicker: 'Additional services',
    title: 'The Speaqi model.',
    items: [
      { value: 'Businesses', title: 'Additional services for businesses', text: 'For those listed in the guide: for example multilingual video. Who pays: the business.' },
      { value: 'Visitors', title: 'Extras for those who buy the guide', text: 'Concierge, events and other extra content. Who pays: the visitor.' },
      { value: 'Sponsors', title: 'Visibility for sponsors', text: 'Companies and brands that want to be seen in the guide. Who pays: the sponsor.' }
    ],
    note: 'The destination never pays anything. The services are optional.'
  },
  vantaggi: {
    kicker: 'What the destination gains',
    title: 'For the destination, only benefits.',
    items: [
      { title: 'Zero cost', text: 'the map is free and we sell you nothing' },
      { title: 'Visitors welcomed better', text: 'in their language, on their phone, no app' },
      { title: 'A professional map', text: 'built and updated by Speaqi' },
      { title: 'More visibility for businesses', text: 'restaurants, accommodation and operators in the guide' },
      { title: 'A reference for the network', text: 'info points, accommodation and operators on the same map' },
      { title: 'No risk', text: 'no cost, no obligation to buy' }
    ],
    note: 'You distribute the map. We take care of the rest.'
  },
  'chi-scegliamo': {
    kicker: 'Requirements and first steps',
    title: 'Who we choose.',
    items: [
      { value: '250,000', title: 'tourist overnight stays per year', text: '' },
      { value: '2', title: 'active distribution channels', text: '' },
      { value: '1', title: 'dedicated contact person', text: '' },
      { title: 'First meeting', text: 'We review channels and the distribution plan together.' },
      { title: 'Agreement', text: 'Distribution, content, updates and duration.' },
      { title: 'Map online', text: 'You activate the channels, we build and update the map.' }
    ],
    note: 'Also: a body that represents the territory and an ongoing distribution plan.',
    body: 'How we start · no cost for the destination'
  },
  domande: {
    kicker: 'Frequently asked questions',
    title: 'The most common doubts, answered.',
    items: [
      { title: 'Is there anything to pay?', text: 'No. The map is free and we sell nothing to the destination, now or later.' },
      { title: 'Do we have to sell the guides?', text: 'No. Your role is to make the map known through the agreed channels.' },
      { title: 'How much work does it take?', text: 'A contact person who provides local information. We handle building and updates.' },
      { title: 'Do we need an app or a technician?', text: 'No. It opens in the browser with a link or QR code: nothing to install.' },
      { title: 'Who decides what goes in the map?', text: 'The destination approves the content before publication.' },
      { title: 'How long does the collaboration last?', text: 'We define duration and scope together in the agreement, before starting.' }
    ]
  },
  chiusura: {
    title: 'You have the territory. You have the channels.\nLet’s make the map of {{destinazione}}.',
    body: 'Massimo Morgante',
    note: 'Founder & CEO, Speaqi',
    items: [
      { title: '+39 389 6868 162', text: '' },
      { title: 'info@speaqi.com', text: '' },
      { title: 'guides.speaqi.com/destinations', text: '' }
    ],
    footnote: 'Apply for your destination'
  }
}

/** Il modello italiano con le parole inglesi; ciò che il testo inglese non dice resta com'era (immagini, icone, istruzioni). */
export function englishTemplate(source: DeckTemplate = DEFAULT_DECK_TEMPLATE): DeckTemplate {
  return {
    ...structuredClone(source),
    base: DESTINATIONS_BASE_EN,
    slides: source.slides.map((original) => {
      const text = EN_SLIDE_TEXT[original.id]
      const s = structuredClone(original)
      if (!text) return s
      if (text.kicker !== undefined) s.kicker = text.kicker
      if (text.title !== undefined) s.title = text.title
      if (text.body !== undefined) s.body = text.body
      if (text.note !== undefined) s.note = text.note
      if (text.footnote !== undefined) s.footnote = text.footnote
      if (text.items) s.items = s.items.map((item, i) => ({ ...item, ...(text.items![i] || {}) }))
      return s
    })
  }
}

export const DEFAULT_DECK_TEMPLATE_EN: DeckTemplate = englishTemplate()
