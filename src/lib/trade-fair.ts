/**
 * Fiere (/fiere): espositori da valutare e seguire dopo l'evento.
 * Solo logica pura, condivisa fra pagina e rotta.
 */

export const TRADE_FAIR_STATUSES = ['new', 'contacted', 'replied', 'interested', 'meeting', 'not_interested'] as const
export type TradeFairStatus = (typeof TRADE_FAIR_STATUSES)[number]

export const STATUS_LABELS: Record<TradeFairStatus, string> = {
  new: 'Da contattare',
  contacted: 'Contattato',
  replied: 'Ha risposto',
  interested: 'Interessato',
  meeting: 'Incontro fissato',
  not_interested: 'Non interessato',
}

export function isTradeFairStatus(value: unknown): value is TradeFairStatus {
  return typeof value === 'string' && (TRADE_FAIR_STATUSES as readonly string[]).includes(value)
}

export type FairNote = { id: string; at: string; text: string }

export type FairExhibitor = {
  id: string
  fair: string
  slug: string
  name: string
  stand: string | null
  hall: string | null
  country: string | null
  city: string | null
  category: string | null
  contact_person: string | null
  description: string | null
  website: string | null
  email: string | null
  phone: string | null
  source_url: string | null
  score: number
  score_reasons: string[]
  priority: number | null
  status: TradeFairStatus
  contacted_at: string | null
  next_followup_at: string | null
  notes: FairNote[]
  contact_id: string | null
  created_at: string
  updated_at: string
}

export type ExhibitorInput = {
  name: string
  stand?: string | null
  hall?: string | null
  country?: string | null
  city?: string | null
  category?: string | null
  description?: string | null
  website?: string | null
  email?: string | null
  phone?: string | null
  source_url?: string | null
}

function clean(value: unknown, max = 300) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
  return text || null
}

export function slugifyExhibitor(name: string) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' e ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
}

export function normalizeWebsite(value: unknown) {
  const text = clean(value, 300)
  if (!text) return null
  const withProtocol = /^https?:\/\//i.test(text) ? text : `https://${text}`
  try {
    const url = new URL(withProtocol)
    return url.hostname.includes('.') ? url.toString().replace(/\/$/, '') : null
  } catch {
    return null
  }
}

export function normalizeEmail(value: unknown) {
  const text = clean(value, 200)?.toLowerCase() || null
  return text && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(text) ? text : null
}

export function normalizeExhibitor(input: Record<string, unknown>): ExhibitorInput | null {
  const name = clean(input.name, 200)
  if (!name) return null
  return {
    name,
    stand: clean(input.stand, 60),
    hall: clean(input.hall, 60),
    country: clean(input.country, 80),
    city: clean(input.city, 100),
    category: clean(input.category, 200),
    description: clean(input.description, 2000),
    website: normalizeWebsite(input.website),
    email: normalizeEmail(input.email),
    phone: clean(input.phone, 60),
    source_url: clean(input.source_url, 500),
  }
}

// ---------------------------------------------------------------------------
// Punteggio: quanto un espositore somiglia a un cliente di Speaqi Maps.
// Speaqi vende guide/mappe interattive e QR multilingua a chi accoglie turisti:
// destinazioni, enti del turismo, musei, crociere e traghetti, hotel, tour
// operator con esperienze sul posto. Chi vende solo voli o software di
// prenotazione ci entra poco.
// ---------------------------------------------------------------------------

type Rule = { label: string; points: number; pattern: RegExp }

