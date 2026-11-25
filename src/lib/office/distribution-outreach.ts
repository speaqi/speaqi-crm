// Agente Distribuzione: regole pure (niente rete, niente database), coperte da test.
// Chi contattare oggi, cosa scrivere a ogni tappa, quando inviare, come leggere una risposta.
// Il modello scrive al massimo una frase d'apertura su misura (`acceptHook`): il resto del
// testo, con cifre e link, è scritto qui, così non può promettere niente che non esista.

import { guideLabel } from '../tourism-distribution'
import { EMAIL_SENDER_NAME } from '../email-ai-framework'

export const DISTRIBUTION_STEPS = 3
/** Giorni lavorativi fra una tappa e la successiva: la 2 dopo 4, la 3 dopo altri 6. */
export const FOLLOWUP_GAP_BUSINESS_DAYS: Readonly<Record<number, number>> = { 1: 4, 2: 6 }
export const DEFAULT_DAILY_NEW = 5
export const MAX_DAILY_NEW = 20
export const DEFAULT_CITY_ORDER = ['roma', 'napoli', 'milano', 'venezia', 'firenze', 'costiera-amalfitana', 'capri', 'bologna', 'pompei'] as const
export const DISTRIBUTION_FROM_DEFAULT = 'info@speaqi.com'
export const GUIDES_HOME = 'https://guides.speaqi.com'

export type Segment = 'operator' | 'agency' | 'hospitality' | 'transport' | 'other'
export type Language = 'it' | 'en'

export function segmentOf(typeCode: string | null | undefined): Segment {
  switch (typeCode) {
    case 'dmc': case 'tour_operator': case 'experience_marketplace': return 'operator'
    case 'travel_agency': case 'ota': case 'bedbank': case 'consortium': case 'network': return 'agency'
    case 'property_manager': case 'accommodation': return 'hospitality'
    case 'ferry_operator': case 'transport': case 'rail_operator': case 'cruise_line': case 'airline': return 'transport'
    default: return 'other'
  }
}

/** Italiano a chi sta in Italia (o a San Marino e in Vaticano), inglese a tutti gli altri. */
export function languageOf(countryCode: string | null | undefined): Language {
  return ['IT', 'SM', 'VA'].includes(String(countryCode || '').toUpperCase()) ? 'it' : 'en'
}

export function emailDomain(email: string) {
  return email.trim().toLowerCase().split('@')[1] || ''
}

const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i
/** Caselle che non leggono proposte commerciali, o che appartengono a una persona. */
const WRONG_MAILBOX = /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|abuse|privacy|gdpr|dpo|legal|pr|press|media|ufficiostampa|officepress|pressoffice|[a-z]*pressoffice|jobs|careers|lavora(conno)?i|hr|recruiting|invoice|fatture|amministrazione|billing|accounts?)$/

/**
 * Si scrive solo a caselle d'ufficio: la base è il legittimo interesse B2B verso l'azienda,
 * non verso una persona. Niente PEC, niente caselle tecniche o dell'ufficio stampa, niente
 * «nome.cognome».
 */
export function acceptableMailbox(email: string | null | undefined): boolean {
  const value = String(email || '').trim().toLowerCase()
  if (!EMAIL_RE.test(value)) return false
  const [local, domain] = value.split('@')
  if (/(^|\.)pec\.|legalmail|postacert|(^|\.)cert\./.test(domain)) return false
  if (/^(gmail|googlemail|hotmail|outlook|live|yahoo|libero|virgilio|alice|tiscali|icloud|me)\./.test(domain)) return false
  if (WRONG_MAILBOX.test(local)) return false
  if (/^[a-z]{2,}\.[a-z]{2,}$/.test(local) && !/^(info|sales|booking|reservations?|contact|hello)\./.test(local)) return false
  return true
}

export type DistributionRow = {
  entity_id: string
  name: string
  type_code: string | null
  country_code: string | null
  website: string | null
  email: string | null
  score: number
  tier: string
  quick_win: boolean
  guide_slugs: string[]
  commercial_status: string
}

