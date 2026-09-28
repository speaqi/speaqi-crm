// Itinerari delle compagnie di navigazione (/navigazione): compagnia → itinerario
// → tappe → porto. Modulo puro, usato dalla pagina (anteprima mentre si incolla)
// e dall'API (che rifa' gli stessi conti prima di scrivere).

export type ItineraryStopRole = 'embark' | 'call' | 'disembark' | 'turnaround'

export interface ShippingPort {
  id: string
  slug: string
  name: string
  country: string | null
  unlocode: string | null
  aliases: string[]
  latitude?: number | null
  longitude?: number | null
  notes?: string | null
  region?: string | null
  subregion?: string | null
  destination?: string | null
  cruise_passengers?: number | null
  passengers_year?: number | null
  cruise_calls?: number | null
  stats_source?: string | null
  is_homeport?: boolean | null
  guide_status?: 'none' | 'planned' | 'in_progress' | 'live' | 'skip'
  guide_priority?: 1 | 2 | 3 | null
  guide_notes?: string | null
}

export interface ShippingItineraryStop {
  id?: string
  position: number
  day: number | null
  port_id: string
  role: ItineraryStopRole
  arrival: string | null
  departure: string | null
  overnight: boolean
  notes: string | null
  port?: Pick<ShippingPort, 'id' | 'slug' | 'name' | 'country' | 'latitude' | 'longitude'> | null
}

export interface ShippingItinerary {
  id: string
  company_id: string
  name: string
  ship: string | null
  nights: number | null
  season: string | null
  departure_dates: string[]
  source_url: string | null
  notes: string | null
  active: boolean
  created_at: string
  updated_at: string
  stops: ShippingItineraryStop[]
  company?: { id: string; name: string; slug: string } | null
}

/** Una riga del testo incollato, letta ma non ancora legata a un porto. */
export interface ParsedStop {
  line: string
  day: number | null
  name: string
  /** Il contenuto fra parentesi che non e' ruolo ne' paese: "Roma (Civitavecchia)". */
  alt: string | null
  country: string | null
  role: ItineraryStopRole
  arrival: string | null
  departure: string | null
  overnight: boolean
}

export const ITINERARY_ROLE_LABELS: Record<ItineraryStopRole, string> = {
  embark: 'Imbarco',
  call: 'Scalo',
  disembark: 'Sbarco',
  turnaround: 'Imbarco/sbarco',
}

type CorePort = Omit<ShippingPort, 'id'>

function core(slug: string, name: string, country: string, unlocode: string | null, aliases: string[] = []): CorePort {
  return { slug, name, country, unlocode, aliases }
}

/**
 * I porti che si incontrano di continuo negli itinerari del Mediterraneo, con i
 * nomi con cui le compagnie li scrivono. Vengono creati alla prima apertura
 * della pagina, cosi' "Naples" e "Roma (Civitavecchia)" trovano subito il loro
 * porto. UN/LOCODE solo dove e' certo: meglio vuoto che sbagliato.
 */