const RULES: Rule[] = [
  { label: 'Destinazione / ente del turismo', points: 40, pattern: /\b(destinazion[ei]|ente (del )?turismo|tourist board|tourism (board|office|authority)|dmo|apt\b|regione|region(e|al)|comune|city of|visit[a-z]*|azienda (di )?promozione|convention (&|and|e) visitors|consorzio|gal\b)/i },
  { label: 'Crociere / traghetti / porti', points: 38, pattern: /\b(crocier[ae]|cruise|ferry|traghett[io]|porto|port authority|autorit[aà] portuale|shipping|navigazione|yacht|river cruise)/i },
  { label: 'Musei / cultura / siti', points: 34, pattern: /\b(muse[oi]|museum|cultur[ae]|patrimonio|heritage|unesco|parco archeologico|archaeolog|castell[oi]|sito)/i },
  { label: 'Esperienze / tour / guide', points: 28, pattern: /\b(esperienz[ae]|experience|tour\b|tours\b|guid[ae]|excursion|escursion|incoming|dmc|food (&|and) wine|enogastronom|cammin[io]|trekking|outdoor|turismo lento|slow)/i },
  { label: 'Ospitalità', points: 22, pattern: /\b(hotel|resort|albergh|agriturism|b&b|bed and breakfast|dimor[ae]|villaggio|ospitalit|hospitality|glamping|camping)/i },
  { label: 'Tour operator / agenzie', points: 14, pattern: /\b(tour operator|agenzia|travel agency|network|booking|viaggi)/i },
  { label: 'Italia / Mediterraneo', points: 8, pattern: /\b(ital(y|ia|iano)|napoli|campania|roma|lazio|sicilia|sardegna|puglia|toscana|amalfi|mediterr)/i },
]

const PENALTIES: Rule[] = [
  { label: 'Trasporto aereo / noleggio', points: -25, pattern: /\b(compagnia aerea|airline|aeroporto|airport|noleggio|car rental|rent a car)/i },
  { label: 'Software / servizi tecnici', points: -15, pattern: /\b(software|gestionale|channel manager|payment|pagament|assicurazion|insurance)/i },
]

export function scoreExhibitor(input: ExhibitorInput): { score: number; reasons: string[] } {
  const text = [input.name, input.category, input.description].filter(Boolean).join(' · ')
  const reasons: string[] = []
  let score = 0
  // Il primo segnale conta tutto, i successivi la meta': due sensi diversi di
  // "turistico" dicono piu' di uno ripetuto, ma non devono gonfiare il punteggio.
  let hits = 0
  for (const rule of RULES) {
    if (!rule.pattern.test(text)) continue
    score += hits === 0 ? rule.points : Math.round(rule.points / 2)
    reasons.push(rule.label)
    hits += 1
  }
  for (const rule of PENALTIES) {
    if (rule.pattern.test(text)) {
      score += rule.points
      reasons.push(rule.label)
    }
  }
  if (input.email || input.phone) {
    score += 5
    reasons.push('Contatto diretto disponibile')
  }
  if (input.website) score += 3
  return { score: Math.max(0, Math.min(100, score)), reasons }
}

/** Priorita' effettiva: quella scelta a mano, altrimenti dedotta dal punteggio. */
export function effectivePriority(row: Pick<FairExhibitor, 'priority' | 'score'>): 1 | 2 | 3 {
  if (row.priority === 1 || row.priority === 2 || row.priority === 3) return row.priority
  if (row.score >= 55) return 1
  if (row.score >= 30) return 2
  return 3
}

export const PRIORITY_LABELS = { 1: 'Alta', 2: 'Media', 3: 'Bassa' } as const

// ---------------------------------------------------------------------------
// Follow-up e ordinamento
// ---------------------------------------------------------------------------

const OPEN_STATUSES: TradeFairStatus[] = ['new', 'contacted', 'replied', 'interested', 'meeting']

export function isOpen(row: Pick<FairExhibitor, 'status'>) {
  return OPEN_STATUSES.includes(row.status)
}

