// Porti del mondo e superguide (/navigazione → Porti). Modulo puro: la pagina
// ordina, filtra ed esporta con queste funzioni, l'API ci valida le modifiche.
//
// La domanda a cui risponde e' "quale citta' raccontiamo dopo?": per ogni porto
// quanti crocieristi ci passano (dato pubblicato, con fonte), quante compagnie e
// itinerari del CRM ci fanno tappa, che citta' serve e a che punto e' la guida.

import { validLatLng } from './shipping-routes'

export type GuideStatus = 'none' | 'planned' | 'in_progress' | 'live' | 'skip'

export const GUIDE_STATUSES: GuideStatus[] = ['none', 'planned', 'in_progress', 'live', 'skip']

export const GUIDE_STATUS_LABELS: Record<GuideStatus, string> = {
  none: 'Da valutare',
  planned: 'Da fare',
  in_progress: 'In lavorazione',
  live: 'Pubblicata',
  skip: 'Non serve',
}

export type GuidePriority = 1 | 2 | 3

export const GUIDE_PRIORITY_LABELS: Record<GuidePriority, string> = {
  1: 'Subito',
  2: 'Dopo le prime',
  3: 'Più avanti',
}

/**
 * La scelta che si fa sulla riga: sì (con la priorità), no, in lavorazione,
 * pubblicata o ancora da valutare. È stato + priorità in un solo menu, perché la
 * domanda è una sola: «la facciamo, e quando?».
 */
export const GUIDE_CHOICES = [
  { value: 'planned:1', label: 'Sì, subito', status: 'planned', priority: 1 },
  { value: 'planned:2', label: 'Sì, dopo le prime', status: 'planned', priority: 2 },
  { value: 'planned:3', label: 'Sì, più avanti', status: 'planned', priority: 3 },
  { value: 'in_progress', label: 'In lavorazione', status: 'in_progress', priority: null },
  { value: 'live', label: 'Pubblicata', status: 'live', priority: null },
  { value: 'skip', label: 'No', status: 'skip', priority: null },
  { value: 'none', label: 'Da valutare', status: 'none', priority: null },
] as const satisfies ReadonlyArray<{ value: string; label: string; status: GuideStatus; priority: GuidePriority | null }>

export function guideChoiceOf(port: { guide_status?: GuideStatus; guide_priority?: GuidePriority | null }) {
  const status = port.guide_status || 'none'
  if (status === 'planned') return `planned:${port.guide_priority || 2}`
  return status
}

/** Il corpo della PATCH per una scelta. In lavorazione tiene la priorità che c'era. */
export function guideChoicePatch(value: string) {
  const choice = GUIDE_CHOICES.find((item) => item.value === value)
  if (!choice) return null
  if (choice.status === 'in_progress') return { guide_status: choice.status }
  return { guide_status: choice.status, guide_priority: choice.priority }
}

/** Ordine di lavoro: prima quelle in corso, poi quelle da fare, poi il resto; pubblicate e scartate in fondo. */
const GUIDE_STATUS_RANK: Record<GuideStatus, number> = { in_progress: 0, planned: 1, none: 2, live: 3, skip: 4 }

/** Le macro-regioni con cui e' diviso il catalogo. Una regione fuori elenco si rifiuta: sparirebbe dai filtri. */
export const PORT_REGIONS = [
  'Mediterraneo',
  'Nord Europa',
  "Fiumi d'Europa",
  'Caraibi',
  'Nord America',
  'Sud America e Antartide',
  'Asia',
  'Oceania e Pacifico',
  'Medio Oriente, India e Africa',
] as const

export type PortRegion = (typeof PORT_REGIONS)[number]

export interface PortWorldFields {
  region: string | null
  subregion: string | null
  destination: string | null
  cruise_passengers: number | null
  passengers_year: number | null
  cruise_calls: number | null
  stats_source: string | null
  is_homeport: boolean | null
  guide_status: GuideStatus
  guide_priority: GuidePriority | null
  guide_notes: string | null
  latitude: number | null
  longitude: number | null
}

export interface RankablePort extends Partial<PortWorldFields> {
  name: string
  country: string | null
  company_ids: string[]
  itinerary_count: number
}