export const CORE_PORTS: CorePort[] = [
  core('napoli', 'Napoli', 'IT', 'ITNAP', ['naples', 'neapel', 'naples pompeii', 'napoli pompei', 'nápoles', 'naples italy']),
  core('civitavecchia', 'Civitavecchia', 'IT', 'ITCVV', ['roma', 'rome', 'rom', 'civitavecchia roma', 'rome civitavecchia', 'roma civitavecchia']),
  core('genova', 'Genova', 'IT', 'ITGOA', ['genoa', 'genua', 'gênes', 'genes']),
  core('savona', 'Savona', 'IT', 'ITSVN'),
  core('la-spezia', 'La Spezia', 'IT', 'ITSPE', ['spezia', 'la spezia cinque terre']),
  core('livorno', 'Livorno', 'IT', 'ITLIV', ['leghorn']),
  core('salerno', 'Salerno', 'IT', 'ITSAL'),
  core('sorrento', 'Sorrento', 'IT', null),
  core('capri', 'Capri', 'IT', null),
  core('amalfi', 'Amalfi', 'IT', null),
  core('positano', 'Positano', 'IT', null),
  core('palermo', 'Palermo', 'IT', 'ITPMO'),
  core('messina', 'Messina', 'IT', 'ITMSN', ['messina taormina']),
  core('catania', 'Catania', 'IT', 'ITCTA'),
  core('siracusa', 'Siracusa', 'IT', null, ['syracuse']),
  core('trapani', 'Trapani', 'IT', null),
  core('cagliari', 'Cagliari', 'IT', 'ITCAG'),
  core('olbia', 'Olbia', 'IT', 'ITOLB'),
  core('bari', 'Bari', 'IT', 'ITBRI'),
  core('brindisi', 'Brindisi', 'IT', 'ITBDS'),
  core('taranto', 'Taranto', 'IT', 'ITTAR'),
  core('ancona', 'Ancona', 'IT', 'ITAOI'),
  core('ravenna', 'Ravenna', 'IT', 'ITRAN'),
  core('venezia', 'Venezia', 'IT', 'ITVCE', ['venice', 'venedig', 'venise']),
  core('trieste', 'Trieste', 'IT', 'ITTRS'),
  core('la-valletta', 'La Valletta', 'MT', 'MTMLA', ['valletta', 'malta', 'la valletta malta']),
  core('barcellona', 'Barcellona', 'ES', 'ESBCN', ['barcelona', 'barcelone']),
  core('palma', 'Palma di Maiorca', 'ES', 'ESPMI', ['palma', 'palma de mallorca', 'palma mallorca', 'maiorca', 'mallorca']),
  core('valencia', 'Valencia', 'ES', 'ESVLC'),
  core('malaga', 'Malaga', 'ES', null, ['málaga']),
  core('ibiza', 'Ibiza', 'ES', null),
  core('marsiglia', 'Marsiglia', 'FR', 'FRMRS', ['marseille', 'marseilles']),
  core('tolone', 'Tolone', 'FR', null, ['toulon']),
  core('ajaccio', 'Ajaccio', 'FR', null),
  core('monaco', 'Monaco', 'MC', 'MCMON', ['monte carlo', 'montecarlo']),
  core('pireo', 'Pireo (Atene)', 'GR', 'GRPIR', ['piraeus', 'pireo', 'atene', 'athens', 'atene pireo', 'athens piraeus']),
  core('mykonos', 'Mykonos', 'GR', null, ['mikonos']),
  core('santorini', 'Santorini', 'GR', null, ['thira', 'fira']),
  core('corfu', 'Corfù', 'GR', null, ['corfu', 'kerkyra']),
  core('dubrovnik', 'Dubrovnik', 'HR', 'HRDBV'),
  core('spalato', 'Spalato', 'HR', 'HRSPU', ['split']),
  core('kotor', 'Kotor', 'ME', null, ['cattaro']),
  core('istanbul', 'Istanbul', 'TR', 'TRIST'),
  core('lisbona', 'Lisbona', 'PT', 'PTLIS', ['lisbon', 'lisboa']),
]

const COUNTRY_CODES: Record<string, string> = {
  italia: 'IT', italy: 'IT', italie: 'IT', italien: 'IT',
  spagna: 'ES', spain: 'ES', espana: 'ES', spanien: 'ES',
  francia: 'FR', france: 'FR', frankreich: 'FR',
  grecia: 'GR', greece: 'GR', griechenland: 'GR',
  malta: 'MT', croazia: 'HR', croatia: 'HR', kroatien: 'HR',
  montenegro: 'ME', albania: 'AL', slovenia: 'SI',
  turchia: 'TR', turkey: 'TR', turkiye: 'TR', tuerkei: 'TR',
  portogallo: 'PT', portugal: 'PT',
  tunisia: 'TN', marocco: 'MA', morocco: 'MA', egitto: 'EG', egypt: 'EG',
  cipro: 'CY', cyprus: 'CY', israele: 'IL', israel: 'IL',
  monaco: 'MC', principato: 'MC', gibilterra: 'GI', gibraltar: 'GI',
  norvegia: 'NO', norway: 'NO', norwegen: 'NO',
  'regno unito': 'GB', 'united kingdom': 'GB', uk: 'GB', inghilterra: 'GB', england: 'GB',
  germania: 'DE', germany: 'DE', deutschland: 'DE',
  'paesi bassi': 'NL', netherlands: 'NL', olanda: 'NL',
  belgio: 'BE', belgium: 'BE', danimarca: 'DK', denmark: 'DK',
  svezia: 'SE', sweden: 'SE', finlandia: 'FI', finland: 'FI', estonia: 'EE',
  islanda: 'IS', iceland: 'IS', irlanda: 'IE', ireland: 'IE',
  'stati uniti': 'US', usa: 'US', 'united states': 'US',
}

