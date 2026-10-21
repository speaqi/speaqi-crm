/**
 * Porti, aeroporti e stazioni di Tourism Intelligence (`tourism_hubs`).
 *
 * Un hub e' un posto da cui arrivano visitatori in una destinazione. Le righe
 * nascono da dataset pubblici (OurAirports, Trainline, il catalogo porti): qui
 * si normalizzano, si scartano quelle che non servono a una guida (eliporti,
 * piste senza voli di linea) e si preparano i blocchi per `tourism_import_hubs`.
 * Tutto puro: lo usano lo script d'importazione, le rotte e i test.
 */

import { normalizePortKey } from './shipping-itineraries'

export const HUB_MODES = ['sea', 'air', 'rail'] as const
export type HubMode = (typeof HUB_MODES)[number]

export const HUB_MODE_LABELS: Record<HubMode, string> = {
  sea: 'Porto',
  air: 'Aeroporto',
  rail: 'Stazione',
}

export const HUB_SIZES = ['large', 'medium', 'small'] as const
export type HubSize = (typeof HUB_SIZES)[number]

/** Le macro-aree per aeroporti e stazioni, dai continenti di OurAirports. */
export const CONTINENT_REGIONS: Record<string, string> = {
  EU: 'Europa',
  AS: 'Asia',
  NA: 'Nord America',
  SA: 'Sud America',
  AF: 'Africa',
  OC: 'Oceania',
  AN: 'Antartide',
}

/** Il record che `tourism_import_hubs` accetta. I campi assenti restano vuoti. */
export interface HubImport {
  mode: HubMode
  slug: string
  name: string
  country: string | null
  aliases: string[]
  unlocode: string | null
  iata: string | null
  icao: string | null
  uic: string | null
  external_ids: Record<string, string>
  latitude: number | null
  longitude: number | null
  region: string | null
  subregion: string | null
  destination: string | null
  size: HubSize | null
  passengers: number | null
  passengers_year: number | null
  intl_share: number | null
  movements: number | null
  stats_source: string | null
  is_homeport: boolean | null
  scheduled_service: boolean | null
}

export class HubInputError extends Error {}

const text = (value: unknown, max: number) => {
  const clean = String(value ?? '').replace(/\s+/g, ' ').trim()
  return clean ? clean.slice(0, max) : null
}

const code = (value: unknown, pattern: RegExp) => {
  const clean = String(value ?? '').replace(/\s+/g, '').toUpperCase()
  return pattern.test(clean) ? clean : null
}

const coordinate = (value: unknown, limit: number) => {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && Math.abs(parsed) <= limit ? Math.round(parsed * 1e6) / 1e6 : null
}

const count = (value: unknown) => {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 2_000_000_000 ? parsed : null
}

/** Slug come quello dei porti: "Roma Fiumicino" → "roma-fiumicino". */
export function hubSlug(value: string) {
  return normalizePortKey(value).replace(/\s+/g, '-').slice(0, 80).replace(/-+$/, '')
}

/**
 * Normalizza un hub da qualunque fonte. Rifiuta cio' che il database
 * rifiuterebbe, con un messaggio leggibile: meglio scartarlo nel dry-run che
 * far fallire un blocco da cinquecento righe.
 */