export type PortSortKey = 'guide' | 'passengers' | 'companies' | 'itineraries' | 'name'

export const PORT_SORT_LABELS: Record<PortSortKey, string> = {
  guide: 'Superguide da fare prima',
  passengers: 'Più passeggeri prima',
  companies: 'Più compagnie prima',
  itineraries: 'Più itinerari prima',
  name: 'Alfabetico',
}

const byName = (a: RankablePort, b: RankablePort) => a.name.localeCompare(b.name, 'it')

/**
 * Ordine della classifica. Un porto senza statistica non e' un porto da zero
 * passeggeri: va dopo quelli misurati, ma fra loro conta chi ha piu' compagnie.
 */
export function comparePorts(key: PortSortKey) {
  return (a: RankablePort, b: RankablePort) => {
    if (key === 'name') return byName(a, b)
    if (key === 'guide') {
      const ra = GUIDE_STATUS_RANK[a.guide_status || 'none']
      const rb = GUIDE_STATUS_RANK[b.guide_status || 'none']
      if (ra !== rb) return ra - rb
      const qa = a.guide_priority ?? 9
      const qb = b.guide_priority ?? 9
      if (qa !== qb) return qa - qb
    }
    if (key === 'passengers' || key === 'guide') {
      const pa = a.cruise_passengers ?? -1
      const pb = b.cruise_passengers ?? -1
      if (pa !== pb) return pb - pa
    }
    if (key === 'itineraries' && a.itinerary_count !== b.itinerary_count) return b.itinerary_count - a.itinerary_count
    return b.company_ids.length - a.company_ids.length || b.itinerary_count - a.itinerary_count || byName(a, b)
  }
}

/** "3,6 mln", "850 mila", "4200": si legge a colpo d'occhio in una lista lunga. */
export function formatPassengers(value: number | null | undefined) {
  if (value === null || value === undefined) return null
  if (value >= 1_000_000) return `${(value / 1_000_000).toLocaleString('it-IT', { maximumFractionDigits: 1 })} mln`
  if (value >= 10_000) return `${Math.round(value / 1000).toLocaleString('it-IT')} mila`
  return value.toLocaleString('it-IT')
}

export function summarizeGuides(ports: RankablePort[]) {
  const byStatus = Object.fromEntries(GUIDE_STATUSES.map((status) => [status, 0])) as Record<GuideStatus, number>
  let passengers = 0
  let covered = 0
  let urgent = 0
  for (const port of ports) {
    const status = port.guide_status || 'none'
    byStatus[status] += 1
    if (status === 'planned' && port.guide_priority === 1) urgent += 1
    const value = port.cruise_passengers || 0
    passengers += value
    if (status === 'live') covered += value
  }
  return { total: ports.length, byStatus, passengers, covered, urgent }
}

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? '' : String(value)
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** CSV col punto e virgola, che Excel in italiano apre senza chiedere niente. */
export function portsToCsv(ports: Array<RankablePort & { unlocode?: string | null }>, companyName: (id: string) => string) {
  const header = [
    'Porto', 'Città servita', 'Paese', 'UN/LOCODE', 'Regione', 'Area', 'Passeggeri/anno', 'Anno', 'Scali/anno',
    'Imbarco', 'Compagnie', 'Itinerari', 'Superguida', 'Priorità', 'Note guida', 'Nomi compagnie', 'Fonte statistica',
  ]
  const rows = ports.map((port) => [
    port.name,
    port.destination,
    port.country,
    port.unlocode,
    port.region,
    port.subregion,
    port.cruise_passengers,
    port.passengers_year,
    port.cruise_calls,
    port.is_homeport === null || port.is_homeport === undefined ? '' : port.is_homeport ? 'sì' : 'no',
    port.company_ids.length,
    port.itinerary_count,
    GUIDE_STATUS_LABELS[port.guide_status || 'none'],
    port.guide_priority ? GUIDE_PRIORITY_LABELS[port.guide_priority] : '',
    port.guide_notes,
    port.company_ids.map(companyName).sort((a, b) => a.localeCompare(b, 'it')).join(', '),
    port.stats_source,
  ])
  return '﻿' + [header, ...rows].map((row) => row.map(csvCell).join(';')).join('\r\n')
}