export type DistributionCandidate = DistributionRow & {
  email: string
  domain: string
  guide_slug: string
  segment: Segment
  language: Language
}

/** La guida da proporre: la prima, nell'ordine delle città, fra quelle che l'ente copre. */
export function primaryGuide(slugs: readonly string[], cityOrder: readonly string[] = DEFAULT_CITY_ORDER): string | null {
  for (const slug of cityOrder) if (slugs.includes(slug)) return slug
  return slugs[0] || null
}

const tierRank = (tier: string) => ({ A: 0, B: 1, C: 2, D: 3 } as Record<string, number>)[tier] ?? 4

/**
 * I contatti di oggi: fascia A o B, legati a una guida, con una casella d'ufficio, non
 * già contattati (per ente e per dominio: due marchi dello stesso gruppo sono una persona
 * sola dall'altra parte). Prima le vittorie rapide, poi la fascia, poi il punteggio;
 * fra le città si gira, così una città con trecento enti non si prende tutti i posti.
 */
export function selectDistributionCandidates(input: {
  rows: readonly DistributionRow[]
  limit: number
  excludedEntityIds?: Iterable<string>
  excludedDomains?: Iterable<string>
  excludedEmails?: Iterable<string>
  cityOrder?: readonly string[]
  /** Da quale città parte il giro oggi (cambia ogni giorno). */
  rotation?: number
}): DistributionCandidate[] {
  const limit = Math.max(0, Math.floor(input.limit))
  if (!limit) return []
  const cityOrder = input.cityOrder?.length ? input.cityOrder : DEFAULT_CITY_ORDER
  const skipEntities = new Set(input.excludedEntityIds || [])
  const skipDomains = new Set([...(input.excludedDomains || [])].map((d) => d.toLowerCase()))
  const skipEmails = new Set([...(input.excludedEmails || [])].map((e) => e.toLowerCase()))
  const buckets = new Map<string, DistributionCandidate[]>()
  const sorted = [...input.rows].sort((a, b) => Number(b.quick_win) - Number(a.quick_win)
    || tierRank(a.tier) - tierRank(b.tier) || b.score - a.score || a.entity_id.localeCompare(b.entity_id))
  for (const row of sorted) {
    if (!['A', 'B'].includes(row.tier)) continue
    if (!['new', 'qualified'].includes(row.commercial_status)) continue
    if (skipEntities.has(row.entity_id)) continue
    const email = String(row.email || '').trim().toLowerCase()
    if (!acceptableMailbox(email) || skipEmails.has(email)) continue
    const guide = primaryGuide(row.guide_slugs.filter((s) => cityOrder.includes(s)), cityOrder)
    if (!guide) continue
    const candidate: DistributionCandidate = { ...row, email, domain: emailDomain(email), guide_slug: guide,
      segment: segmentOf(row.type_code), language: languageOf(row.country_code) }
    const list = buckets.get(guide) || []
    list.push(candidate)
    buckets.set(guide, list)
  }
  const cities = cityOrder.filter((c) => buckets.has(c))
  if (!cities.length) return []
  const start = Math.abs(Math.floor(input.rotation || 0)) % cities.length
  const order = [...cities.slice(start), ...cities.slice(0, start)]
  const picked: DistributionCandidate[] = []
  const seenDomains = new Set(skipDomains)
  let progress = true
  while (picked.length < limit && progress) {
    progress = false
    for (const city of order) {
      const list = buckets.get(city)!
      while (list.length) {
        const next = list.shift()!
        if (seenDomains.has(next.domain)) continue
        seenDomains.add(next.domain)
        picked.push(next)
        progress = true
        break
      }
      if (picked.length >= limit) break
    }
  }
  return picked
}

// ——— Calendario ———