// Lettere che la scomposizione Unicode non riduce a una lettera base: senza
// questa tabella "Tromsø" diventava "troms" e "Bodø" "bod".
const LATIN_LETTERS: Record<string, string> = { ø: 'o', æ: 'ae', œ: 'oe', ð: 'd', þ: 'th', ß: 'ss', ł: 'l', đ: 'd', ı: 'i', ħ: 'h' }

/** Chiave di confronto: minuscole, senza accenti e punteggiatura. */
export function normalizePortKey(value: string) {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[øæœðþßłđıħ]/g, (letter) => LATIN_LETTERS[letter])
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function slugifyPortName(value: string) {
  return normalizePortKey(value).replace(/\s+/g, '-').slice(0, 60) || 'porto'
}

export function countryCode(value: string | null | undefined): string | null {
  if (!value) return null
  const key = normalizePortKey(value)
  if (/^[a-z]{2}$/.test(key) && Object.values(COUNTRY_CODES).includes(key.toUpperCase())) return key.toUpperCase()
  return COUNTRY_CODES[key] || null
}

const WEEKDAY_RE = /^(?:lun(?:edi)?|mar(?:tedi)?|mer(?:coledi)?|gio(?:vedi)?|ven(?:erdi)?|sab(?:ato)?|dom(?:enica)?|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\.?,?\s+/i
// Mesi scritti per intero o abbreviati, mai come prefisso: "Marsiglia" e "Genova" non sono date.
const MONTHS = '(?:gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre|january|february|march|april|may|june|july|august|september|october|november|december|gen|feb|mar|apr|mag|giu|lug|ago|set|sett|ott|nov|dic|jan|jun|jul|aug|sep|sept|oct|dec)\\.?(?![a-z])'
const NUMERIC_DATE_RE = /^\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?\s+/
const TEXT_DATE_RE = new RegExp(`^\\d{1,2}\\s+${MONTHS}(?:\\s+\\d{4})?,?\\s+`, 'i')
const DAY_LABEL_RE = /^(?:giorno|day|tag|jour|dia|g)\s*(\d{1,3})\b[\s.:)\-–—]*/i
const DAY_NUMBER_RE = /^(\d{1,3})(?:\s*(?:[.)\-–—·]|:(?!\d))\s*|\s+(?=[^\d\s]))/
const TIME_RE = /\b([01]?\d|2[0-3])[:.]([0-5]\d)(?:\s*([ap])\.?\s?m\b\.?)?/gi
const SEA_DAY_RE = /^(?:(?:giorno|giornata)\s+(?:di|in)\s+navigazione|in\s+navigazione|navigazione|at\s+sea|sea\s+day|day\s+at\s+sea|cruising|scenic\s+cruising|in\s+mare|seetag|auf\s+see|en\s+mer)\b/i
const EMBARK_RE = /\b(?:imbarco|embarkation|embark|boarding|einschiffung)\b/
const DISEMBARK_RE = /\b(?:sbarco|disembarkation|disembark|debarkation|debark|ausschiffung)\b/
const OVERNIGHT_RE = /\b(?:pernottamento|pernottamento in porto|overnight|notte in porto)\b/
const LABEL_RE = /\b(?:arrivo|partenza|arrival|departure|arrive|depart|arr|dep|ore|h)\b\.?/gi
const HEADER_RE = /^(?:giorno|day)\s+(?:porto|port)\b/i

function clockTime(hours: string, minutes: string, meridiem?: string) {
  let value = Number(hours)
  const half = meridiem?.toLowerCase()
  if (half === 'p' && value < 12) value += 12
  if (half === 'a' && value === 12) value = 0
  return `${String(value).padStart(2, '0')}:${minutes}`
}

function stripDecorations(line: string) {
  return line.replace(/^[\s•*·>\-–—]+/, '').replace(/\s+/g, ' ').trim()
}

/**
 * Legge l'itinerario cosi' come si copia dal sito della compagnia: una tappa per
 * riga, con o senza numero del giorno, data, giorno della settimana e orari.
 *
 *   Giorno 1 · Genova, Italia (imbarco) 17:00
 *   2 Napoli 13:00 - 19:00
 *   Navigazione
 *   Sab 13 giu La Valletta, Malta 08:00 18:00
 *
 * Le righe di navigazione non diventano tappe ma fanno avanzare il giorno.
 */
