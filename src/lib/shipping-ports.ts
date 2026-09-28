// Porti del mondo e superguide (/navigazione → Porti). Modulo puro: la pagina
// ordina, filtra ed esporta con queste funzioni, l'API ci valida le modifiche.
//
// La domanda a cui risponde e' "quale citta' raccontiamo dopo?": per ogni porto
// quanti crocieristi ci passano (dato pubblicato, con fonte), quante compagnie e
// itinerari del CRM ci fanno tappa, che citta' serve e a che punto e' la guida.

export type GuideStatus = 'none' | 'planned' | 'in_progress' | 'live' | 'skip'

export const GUIDE_STATUSES: GuideStatus[] = ['none', 'planned', 'in_progress', 'live', 'skip']

export const GUIDE_STATUS_LABELS: Record<GuideStatus, string> = {
  none: 'Da valutare',
  planned: 'Da fare',
  in_progress: 'In lavorazione',
  live: 'Pubblicata',
  skip: 'Non serve',
}

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
  guide_notes: string | null
}

export interface RankablePort extends Partial<PortWorldFields> {
  name: string
  country: string | null
  company_ids: string[]
  itinerary_count: number
}

export type PortSortKey = 'passengers' | 'companies' | 'itineraries' | 'name'

export const PORT_SORT_LABELS: Record<PortSortKey, string> = {
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
    if (key === 'passengers') {
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
  for (const port of ports) {
    const status = port.guide_status || 'none'
    byStatus[status] += 1
    const value = port.cruise_passengers || 0
    passengers += value
    if (status === 'live') covered += value
  }
  return { total: ports.length, byStatus, passengers, covered }
}

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? '' : String(value)
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** CSV col punto e virgola, che Excel in italiano apre senza chiedere niente. */
export function portsToCsv(ports: Array<RankablePort & { unlocode?: string | null }>, companyName: (id: string) => string) {
  const header = [
    'Porto', 'Città servita', 'Paese', 'UN/LOCODE', 'Regione', 'Area', 'Passeggeri/anno', 'Anno', 'Scali/anno',
    'Imbarco', 'Compagnie', 'Itinerari', 'Superguida', 'Note guida', 'Nomi compagnie', 'Fonte statistica',
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
  for (const [key, label] of [['cruise_passengers', 'Passeggeri'], ['cruise_calls', 'Scali'], ['passengers_year', 'Anno']] as const) {
    if (body[key] === undefined) continue
    const result = cleanCount(body[key], label)
    if ('error' in result) return { error: result.error! }
    patch[key] = result.value
  }
  if (patch.cruise_passengers != null && patch.passengers_year === null) return { error: 'Un numero di passeggeri vuole il suo anno' }
  if (patch.passengers_year !== undefined && patch.passengers_year !== null && (patch.passengers_year < 1990 || patch.passengers_year > 2100)) {
    return { error: 'Anno della statistica non valido' }
  }
  return { patch }
}