/** Data locale ISO (YYYY-MM-DD) di `now`. */
export function isoDay(now: Date) {
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${m}-${d}`
}

export function followupState(row: Pick<FairExhibitor, 'status' | 'next_followup_at'>, now: Date): 'overdue' | 'today' | 'planned' | 'none' {
  if (!isOpen(row) || !row.next_followup_at) return 'none'
  const today = isoDay(now)
  if (row.next_followup_at < today) return 'overdue'
  if (row.next_followup_at === today) return 'today'
  return 'planned'
}

/** Prima i follow-up scaduti, poi priorita', poi punteggio, poi nome. */
export function compareExhibitors(a: FairExhibitor, b: FairExhibitor, now: Date) {
  const rank = { overdue: 0, today: 1, planned: 3, none: 3 } as const
  const ra = rank[followupState(a, now)]
  const rb = rank[followupState(b, now)]
  if (ra !== rb) return ra - rb
  const pa = effectivePriority(a)
  const pb = effectivePriority(b)
  if (pa !== pb) return pa - pb
  if (a.score !== b.score) return b.score - a.score
  return a.name.localeCompare(b.name, 'it')
}

export type FairFilter = {
  search?: string
  status?: TradeFairStatus | 'open' | 'all'
  priority?: 1 | 2 | 3 | 'all'
  onlyFollowup?: boolean
  onlyWithContact?: boolean
  hall?: string
}

function fold(value: string) {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

export function filterExhibitors(rows: FairExhibitor[], filter: FairFilter, now: Date) {
  const query = fold(filter.search || '').trim()
  return rows.filter((row) => {
    if (filter.status === 'open') {
      if (!isOpen(row)) return false
    } else if (filter.status && filter.status !== 'all' && row.status !== filter.status) return false
    if (filter.priority && filter.priority !== 'all' && effectivePriority(row) !== filter.priority) return false
    if (filter.onlyFollowup) {
      const state = followupState(row, now)
      if (state !== 'overdue' && state !== 'today') return false
    }
    if (filter.onlyWithContact && !row.email && !row.phone) return false
    if (filter.hall && (row.hall || '').trim() !== filter.hall) return false
    if (query) {
      const haystack = fold([row.name, row.country, row.city, row.category, row.hall, row.stand, row.email, row.contact_person, row.description].filter(Boolean).join(' '))
      if (!haystack.includes(query)) return false
    }
    return true
  })
}

export function summarize(rows: FairExhibitor[], now: Date) {
  const result = { total: rows.length, toContact: 0, highToContact: 0, contacted: 0, overdue: 0, interested: 0 }
  for (const row of rows) {
    if (row.status === 'new') {
      result.toContact += 1
      if (effectivePriority(row) === 1) result.highToContact += 1
    } else if (row.status !== 'not_interested') result.contacted += 1
    if (row.status === 'interested' || row.status === 'meeting') result.interested += 1
    if (followupState(row, now) === 'overdue') result.overdue += 1
  }
  return result
}

// ---------------------------------------------------------------------------
// Import da testo (CSV / TSV incollato da Excel o dalla tabella del sito)
// ---------------------------------------------------------------------------

const HEADER_ALIASES: Record<string, string[]> = {
  name: ['name', 'nome', 'espositore', 'azienda', 'ragione sociale', 'exhibitor', 'company', 'titolo'],
  stand: ['stand', 'padiglione stand', 'posizione'],
  hall: ['hall', 'padiglione', 'pad'],
  country: ['country', 'paese', 'nazione', 'stato'],
  city: ['city', 'citta', 'città', 'localita', 'località'],
  category: ['category', 'categoria', 'categorie', 'settore', 'tipologia'],
  description: ['description', 'descrizione', 'about', 'profilo', 'note'],
  website: ['website', 'sito', 'sito web', 'web', 'url', 'site'],
  email: ['email', 'e-mail', 'mail', 'pec'],
  phone: ['phone', 'telefono', 'tel', 'cellulare'],
  source_url: ['source_url', 'scheda', 'link scheda', 'link', 'detail'],
}

function detectDelimiter(headerLine: string) {
  const counts = { '\t': 0, ';': 0, ',': 0 }
  for (const ch of headerLine) if (ch in counts) counts[ch as keyof typeof counts] += 1
  return (Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] || ',') as string
}

function parseDelimited(text: string, delimiter: string) {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"'
        i += 1
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === delimiter) {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1
      row.push(cell)
      cell = ''
      if (row.some((value) => value.trim())) rows.push(row)
      row = []
    } else cell += ch
  }
  row.push(cell)
  if (row.some((value) => value.trim())) rows.push(row)
  return rows
}

/**
 * Legge una tabella incollata. Con intestazione riconosce le colonne dagli
 * alias; senza (una riga = un nome) prende ogni riga come nome.
 */
export function parseExhibitorsText(text: string): { items: ExhibitorInput[]; skipped: number } {
  const source = String(text || '').replace(/^﻿/, '').trim()
  if (!source) return { items: [], skipped: 0 }
  const firstLine = source.split(/\r?\n/, 1)[0]
  const delimiter = detectDelimiter(firstLine)
  const rows = parseDelimited(source, delimiter)
  if (!rows.length) return { items: [], skipped: 0 }

  const header = rows[0].map((cell) => fold(cell).trim())
  const columns: Record<string, number> = {}
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const index = header.findIndex((cell) => aliases.some((alias) => fold(alias) === cell))
    if (index >= 0) columns[field] = index
  }

  const hasHeader = columns.name !== undefined
  const body = hasHeader ? rows.slice(1) : rows
  const items: ExhibitorInput[] = []
  let skipped = 0
  const seen = new Set<string>()
  for (const cells of body) {
    const record: Record<string, unknown> = {}
    if (hasHeader) for (const [field, index] of Object.entries(columns)) record[field] = cells[index]
    else record.name = cells[0]
    const item = normalizeExhibitor(record)
    const key = item ? slugifyExhibitor(item.name) : ''
    if (!item || !key || seen.has(key)) {
      skipped += 1
      continue
    }
    seen.add(key)
    items.push(item)
  }
  return { items, skipped }
}

export function newNote(text: string, now = new Date()): FairNote | null {
  const clean = String(text || '').trim().slice(0, 2000)
  if (!clean) return null
  return { id: `${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`, at: now.toISOString(), text: clean }
}

// ---------------------------------------------------------------------------
// Dove si trova uno stand
// ---------------------------------------------------------------------------

export const TTG_HOW_TO_GET_THERE = 'https://www.ttgexpo.it/it/come-arrivare'
export const TTG_FLOOR_MAP = 'https://maps.iegexpo.cloud/ttg/2026/index.html'

/** Pagina dell'espositore sul sito della fiera, aperta sulla mappa interattiva col percorso. */
export function standMapUrl(row: Pick<FairExhibitor, 'source_url'>) {
  return row.source_url ? `${row.source_url}#mappa` : TTG_FLOOR_MAP
}

export function standLabel(row: Pick<FairExhibitor, 'hall' | 'stand'>) {
  return [row.hall && `Pad. ${row.hall.replace(/^Hall\s+/i, '')}`, row.stand && `Stand ${row.stand}`].filter(Boolean).join(' · ')
}

/** Ordine di cammino: padiglione, poi numero di stand (i senza stand in fondo). */
export function compareByLocation(a: Pick<FairExhibitor, 'hall' | 'stand' | 'name'>, b: Pick<FairExhibitor, 'hall' | 'stand' | 'name'>) {
  const key = (row: Pick<FairExhibitor, 'hall' | 'stand'>) => {
    const number = parseInt(String(row.stand || '').replace(/\D+/g, ' ').trim().split(' ')[0] || '', 10)
    return [row.hall ? 0 : 1, row.hall || '', Number.isFinite(number) ? number : 99999] as const
  }
  const [aMissing, aHall, aNum] = key(a)
  const [bMissing, bHall, bNum] = key(b)
  return aMissing - bMissing || aHall.localeCompare(bHall) || aNum - bNum || a.name.localeCompare(b.name)
}