export function parseItineraryText(text: string) {
  const stops: ParsedStop[] = []
  const ignored: string[] = []
  let seaDays = 0
  let dayCounter = 0
  const times: string[][] = []

  for (const rawLine of String(text || '').split(/\r?\n/)) {
    let rest = stripDecorations(rawLine)
    if (!rest || HEADER_RE.test(rest)) continue

    let explicitDay: number | null = null
    const labelled = rest.match(DAY_LABEL_RE)
    // "13 giu Genova" o "13.06 Genova" sono date, non il giorno 13.
    const startsWithDate = NUMERIC_DATE_RE.test(rest) || TEXT_DATE_RE.test(rest)
    const numbered = labelled || startsWithDate ? null : rest.match(DAY_NUMBER_RE)
    const dayMatch = labelled || numbered
    if (dayMatch) {
      explicitDay = Number(dayMatch[1])
      rest = rest.slice(dayMatch[0].length)
    }
    rest = stripDecorations(rest.replace(WEEKDAY_RE, '').replace(NUMERIC_DATE_RE, '').replace(TEXT_DATE_RE, '').replace(WEEKDAY_RE, ''))

    const day = explicitDay ?? dayCounter + 1
    if (SEA_DAY_RE.test(normalizePortKey(rest)) || SEA_DAY_RE.test(rest)) {
      seaDays += 1
      dayCounter = Math.max(dayCounter, day)
      continue
    }

    const lineTimes = Array.from(rest.matchAll(TIME_RE)).map((match) => clockTime(match[1], match[2], match[3]))
    rest = rest.replace(TIME_RE, ' ').replace(/-{1,2}:-{1,2}/g, ' ')

    let role: ItineraryStopRole = 'call'
    let overnight = false
    let country: string | null = null
    let alt: string | null = null

    rest = rest.replace(/\(([^)]*)\)/g, (_match, inner: string) => {
      const key = normalizePortKey(inner)
      if (!key) return ' '
      if (EMBARK_RE.test(key) && DISEMBARK_RE.test(key)) role = 'turnaround'
      else if (EMBARK_RE.test(key)) role = 'embark'
      else if (DISEMBARK_RE.test(key)) role = 'disembark'
      else if (OVERNIGHT_RE.test(key)) overnight = true
      else if (countryCode(inner)) country = countryCode(inner)
      else alt = inner.trim()
      return ' '
    })

    const keyRest = normalizePortKey(rest)
    if (role === 'call') {
      if (EMBARK_RE.test(keyRest) && DISEMBARK_RE.test(keyRest)) role = 'turnaround'
      else if (EMBARK_RE.test(keyRest)) role = 'embark'
      else if (DISEMBARK_RE.test(keyRest)) role = 'disembark'
    }
    if (OVERNIGHT_RE.test(keyRest)) overnight = true
    rest = rest
      .replace(/\b(?:imbarco|embarkation|embark|boarding|sbarco|disembarkation|disembark|debarkation|debark|pernottamento in porto|pernottamento|overnight|notte in porto)\b/gi, ' ')
      .replace(LABEL_RE, ' ')

    // "Genova, Italia" / "Genova - Italia": l'ultimo pezzo e' il paese solo se lo riconosciamo.
    const parts = rest.split(/\s*[,|]\s*|\s+[-–—]\s+/).map((part) => part.trim()).filter(Boolean)
    if (parts.length > 1 && countryCode(parts[parts.length - 1])) {
      country = country || countryCode(parts.pop())
    }
    const name = parts.join(', ').replace(/[\s.,;:·\-–—]+$/g, '').replace(/^[\s.,;:·\-–—]+/g, '').replace(/\s+/g, ' ').trim()

    if (!name) {
      ignored.push(rawLine.trim())
      continue
    }

    dayCounter = Math.max(dayCounter, day)
    times.push(lineTimes)
    stops.push({ line: rawLine.trim(), day, name, alt, country, role, arrival: null, departure: null, overnight })
  }

  // Orari: due valori = arrivo e partenza. Uno solo dipende da dove sta la tappa.
  stops.forEach((stop, index) => {
    const own = times[index]
    const first = index === 0
    const last = index === stops.length - 1 && stops.length > 1
    if (stop.role === 'call' && first) stop.role = 'embark'
    else if (stop.role === 'call' && last) stop.role = 'disembark'
    if (own.length >= 2) {
      stop.arrival = own[0]
      stop.departure = own[1]
    } else if (own.length === 1) {
      if (stop.role === 'embark') stop.departure = own[0]
      else stop.arrival = own[0]
    }
  })

  return { stops, seaDays, ignored }
}