/** Aggiunge giorni lavorativi (lun-ven), all'ora di partenza. */
export function addBusinessDays(from: Date, days: number): Date {
  const date = new Date(from.getTime())
  let left = Math.max(0, Math.floor(days))
  while (left > 0) {
    date.setUTCDate(date.getUTCDate() + 1)
    const dow = date.getUTCDay()
    if (dow !== 0 && dow !== 6) left--
  }
  return date
}

export function nextDueAfterStep(step: number, sentAt: Date): Date | null {
  const gap = FOLLOWUP_GAP_BUSINESS_DAYS[step]
  return gap ? addBusinessDays(sentAt, gap) : null
}

const COUNTRY_TZ: Readonly<Record<string, string>> = {
  IT: 'Europe/Rome', SM: 'Europe/Rome', VA: 'Europe/Rome', MT: 'Europe/Malta', FR: 'Europe/Paris', DE: 'Europe/Berlin',
  ES: 'Europe/Madrid', PT: 'Europe/Lisbon', GB: 'Europe/London', IE: 'Europe/Dublin', NL: 'Europe/Amsterdam',
  BE: 'Europe/Brussels', CH: 'Europe/Zurich', AT: 'Europe/Vienna', GR: 'Europe/Athens', HR: 'Europe/Zagreb',
  PL: 'Europe/Warsaw', CZ: 'Europe/Prague', HU: 'Europe/Budapest', RO: 'Europe/Bucharest', SE: 'Europe/Stockholm',
  NO: 'Europe/Oslo', DK: 'Europe/Copenhagen', FI: 'Europe/Helsinki', TR: 'Europe/Istanbul', US: 'America/New_York',
  CA: 'America/Toronto', BR: 'America/Sao_Paulo', AR: 'America/Argentina/Buenos_Aires', MX: 'America/Mexico_City',
  AU: 'Australia/Sydney', NZ: 'Pacific/Auckland', JP: 'Asia/Tokyo', CN: 'Asia/Shanghai', KR: 'Asia/Seoul',
  IN: 'Asia/Kolkata', AE: 'Asia/Dubai', IL: 'Asia/Jerusalem', SG: 'Asia/Singapore', ZA: 'Africa/Johannesburg',
}
export function timeZoneOf(countryCode: string | null | undefined) {
  return COUNTRY_TZ[String(countryCode || '').toUpperCase()] || 'Europe/Rome'
}

/** Si invia in orario d'ufficio del destinatario: lun-ven, dalle 9 alle 17 (ora locale). */
export function withinSendWindow(now: Date, countryCode: string | null | undefined): boolean {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timeZoneOf(countryCode), weekday: 'short', hour: '2-digit', hour12: false })
    .formatToParts(now)
  const weekday = parts.find((p) => p.type === 'weekday')?.value || ''
  const hour = Number(parts.find((p) => p.type === 'hour')?.value)
  return !['Sat', 'Sun'].includes(weekday) && hour >= 9 && hour < 17
}

// ——— Testi ———

/** Le pagine delle guide sul negozio (indirizzo = nome della città, Napoli compresa). */
export function guideUrl(slug: string) {
  return `${GUIDES_HOME}/${slug}`
}

const AUDIENCE: Record<Language, Record<Segment, string>> = {
  it: {
    operator: 'nei tour e nei pacchetti che organizzate',
    agency: 'insieme ai viaggi che vendete',
    hospitality: 'ai vostri ospiti',
    transport: 'ai vostri passeggeri',
    other: 'ai vostri clienti',
  },
  en: {
    operator: 'within the tours and packages you organise',
    agency: 'alongside the trips you sell',
    hospitality: 'to your guests',
    transport: 'to your passengers',
    other: 'to your customers',
  },
}

const OPT_OUT: Record<Language, string> = {
  it: 'Se non è un tema che vi riguarda, me lo dica pure con una riga e non la ricontatterò.',
  en: 'If this isn’t relevant for you, just reply with a line and I won’t contact you again.',
}

