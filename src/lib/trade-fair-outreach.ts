/**
 * Mailing agli espositori di una fiera: chi e' in linea con Speaqi riceve un'email
 * scritta per la sua tipologia (e nella sua lingua), da rivedere prima dell'invio.
 * Solo logica pura. Ogni affermazione nei testi e' una cosa che Speaqi fa davvero:
 * niente numeri o referenze inventati.
 */
import { factorOption, type FactorKey } from './opportunity-score'
import { standLabel, type FairExhibitor } from './trade-fair'

export type OutreachState = {
  selected?: boolean
  subject?: string
  body?: string
  template?: string
  lang?: 'it' | 'en'
  generated_at?: string
  edited?: boolean
  note?: string | null
  sent_at?: string | null
  sent_to?: string | null
  message_id?: string | null
  test_sent_at?: string | null
  error?: string | null
  destination_email?: {
    status: 'sending' | 'preparing' | 'draft' | 'sent' | 'unknown'
    token: string
    to: string
    subject: string
    body: string
    sent_at?: string
    message_id?: string
    error?: string
    mode?: 'gmail' | 'direct'
    prepared_at?: string
    gmail_draft_id?: string
    gmail_message_id?: string
    account_email?: string
    message_id_header?: string
    original_text?: string
  }
}

/** Tipologie in linea con quello che vende Speaqi (guide e mappe per chi accoglie turisti). */
export const OUTREACH_TARGET_TYPES = [
  'dmo', 'consorzio', 'assoc_territoriale', 'navigazione', 'dmc', 'tour_operator', 'catena', 'attrazione',
] as const

type Template = 'territorio' | 'navigazione' | 'distribuzione' | 'ospitalita' | 'attrazione'

const TEMPLATE_BY_TYPE: Record<string, Template> = {
  dmo: 'territorio', consorzio: 'territorio', assoc_territoriale: 'territorio',
  navigazione: 'navigazione', dmc: 'distribuzione', tour_operator: 'distribuzione',
  catena: 'ospitalita', hotel: 'ospitalita', attrazione: 'attrazione',
}

export const TEMPLATE_LABELS: Record<Template, string> = {
  territorio: 'Destinazione / ente',
  navigazione: 'Compagnia di navigazione',
  distribuzione: 'DMC / tour operator',
  ospitalita: 'Ospitalità',
  attrazione: 'Museo / attrazione',
}

type Aligned = Pick<FairExhibitor, 'email' | 'status' | 'contact_id' | 'organization_type' | 'lead_class'>

/** Un espositore e' "in linea" se la tipologia e' di quelle sopra, ha un'email e non e' gia' stato lavorato. */
export function isOutreachAligned(row: Aligned) {
  if (!row.email) return false
  if (row.status !== 'new' || row.contact_id) return false
  if (row.lead_class === 'D') return false
  return (OUTREACH_TARGET_TYPES as readonly string[]).includes(row.organization_type || '')
}

export function outreachLanguage(country: string | null | undefined): 'it' | 'en' {
  const c = String(country || '').trim().toLowerCase()
  return !c || c.startsWith('ital') ? 'it' : 'en'
}

const FOOTER = {
  it: `Cordiali saluti,\nMassimo Morgante\nCEO · Speaqi\n+39 389 686 8162\ninfo@speaqi.com\n\n—\nSpeaqi di TheBestItaly · P.IVA 10831191217\nSe preferisce non ricevere altre comunicazioni da Speaqi, mi risponda «no grazie» e non la contatterò più.`,
  en: `Kind regards,\nMassimo Morgante\nCEO · Speaqi\n+39 389 686 8162\ninfo@speaqi.com\n\n—\nSpeaqi di TheBestItaly · VAT IT10831191217\nIf you'd rather not hear from Speaqi again, just reply "no thanks" and I won't contact you again.`,
}

function firstName(person: string | null | undefined) {
  const name = String(person || '').trim().replace(/\s+/g, ' ')
  if (!name || /[@\d/_]/.test(name)) return ''
  return name.split(' ')[0]
}