export interface PortIndex {
  byKey: Map<string, ShippingPort>
}

export function buildPortIndex(ports: ShippingPort[]): PortIndex {
  const byKey = new Map<string, ShippingPort>()
  for (const port of ports) {
    for (const value of [port.name, port.slug.replace(/-/g, ' '), port.unlocode || '', ...(port.aliases || [])]) {
      const key = normalizePortKey(value)
      if (key && !byKey.has(key)) byKey.set(key, port)
    }
  }
  return { byKey }
}

/**
 * Trova il porto di una tappa. Le compagnie scrivono "Citta' (Porto)": il porto
 * vero e' fra parentesi, quindi si prova prima quello. Poi il nome intero, poi i
 * pezzi di "Firenze/Pisa".
 */
export function resolvePort(index: PortIndex, stop: Pick<ParsedStop, 'name' | 'alt'>): ShippingPort | null {
  const candidates = [
    stop.alt,
    stop.alt && `${stop.name} ${stop.alt}`,
    stop.name,
    ...stop.name.split(/\s*[/,]\s*/),
  ].filter((value): value is string => Boolean(value))
  for (const candidate of candidates) {
    const port = index.byKey.get(normalizePortKey(candidate))
    if (port) return port
  }
  return null
}

/** Il porto da creare quando una tappa non ne trova uno esistente. */
export function newPortFromStop(stop: Pick<ParsedStop, 'name' | 'alt' | 'country'>) {
  const aliases = stop.alt ? [`${stop.name} (${stop.alt})`] : []
  return { slug: slugifyPortName(stop.name), name: stop.name.slice(0, 120), country: stop.country, unlocode: null, aliases }
}

export function itineraryRoute(stops: Array<Pick<ShippingItineraryStop, 'port'>>) {
  return stops.map((stop) => stop.port?.name || '?').join(' → ')
}

/** Date di partenza scritte come vengono: "13/06/2026, 2026-06-20; 27/6/26". */
export function parseDepartureDates(value: unknown) {
  const dates: string[] = []
  const invalid: string[] = []
  const items = Array.isArray(value) ? value.map(String) : String(value || '').split(/[\s,;]+/)
  for (const raw of items) {
    const item = raw.trim()
    if (!item) continue
    let year: number, month: number, day: number
    let match = item.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
    if (match) {
      year = Number(match[1]); month = Number(match[2]); day = Number(match[3])
    } else if ((match = item.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{2}|\d{4})$/))) {
      day = Number(match[1]); month = Number(match[2]); year = Number(match[3])
      if (year < 100) year += 2000
    } else {
      invalid.push(item)
      continue
    }
    const date = new Date(Date.UTC(year, month - 1, day))
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
      invalid.push(item)
      continue
    }
    const iso = date.toISOString().slice(0, 10)
    if (!dates.includes(iso)) dates.push(iso)
  }
  return { dates: dates.sort(), invalid }
}

export function formatItineraryDate(iso: string) {
  const [year, month, day] = iso.split('-')
  return `${day}/${month}/${year}`
}

/**
 * Le tappe salvate riscritte nel formato che il parser legge: modificare un
 * itinerario vuol dire riaprire il suo testo, non ricompilare una tabella.
 */
export function itineraryToText(stops: Array<Pick<ShippingItineraryStop, 'day' | 'role' | 'arrival' | 'departure' | 'overnight' | 'port'>>) {
  const roleText: Record<ItineraryStopRole, string> = {
    embark: ' (imbarco)',
    call: '',
    disembark: ' (sbarco)',
    turnaround: ' (imbarco e sbarco)',
  }
  return stops
    .map((stop) => {
      const day = stop.day ? `Giorno ${stop.day} · ` : ''
      const times = [stop.arrival, stop.departure].filter(Boolean).join(' - ')
      const role = stop.role === 'call' && stop.arrival && !stop.departure ? '' : roleText[stop.role]
      const overnight = stop.overnight ? ' (pernottamento)' : ''
      return `${day}${stop.port?.name || '?'}${role}${overnight}${times ? ` ${times}` : ''}`
    })
    .join('\n')
}