export function normalizeHub(input: Record<string, unknown>): HubImport {
  const mode = String(input.mode || '') as HubMode
  if (!HUB_MODES.includes(mode)) throw new HubInputError(`Tipo di hub sconosciuto: ${input.mode}`)
  const name = text(input.name, 160)
  if (!name) throw new HubInputError('Hub senza nome')
  const slug = hubSlug(String(input.slug || name))
  if (!slug) throw new HubInputError(`Slug vuoto per ${name}`)

  const latitude = coordinate(input.latitude, 90)
  const longitude = coordinate(input.longitude, 180)
  const passengers = count(input.passengers)
  const year = count(input.passengers_year)
  const passengersYear = passengers !== null && year !== null && year >= 1990 && year <= 2100 ? year : null
  const shareRaw = input.intl_share === null || input.intl_share === undefined || input.intl_share === '' ? null : Number(input.intl_share)
  const size = HUB_SIZES.includes(input.size as HubSize) ? (input.size as HubSize) : null

  const external: Record<string, string> = {}
  if (input.external_ids && typeof input.external_ids === 'object') {
    for (const [key, value] of Object.entries(input.external_ids as Record<string, unknown>)) {
      const clean = text(value, 200)
      if (/^[a-z0-9_]{1,40}$/.test(key) && clean) external[key] = clean
    }
  }

  const seen = new Set([normalizePortKey(name)])
  const aliases: string[] = []
  for (const alias of Array.isArray(input.aliases) ? input.aliases : []) {
    const clean = text(alias, 120)
    const key = clean ? normalizePortKey(clean) : ''
    if (!clean || !key || seen.has(key)) continue
    seen.add(key)
    aliases.push(clean)
  }

  return {
    mode,
    slug,
    name,
    country: code(input.country, /^[A-Z]{2}$/),
    aliases: aliases.slice(0, 30),
    unlocode: code(input.unlocode, /^[A-Z]{2}[A-Z0-9]{3}$/),
    iata: code(input.iata, /^[A-Z0-9]{3}$/),
    icao: code(input.icao, /^[A-Z0-9]{4}$/),
    uic: code(input.uic, /^[0-9]{7,9}$/),
    external_ids: external,
    latitude: latitude !== null && longitude !== null ? latitude : null,
    longitude: latitude !== null && longitude !== null ? longitude : null,
    region: text(input.region, 80),
    subregion: text(input.subregion, 120),
    destination: text(input.destination, 160),
    size,
    // Un numero senza anno non entra: non si confronta con niente.
    passengers: passengersYear === null ? null : passengers,
    passengers_year: passengersYear,
    intl_share: passengersYear !== null && shareRaw !== null && Number.isFinite(shareRaw) && shareRaw >= 0 && shareRaw <= 100 ? shareRaw : null,
    movements: count(input.movements),
    stats_source: passengersYear === null ? null : text(input.stats_source, 500),
    is_homeport: typeof input.is_homeport === 'boolean' ? input.is_homeport : null,
    scheduled_service: typeof input.scheduled_service === 'boolean' ? input.scheduled_service : null,
  }
}

/**
 * Due righe dello stesso hub nello stesso file si fondono, la prima vince: un
 * blocco che inserisce due volte lo stesso slug fallirebbe sul vincolo unico.
 * Gli slug uguali di hub diversi ("Santa Cruz" in tre paesi) prendono il codice.
 */
export function dedupeHubs(hubs: HubImport[]) {
  const byKey = new Map<string, HubImport>()
  const slugs = new Map<string, HubImport>()
  const duplicates: HubImport[] = []
  for (const hub of hubs) {
    const key = `${hub.mode}:${hub.iata || hub.icao || hub.uic || hub.unlocode || hub.slug}`
    if (byKey.has(key)) {
      duplicates.push(hub)
      continue
    }
    let slug = hub.slug
    const qualifier = (hub.iata || hub.icao || hub.uic || hub.country || '').toLowerCase()
    if (slugs.has(`${hub.mode}:${slug}`) && qualifier) slug = `${hub.slug}-${qualifier}`
    for (let n = 2; slugs.has(`${hub.mode}:${slug}`); n += 1) slug = `${hub.slug}-${n}`
    const unique = slug === hub.slug ? hub : { ...hub, slug }
    byKey.set(key, unique)
    slugs.set(`${hub.mode}:${slug}`, unique)
  }
  return { hubs: [...byKey.values()], duplicates }
}

/** Una riga del CSV `airports.csv` di OurAirports. */
export type OurAirportsRow = Record<string, string>

export interface AirportSelection {
  hubs: HubImport[]
  skipped: Record<string, number>
}

/**
 * Aeroporti grandi e medi con voli di linea e codice IATA: sono quelli da cui
 * arriva un turista. Le piste piccole, gli eliporti, le basi militari e gli
 * aeroporti chiusi restano fuori, con il motivo contato.
 */