const COPY: Record<'it' | 'en', {
  hello: (n: string) => string
  intro: (stand: string) => string
  pitch: Record<Template, string>
  subject: Record<Template, (name: string) => string>
  cta: (stand: string, example: string) => string
}> = {
  it: {
    hello: (n) => (n ? `Buongiorno ${n},` : 'Buongiorno,'),
    intro: (stand) => `sono Massimo Morgante, fondatore di Speaqi. Sarò al TTG di Rimini${stand ? ` e mi farebbe piacere passare dal vostro stand (${stand})` : ''}: le scrivo prima, così possiamo vederci con calma.`,
    pitch: {
      territorio: 'Speaqi crea guide digitali multilingua per i territori: mappa interattiva, itinerari, audio-storie in 12 lingue e un concierge AI che risponde solo con le informazioni verificate. La guida di Napoli è già online, e una guida può uscire col marchio dell’ente.',
      navigazione: 'Speaqi crea guide digitali dei porti per i passeggeri: mappa interattiva, itinerari, audio-storie in 12 lingue, uso offline per chi è in roaming e il promemoria dell’orario di rientro a bordo. La compagnia distribuisce codici a tempo (email, app o programma di bordo) e paga solo quelli attivati. La guida di Napoli è già online, Roma/Civitavecchia è in lavorazione.',
      distribuzione: 'Speaqi crea guide digitali multilingua (mappa interattiva, itinerari, audio-storie in 12 lingue) che il cliente apre dal telefono con un QR o un link. Per chi le rivende c’è una vetrina col vostro marchio e una commissione sulle vendite. La guida di Napoli è già online.',
      ospitalita: 'Speaqi trasforma le informazioni della struttura e del territorio in una guida multilingua per gli ospiti: QR in camera, mappa dei dintorni, audio-storie e un concierge AI che risponde solo con le informazioni verificate.',
      attrazione: 'Speaqi crea guide e audio-storie multilingua per i luoghi di visita: ogni punto ha testo, audio e video in più lingue, apribili da un QR.',
    },
    subject: {
      territorio: (n) => `Una guida digitale multilingua per ${n}`,
      navigazione: (n) => `Guide dei porti per i passeggeri di ${n}`,
      distribuzione: (n) => `Guide multilingua per i clienti di ${n}`,
      ospitalita: (n) => `Una guida multilingua per gli ospiti di ${n}`,
      attrazione: (n) => `Audio-storie multilingua per ${n}`,
    },
    cta: (stand, example) => `Se le va, le mostro in dieci minuti come potrebbe funzionare per voi${stand ? ` (passo allo stand, oppure fissiamo una chiamata)` : ' (anche con una breve chiamata)'}. Un esempio da guardare subito: ${example}`,
  },
  en: {
    hello: (n) => (n ? `Hello ${n},` : 'Hello,'),
    intro: (stand) => `I'm Massimo Morgante, founder of Speaqi. I'll be at TTG in Rimini${stand ? ` and would love to stop by your stand (${stand})` : ''}: I'm writing ahead so we can meet without rushing.`,
    pitch: {
      territorio: 'Speaqi builds multilingual digital guides for destinations: an interactive map, itineraries, audio stories in 12 languages and an AI concierge that answers only from verified information. Our Naples guide is already live, and a guide can carry your organisation’s brand.',
      navigazione: 'Speaqi builds digital port guides for passengers: an interactive map, itineraries, audio stories in 12 languages, offline use for travellers without roaming and a reminder of the time to be back on board. The cruise line hands out time-limited codes (email, app or onboard programme) and only pays for the codes that are activated. Our Naples guide is live; Rome/Civitavecchia is in progress.',
      distribuzione: 'Speaqi builds multilingual digital guides (interactive map, itineraries, audio stories in 12 languages) that clients open on their phone with a QR code or a link. For partners who resell them there is a storefront under your own brand, with a commission on sales. Our Naples guide is already live.',
      ospitalita: 'Speaqi turns a property’s information and its surroundings into a multilingual guide for guests: a QR code in the room, a map of the area, audio stories and an AI concierge that answers only from verified information.',
      attrazione: 'Speaqi builds multilingual guides and audio stories for places to visit: every point has text, audio and video in several languages, opened from a QR code.',
    },
    subject: {
      territorio: (n) => `A multilingual digital guide for ${n}`,
      navigazione: (n) => `Port guides for ${n} passengers`,
      distribuzione: (n) => `Multilingual guides for ${n} clients`,
      ospitalita: (n) => `A multilingual guest guide for ${n}`,
      attrazione: (n) => `Multilingual audio stories for ${n}`,
    },
    cta: (stand, example) => `If you like, I can show you in ten minutes how it could work for you${stand ? ' (I can come by the stand, or we can have a quick call)' : ' (a short call is fine too)'}. An example to look at right now: ${example}`,
  },
}

export const OUTREACH_EXAMPLE_URL = 'https://guides.speaqi.com'

type OutreachInput = Pick<FairExhibitor, 'name' | 'country' | 'hall' | 'stand' | 'contact_person' | 'organization_type'>

export function buildOutreach(row: OutreachInput): { template: Template; lang: 'it' | 'en'; subject: string; body: string } | null {
  const template = TEMPLATE_BY_TYPE[row.organization_type || '']
  if (!template) return null
  const lang = outreachLanguage(row.country)
  const copy = COPY[lang]
  const stand = standLabel(row)
  const name = row.name.trim()
  const body = [
    copy.hello(firstName(row.contact_person)),
    copy.intro(stand),
    copy.pitch[template],
    copy.cta(stand, OUTREACH_EXAMPLE_URL),
    FOOTER[lang],
  ].join('\n\n')
  return { template, lang, subject: copy.subject[template](name), body }
}

/** Il testo prima del footer: serve a capire se qualcuno l'ha riscritto. */
export function outreachHasFooter(body: string) {
  return /Speaqi di TheBestItaly/.test(body)
}

/** Righe da preparare, in ordine di priorita'; la stessa email non riceve due messaggi. */
export function planOutreach<T extends FairExhibitor>(rows: T[]) {
  const aligned = rows
    .filter(isOutreachAligned)
    .sort((a, b) => (b.ttg_priority_score ?? b.score) - (a.ttg_priority_score ?? a.score) || a.name.localeCompare(b.name))
  const seen = new Set<string>()
  return aligned.map((row) => {
    const key = String(row.email).toLowerCase()
    const duplicate = seen.has(key)
    seen.add(key)
    return { row, duplicate }
  })
}

export const DAILY_OUTREACH_CAP = 40

export function organizationTypeLabel(row: Pick<FairExhibitor, 'organization_type'>) {
  return factorOption('organization_type' as FactorKey, row.organization_type)?.label || null
}
