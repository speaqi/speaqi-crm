import { load } from 'cheerio'
import { newsUrl } from './news'
import { officeRomeDay } from './finance'

export const EVENT_KINDS = ['fair', 'b2b_workshop', 'grant', 'conference'] as const
export type EventKind = typeof EVENT_KINDS[number]
export type EventDeadline = { kind: 'exhibitor_registration' | 'grant'; date: string }
export type OfficeEvent = { slug: string; name: string; start_date: string; end_date: string | null; city: string | null;
  country_code: string | null; organizer: string | null; url: string; kind: EventKind; deadlines: EventDeadline[]; score: number; source_url: string }
export type EventPage = { source_url: string; text: string; links: string[]; dates: string[]; structured: boolean; candidates: unknown[] }

export function eventSlug(name: string) {
  return name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/ß/g, 'ss').replace(/ł/g, 'l')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}
export function eventDate(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = /^(\d{4})-?(\d{2})-?(\d{2})(?:$|T)/.exec(value.trim())
  if (!match) return null
  const date = `${match[1]}-${match[2]}-${match[3]}`
  const parsed = new Date(`${date}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : null
}
export function eventHorizon(day: string) {
  const date = new Date(`${day}T00:00:00Z`)
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 7, 0))
  last.setUTCDate(Math.min(date.getUTCDate(), last.getUTCDate()))
  return last.toISOString().slice(0, 10)
}
const MONTHS = ['gennaio january janvier januar enero', 'febbraio february février februar febrero', 'marzo march mars märz marzo',
  'aprile april avril abril', 'maggio may mai mayo', 'giugno june juin juni junio', 'luglio july juillet juli julio',
  'agosto august août agosto', 'settembre september septembre septiembre', 'ottobre october octobre oktober octubre',
  'novembre november noviembre', 'dicembre december décembre dezember diciembre']
function pageDates(text: string) {
  const dates = new Set<string>()
  const add = (value: string) => { const date = eventDate(value); if (date) dates.add(date) }
  for (const match of text.matchAll(/\b\d{4}-\d{2}-\d{2}(?:T[\d:.Z+-]+)?|\b\d{8}(?:T\d{6}Z?)?\b/g)) add(match[0])
  for (const match of text.matchAll(/\b(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b/g)) add(`${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`)
  for (const match of text.matchAll(/\b(\d{1,2})\s+([\p{L}]+)\s+(\d{4})\b/gu)) {
    const month = MONTHS.findIndex((names) => names.split(' ').includes(match[2].toLowerCase()))
    if (month >= 0) add(`${match[3]}-${String(month + 1).padStart(2, '0')}-${match[1].padStart(2, '0')}`)
  }
  return [...dates].sort().slice(0, 1000)
}
const COUNTRY_NAMES: Record<string, string[]> = {
  IT: ['Italia', 'Italy'], FR: ['Francia', 'France'], ES: ['Spagna', 'Spain', 'España'], DE: ['Germania', 'Germany', 'Deutschland'],
  GB: ['Regno Unito', 'United Kingdom'], PT: ['Portogallo', 'Portugal'], GR: ['Grecia', 'Greece'], HR: ['Croazia', 'Croatia'],
  AT: ['Austria'], CH: ['Svizzera', 'Switzerland'], BE: ['Belgio', 'Belgium'], NL: ['Paesi Bassi', 'Netherlands'],
  PL: ['Polonia', 'Poland'], CZ: ['Cechia', 'Czechia'], MT: ['Malta'], IE: ['Irlanda', 'Ireland'], US: ['United States'],
  DK: ['Danimarca', 'Denmark'], SE: ['Svezia', 'Sweden'], NO: ['Norvegia', 'Norway'], FI: ['Finlandia', 'Finland'], RO: ['Romania']
}
function countryCode(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const code = value.trim().toUpperCase()
  if (/^[A-Z]{2}$/.test(code) && new Intl.DisplayNames(['en'], { type: 'region' }).of(code) !== code && code !== 'ZZ') return code
  return Object.entries(COUNTRY_NAMES).find(([, names]) => names.some((name) => name.toLowerCase() === value.trim().toLowerCase()))?.[0] || null
}
function inferKind(text: string): EventKind {
  if (/\b(bando|grant|finanziament|funding)\b/i.test(text)) return 'grant'
  if (/\b(workshop|b2b)\b/i.test(text)) return 'b2b_workshop'
  if (/fiera|\bfair\b|\bexpo\b|exhibition/i.test(text)) return 'fair'
  return 'conference'
}
export function scoreEvent(event: Pick<OfficeEvent, 'name' | 'organizer' | 'kind'>, sourceContext = '') {
  const text = `${event.name} ${event.organizer || ''} ${sourceContext}`.toLowerCase()
  const weights: Array<[RegExp, number]> = [[/turis|touris/, 25], [/destinaz|destination/, 15], [/croci|cruis/, 20],
    [/muse[oui]|museum/, 15], [/\bdmc\b/, 20], [/hospitality|ospitalit/, 20], [/\bwine\b|\bvino\b|enotur/, 10], [/guide digital|digital guide|mappe digital/, 25]]
  const keywords = weights.reduce((sum, [expression, weight]) => sum + (expression.test(text) ? weight : 0), 0)
  return keywords ? Math.min(100, keywords + ({ fair: 15, b2b_workshop: 20, grant: 25, conference: 10 })[event.kind]) : 0
}

/** Legge strutture e conserva le prove, senza seguire i link della pagina. */
export function readEventPage(body: string, sourceUrl: string): EventPage {
  const source = newsUrl(sourceUrl)
  if (!source) throw new Error('Fonte eventi non pubblica')
  const $ = load(body); const links = new Set<string>(); const candidates: unknown[] = []; let structured = false
  const link = (raw: unknown) => { const url = newsUrl(raw, source); if (url && url.length <= 2000 && links.size < 500) links.add(url); return url }
  $('a[href],link[href]').each((_, node) => { link($(node).attr('href')) })
  let visited = 0
  const walk = (value: any, depth = 0) => {
    if (!value || typeof value !== 'object' || depth > 10 || ++visited > 3000) return
    if (Array.isArray(value)) { for (const entry of value.slice(0, 200)) walk(entry, depth + 1); return }
    const types = Array.isArray(value['@type']) ? value['@type'] : [value['@type']]
    if (types.some((type) => typeof type === 'string' && /(?:^|\/)\w*Event$/.test(type))) {
      structured = true
      const address = value.location?.address || {}; const organizer = typeof value.organizer === 'string' ? value.organizer : value.organizer?.name
      const deadlines = [
        { kind: 'exhibitor_registration', date: value.exhibitorRegistrationDeadline || value.registrationDeadline },
        { kind: 'grant', date: value.applicationDeadline }
      ].filter((deadline) => deadline.date)
      for (const property of Array.isArray(value.additionalProperty) ? value.additionalProperty : []) {
        if (/exhibitor|iscrizion.*espositor/i.test(property.name)) deadlines.push({ kind: 'exhibitor_registration', date: property.value })
        else if (/scadenza.*bando|application.*deadline/i.test(property.name)) deadlines.push({ kind: 'grant', date: property.value })
      }
      candidates.push({ name: value.name, start_date: value.startDate, end_date: value.endDate || null, city: address.addressLocality || null,
        country_code: countryCode(typeof address.addressCountry === 'object' ? address.addressCountry?.name : address.addressCountry),
        organizer: organizer || null, url: link(value.url || value['@id']), kind: inferKind(`${value.name} ${value.description || ''} ${types.join(' ')}`), deadlines })
    }
    for (const [key, child] of Object.entries(value)) {
      if ((key === 'url' || key === '@id') && typeof child === 'string') link(child)
      if (child && typeof child === 'object') walk(child, depth + 1)
    }
  }
  $('script[type="application/ld+json"]').slice(0, 30).each((_, node) => { try { walk(JSON.parse($(node).text())) } catch { /* JSON-LD invalido non è una fonte strutturata valida. */ } })
  const unfolded = body.replace(/\r?\n[ \t]/g, '')
  for (const match of unfolded.matchAll(/BEGIN:VEVENT\r?\n([\s\S]*?)\r?\nEND:VEVENT/g)) {
    structured = true
    const properties = new Map<string, string>()
    for (const line of match[1].split(/\r?\n/)) {
      const parts = /^([^:;]+)(?:;[^:]*)?:(.*)$/.exec(line)
      if (parts) properties.set(parts[1].toUpperCase(), parts[2].replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1'))
      if (parts?.[1].toUpperCase() === 'ORGANIZER') {
        const name = /;CN=(?:"([^"]+)"|([^;:]+))/i.exec(line)
        if (name) properties.set('X-ORGANIZER-NAME', name[1] || name[2])
      }
    }
    candidates.push({ name: properties.get('SUMMARY'), start_date: properties.get('DTSTART'), end_date: properties.get('DTEND') || null,
      city: properties.get('X-CITY') || null, country_code: countryCode(properties.get('X-COUNTRY')), organizer: properties.get('X-ORGANIZER-NAME') || null, url: link(properties.get('URL')),
      kind: inferKind(`${properties.get('SUMMARY')} ${properties.get('CATEGORIES')}`), deadlines: [
        { kind: 'exhibitor_registration', date: properties.get('X-EXHIBITOR-REGISTRATION-DEADLINE') }, { kind: 'grant', date: properties.get('X-APPLICATION-DEADLINE') }
      ].filter((deadline) => deadline.date) })
  }
  const xml = load(body, { xmlMode: true })
  xml('item,entry').slice(0, 100).each((_, node) => {
    structured = true
    const item = xml(node); const field = (selectors: string) => item.find(selectors).first().text().trim()
    const url = item.find('link[href]').attr('href') || field('link')
    candidates.push({ name: field('title'), start_date: field('startDate,startdate,ev\\:startdate,dtstart'), end_date: field('endDate,enddate,ev\\:enddate,dtend') || null,
      city: field('city,ev\\:location') || null, country_code: countryCode(field('country,country_code')), organizer: field('organizer') || null,
      url: link(url), kind: inferKind(`${field('title')} ${field('category')}`), deadlines: [
        { kind: 'exhibitor_registration', date: field('registrationDeadline') }, { kind: 'grant', date: field('applicationDeadline') }
      ].filter((deadline) => deadline.date) })
  })
  const visible = (body.includes('BEGIN:VCALENDAR') ? unfolded : $.root().text()).replace(/\s+/g, ' ').trim()
  return { source_url: source, text: visible.slice(0, 60000), links: [...links], dates: pageDates(`${body}\n${visible}`), structured, candidates: candidates.slice(0, 100) }
}

/** Il modello non può inventare date, nomi, località, organizzatori o link. */
export function validateEvent(value: any, page: EventPage, now: Date): OfficeEvent | null {
  if (!value || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 240 || !EVENT_KINDS.includes(value.kind)) return null
  const name = value.name.replace(/\s+/g, ' ').trim(); const slug = eventSlug(name)
  const start = eventDate(value.start_date), end = value.end_date === null || !value.end_date ? null : eventDate(value.end_date)
  const day = officeRomeDay(now), horizon = eventHorizon(day), url = newsUrl(value.url, page.source_url)
  if (!slug || !start || start < day || start > horizon || !page.dates.includes(start) || (value.end_date && !end)
    || (end && (end < start || end > horizon || !page.dates.includes(end))) || !url || !page.links.includes(url)) return null
  const contains = (text: string) => page.text.normalize('NFKC').toLowerCase().includes(text.normalize('NFKC').toLowerCase())
  if (!contains(name)) return null
  const nullableText = (raw: unknown) => raw === null || raw === undefined || raw === '' ? null : typeof raw === 'string' && raw.trim().length <= 200 && contains(raw.trim()) ? raw.trim() : false
  const city = nullableText(value.city), organizer = nullableText(value.organizer)
  if (city === false || organizer === false) return null
  const country = countryCode(value.country_code)
  if (value.country_code && (!country || (!new RegExp(`\\b${country}\\b`).test(page.text) && !(COUNTRY_NAMES[country] || []).some(contains)))) return null
  if (!Array.isArray(value.deadlines) || value.deadlines.length > 10) return null
  const deadlines: EventDeadline[] = []
  for (const raw of value.deadlines) {
    if (!raw || !['exhibitor_registration', 'grant'].includes(raw.kind)) return null
    const date = eventDate(raw.date)
    if (!date || !page.dates.includes(date)) return null
    if (date < day || date > horizon) continue
    const previous = deadlines.find((deadline) => deadline.kind === raw.kind)
    if (previous) previous.date = previous.date < date ? previous.date : date
    else deadlines.push({ kind: raw.kind, date })
  }
  const event: OfficeEvent = { slug, name, start_date: start, end_date: end, city, country_code: country, organizer, url,
    kind: value.kind, deadlines: deadlines.sort((a, b) => a.date.localeCompare(b.date)), score: 0, source_url: page.source_url }
  const position = page.text.toLowerCase().indexOf(name.toLowerCase())
  const context = position >= 0 ? page.text.slice(Math.max(0, position - 200), position + name.length + 500) : ''
  event.score = scoreEvent(event, context)
  return event.score > 0 ? event : null
}
export function selectEvents(events: OfficeEvent[], seen: Array<{ slug: string; start_date: string }> = []) {
  const existing = new Set(seen.map((event) => `${event.slug}:${event.start_date}`)); const unique: OfficeEvent[] = []
  for (const event of events) {
    const key = `${event.slug}:${event.start_date}`
    if (!existing.has(key)) { existing.add(key); unique.push(event) }
  }
  return unique.sort((a, b) => (a.deadlines[0]?.date || a.start_date).localeCompare(b.deadlines[0]?.date || b.start_date) || b.score - a.score || a.slug.localeCompare(b.slug))
}
export const EVENTS_OUTPUT_SCHEMA = { type: 'object', additionalProperties: false, required: ['events'], properties: {
  events: { type: 'array', maxItems: 20, items: { type: 'object', additionalProperties: false,
    required: ['name', 'start_date', 'end_date', 'city', 'country_code', 'organizer', 'url', 'kind', 'deadlines'], properties: {
      name: { type: 'string' }, start_date: { type: 'string' }, end_date: { type: ['string', 'null'] }, city: { type: ['string', 'null'] },
      country_code: { type: ['string', 'null'] }, organizer: { type: ['string', 'null'] }, url: { type: 'string' }, kind: { type: 'string', enum: EVENT_KINDS },
      deadlines: { type: 'array', maxItems: 2, items: { type: 'object', additionalProperties: false, required: ['kind', 'date'],
        properties: { kind: { type: 'string', enum: ['exhibitor_registration', 'grant'] }, date: { type: 'string' } } } }
    } } }
} }