function cleanText(value: unknown, max: number) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return text ? text.slice(0, max) : null
}

function cleanCount(value: unknown, label: string) {
  if (value === null || value === undefined || value === '') return { value: null }
  const number = typeof value === 'number' ? value : Number(String(value).replace(/[.\s]/g, '').replace(',', '.'))
  if (!Number.isInteger(number) || number < 0) return { error: `${label} deve essere un numero intero positivo` }
  return { value: number }
}

/**
 * Valida la parte "mondo e superguida" di una modifica al porto. Tocca solo i
 * campi presenti nel corpo: un PATCH che cambia lo stato della guida non deve
 * azzerare le statistiche.
 */
export function normalizePortWorldPatch(body: Record<string, unknown>): { patch: Partial<PortWorldFields> } | { error: string } {
  const patch: Partial<PortWorldFields> = {}
  if (body.region !== undefined) {
    const region = cleanText(body.region, 80)
    if (region && !(PORT_REGIONS as readonly string[]).includes(region)) return { error: `Regione sconosciuta: ${region}` }
    patch.region = region
  }
  if (body.subregion !== undefined) patch.subregion = cleanText(body.subregion, 120)
  if (body.destination !== undefined) patch.destination = cleanText(body.destination, 160)
  if (body.stats_source !== undefined) patch.stats_source = cleanText(body.stats_source, 500)
  if (body.guide_notes !== undefined) patch.guide_notes = cleanText(body.guide_notes, 1000)
  if (body.is_homeport !== undefined) patch.is_homeport = body.is_homeport === null || body.is_homeport === '' ? null : Boolean(body.is_homeport)
  if (body.guide_status !== undefined) {
    const status = String(body.guide_status || 'none') as GuideStatus
    if (!GUIDE_STATUSES.includes(status)) return { error: 'Stato della superguida non valido' }
    patch.guide_status = status
  }
  if (body.guide_priority !== undefined) {
    const raw = body.guide_priority
    const priority = raw === null || raw === '' ? null : Number(raw)
    if (priority !== null && ![1, 2, 3].includes(priority)) return { error: 'Priorità della superguida non valida (1, 2 o 3)' }
    patch.guide_priority = priority as GuidePriority | null
  }
  // Una guida pubblicata, scartata o ancora da valutare non ha priorità: la si toglie
  // insieme al cambio di stato, altrimenti il vincolo sul database rifiuterebbe la modifica.
  if (patch.guide_status && !['planned', 'in_progress'].includes(patch.guide_status)) {
    if (patch.guide_priority) return { error: 'La priorità vale solo per una guida da fare o in lavorazione' }
    patch.guide_priority = null
  }
  for (const [key, label] of [['cruise_passengers', 'Passeggeri'], ['cruise_calls', 'Scali'], ['passengers_year', 'Anno']] as const) {
    if (body[key] === undefined) continue
    const result = cleanCount(body[key], label)
    if ('error' in result) return { error: result.error! }
    patch[key] = result.value
  }
  // La posizione va a coppie: una latitudine senza longitudine metterebbe il porto in mezzo al mare.
  if (body.latitude !== undefined || body.longitude !== undefined) {
    const empty = (value: unknown) => value === null || value === undefined || value === ''
    if (empty(body.latitude) && empty(body.longitude)) {
      patch.latitude = null
      patch.longitude = null
    } else {
      const coords = validLatLng(body.latitude, body.longitude)
      if (!coords) return { error: 'Posizione non valida: servono latitudine (-90…90) e longitudine (-180…180)' }
      patch.latitude = Math.round(coords.lat * 1e6) / 1e6
      patch.longitude = Math.round(coords.lng * 1e6) / 1e6
    }
  }
  if (patch.cruise_passengers != null && patch.passengers_year === null) return { error: 'Un numero di passeggeri vuole il suo anno' }
  if (patch.passengers_year !== undefined && patch.passengers_year !== null && (patch.passengers_year < 1990 || patch.passengers_year > 2100)) {
    return { error: 'Anno della statistica non valido' }
  }
  return { patch }
}