export function signature(language: Language) {
  return language === 'it' ? `${EMAIL_SENDER_NAME}\nFondatore, Speaqi\n${GUIDES_HOME.replace('https://', '')}`
    : `${EMAIL_SENDER_NAME}\nFounder, Speaqi\n${GUIDES_HOME.replace('https://', '')}`
}

export type MessageInput = { step: number; language: Language; segment: Segment; guideSlug: string; hook?: string | null }

/**
 * Le tre email della sequenza. Le cifre (20%) e i link sono solo questi: sono le condizioni
 * del programma partner B2B (accordo standard del 31/10/2026) e le pagine delle guide.
 */
export function buildDistributionMessage(input: MessageInput): { subject: string; body: string } {
  const city = guideLabel(input.guideSlug)
  const url = guideUrl(input.guideSlug)
  const audience = AUDIENCE[input.language][input.segment]
  const hook = input.hook ? `${input.hook.trim()}\n\n` : ''
  if (input.language === 'it') {
    const subject = `Guide di ${city} per i vostri clienti: proposta di collaborazione`
    if (input.step === 1) return { subject, body: [
      `Buongiorno,\nsono ${EMAIL_SENDER_NAME}, fondatore di Speaqi.`,
      `${hook}Con Speaqi Guides pubblichiamo guide digitali delle città: mappa, itinerari e racconti audio e video dei luoghi, in più lingue, da aprire sul telefono senza installare niente. La guida di ${city} è online: ${url}`,
      `Cerchiamo partner che la propongano ${audience}. Il modello è semplice:\n- un link e un QR con il vostro nome, e una vetrina con le guide che scegliete;\n- una commissione del 20% sul netto di ogni guida venduta tramite voi, senza costi né minimi;\n- per chi preferisce, codici prepagati da inserire nei vostri pacchetti.`,
      'Se le interessa le mando la presentazione, oppure ci sentiamo dieci minuti quando le è comodo.',
      OPT_OUT.it, signature('it'),
    ].join('\n\n') }
    if (input.step === 2) return { subject: `Re: ${subject}`, body: [
      'Buongiorno,',
      `riprendo in breve la mia email dei giorni scorsi: la guida di ${city} (${url}) da proporre ${audience}, con il 20% su ogni vendita e nessun costo per voi.`,
      'Le posso mandare la presentazione?',
      OPT_OUT.it, signature('it'),
    ].join('\n\n') }
    return { subject: `Re: ${subject}`, body: [
      'Buongiorno,',
      `è l’ultima volta che le scrivo su questo. Se in futuro vorrete offrire ${audience} la guida di ${city} e quelle delle altre città, con una commissione su ogni vendita, mi basta una risposta a questa email.`,
      'Grazie dell’attenzione e buon lavoro.',
      signature('it'),
    ].join('\n\n') }
  }
  const subject = `${city} city guides for your customers: partnership proposal`
  if (input.step === 1) return { subject, body: [
    `Hello,\nI’m ${EMAIL_SENDER_NAME}, founder of Speaqi.`,
    `${hook}Speaqi Guides publishes digital city guides: a map, itineraries and audio and video stories of each place, in several languages, opened on the phone with nothing to install. The ${city} guide is live: ${url}`,
    `We are looking for partners to offer it ${audience}. The model is simple:\n- a link and a QR code with your name, and a showcase with the guides you choose;\n- a 20% commission on the net amount of every guide sold through you, with no fees and no minimums;\n- if you prefer, prepaid codes to include in your packages.`,
    'If you are interested I can send you our presentation, or we can have a ten-minute call whenever suits you.',
    OPT_OUT.en, signature('en'),
  ].join('\n\n') }
  if (input.step === 2) return { subject: `Re: ${subject}`, body: [
    'Hello,',
    `just a short follow-up on my email from the past days: the ${city} guide (${url}) to offer ${audience}, with 20% on every sale and no cost for you.`,
    'May I send you the presentation?',
    OPT_OUT.en, signature('en'),
  ].join('\n\n') }
  return { subject: `Re: ${subject}`, body: [
    'Hello,',
    `this is the last time I write about this. If one day you would like to offer the ${city} guide and those of other cities ${audience}, with a commission on every sale, a reply to this email is all it takes.`,
    'Thank you for your time and all the best.',
    signature('en'),
  ].join('\n\n') }
}