export function airportsFromOurAirports(rows: OurAirportsRow[]): AirportSelection {
  const skipped: Record<string, number> = {}
  const skip = (reason: string) => {
    skipped[reason] = (skipped[reason] || 0) + 1
  }
  const hubs: HubImport[] = []
  for (const row of rows) {
    const type = row.type
    if (type !== 'large_airport' && type !== 'medium_airport') {
      skip(type === 'closed' ? 'chiuso' : 'non grande o medio')
      continue
    }
    if (row.scheduled_service !== 'yes') {
      skip('senza voli di linea')
      continue
    }
    const iata = code(row.iata_code, /^[A-Z]{3}$/)
    if (!iata) {
      skip('senza codice IATA')
      continue
    }
    // "Paris (Roissy-en-France, Val-d'Oise)": la citta' e' quella prima della parentesi.
    const municipality = text(String(row.municipality || '').replace(/\s*\(.*$/, ''), 160)
    const keywords = String(row.keywords || '')
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value && !/^[A-Z0-9]{3,4}$/.test(value))
    try {
      hubs.push(
        normalizeHub({
          mode: 'air',
          // Il codice IATA e' gia' unico e stabile: lo slug non cambia se cambia il nome.
          slug: iata.toLowerCase(),
          name: row.name,
          country: row.iso_country,
          aliases: [...keywords, iata],
          iata,
          icao: row.icao_code || row.gps_code,
          external_ids: {
            ourairports: row.ident,
            ...(row.wikipedia_link ? { wikipedia: row.wikipedia_link } : {}),
          },
          latitude: row.latitude_deg,
          longitude: row.longitude_deg,
          region: CONTINENT_REGIONS[row.continent] || null,
          subregion: row.iso_region || null,
          destination: municipality,
          size: type === 'large_airport' ? 'large' : 'medium',
          scheduled_service: true,
        })
      )
    } catch {
      skip('dati non validi')
    }
  }
  return { hubs, skipped }
}

/** Distanza in chilometri fra due punti (formula dell'emisenoverso). */
export function distanceKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const rad = Math.PI / 180
  const dLat = (b.latitude - a.latitude) * rad
  const dLng = (b.longitude - a.longitude) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLng / 2) ** 2
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Riepilogo per il dry-run: quanti per tipo, paese e taglia. */
export function summarizeHubs(hubs: HubImport[]) {
  const byMode: Record<string, number> = {}
  const bySize: Record<string, number> = {}
  const countries = new Set<string>()
  for (const hub of hubs) {
    byMode[hub.mode] = (byMode[hub.mode] || 0) + 1
    bySize[hub.size || 'n/d'] = (bySize[hub.size || 'n/d'] || 0) + 1
    if (hub.country) countries.add(hub.country)
  }
  return {
    total: hubs.length,
    by_mode: byMode,
    by_size: bySize,
    countries: countries.size,
    with_stats: hubs.filter((hub) => hub.passengers !== null).length,
    with_coordinates: hubs.filter((hub) => hub.latitude !== null).length,
  }
}

const literal = (value: string) => `'${value.replace(/'/g, "''")}'`

/**
 * Un blocco SQL per `tourism_import_hubs`, nella stessa forma dei batch di
 * `scripts/tourism/prepare.py`: identita' del proprietario in transazione,
 * ruolo authenticated, quindi RLS e `auth.uid()` come in pagina.
 */
export function hubImportSql(hubs: HubImport[], owner: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(owner)) throw new HubInputError('Proprietario non valido')
  if (hubs.length < 1 || hubs.length > 500) throw new HubInputError('Un blocco ha da 1 a 500 hub')
  return [
    'begin;',
    `select set_config('request.jwt.claim.sub',${literal(owner)},true);`,
    'set local role authenticated;',
    `select public.tourism_import_hubs(${literal(JSON.stringify(hubs))}::jsonb);`,
    'commit;',
    '',
  ].join('\n')
}