/**
 * La frase d'apertura scritta dal modello vale solo se è una frase o due su di loro, senza
 * cifre, link, indirizzi email, prezzi o promesse: altrimenti l'email parte senza.
 */
export function acceptHook(hook: unknown, entityName: string): string | null {
  if (typeof hook !== 'string') return null
  const text = hook.replace(/\s+/g, ' ').trim()
  if (text.length < 30 || text.length > 280) return null
  if (/\d|https?:|www\.|@|€|\$|%/.test(text)) return null
  if ((text.match(/[.!?](\s|$)/g) || []).length > 2) return null
  if (/\b(garantit|gratis|gratuit|free\b|guarantee|miglior|best\b|leader\b|numero uno|unic[oa]\b|only\b)/i.test(text)) return null
  if (/speaqi/i.test(text)) return null
  const words = entityName.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4)
  if (words.length && !words.some((w) => text.toLowerCase().includes(w))) return null
  return text
}

// ——— Risposte ———

export type ReplyKind = 'out_of_office' | 'unsubscribe' | 'not_interested' | 'reply'

/** Una risposta automatica non ferma la sequenza; un «no» la chiude; il resto va a una persona. */
export function classifyReply(input: { subject?: string | null; body?: string | null }): ReplyKind {
  const subject = String(input.subject || '').toLowerCase()
  const body = String(input.body || '').toLowerCase().slice(0, 3000)
  const text = `${subject}\n${body}`
  if (/(risposta automatica|automatic reply|auto[- ]?reply|out of (the )?office|fuori ufficio|abwesenheit|absence|réponse automatique|respuesta automática|sono assente|i am (currently )?(away|out)|on (annual )?leave|in ferie)/.test(text)) return 'out_of_office'
  if (/(unsubscribe|cancellami|cancellatemi|rimuov|togliete|toglietemi|remove (me|us)|do not contact|non contattate|stop (sending|emailing))/.test(text)) return 'unsubscribe'
  if (/(non (siamo|sono) interessat|not interested|no,? grazie|no thank|non ci interessa|non è di nostro interesse|not (a good )?fit for us|we are not looking)/.test(text)) return 'not_interested'
  return 'reply'
}

/** Un ritorno al mittente: arriva dal server di posta, non da chi abbiamo scritto. */
export function isBounce(input: { from?: string | null; subject?: string | null }): boolean {
  const from = String(input.from || '').toLowerCase()
  const subject = String(input.subject || '').toLowerCase()
  return /(mailer-daemon|postmaster)@/.test(from)
    || /(delivery status notification|undeliverable|mail delivery (failed|subsystem)|returned mail|non recapitabile|impossibile recapitare|delivery has failed)/.test(subject)
}

/** Quale fase della trattativa e quale stato commerciale dopo una risposta. */
export function outcomeOf(kind: Exclude<ReplyKind, 'out_of_office'> | 'bounce'): {
  outreach: 'replied' | 'stopped' | 'bounced'; dealStage: 'trattativa' | 'persa' | null; commercial: 'replied' | 'not_fit' | null
} {
  if (kind === 'bounce') return { outreach: 'bounced', dealStage: null, commercial: null }
  if (kind === 'reply') return { outreach: 'replied', dealStage: 'trattativa', commercial: 'replied' }
  return { outreach: 'stopped', dealStage: 'persa', commercial: 'not_fit' }
}

/** Il giorno di Roma (AAAA-MM-GG) e un numero che cambia ogni giorno, per far girare le città. */
export function romeDay(now: Date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}
export function dayRotation(now: Date) {
  return Math.floor(Date.parse(`${romeDay(now)}T00:00:00Z`) / 86400_000)
}
