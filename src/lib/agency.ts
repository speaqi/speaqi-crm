// Speaqi Agency: categorie di servizio, stati delle opportunità, modello delle slide,
// temi grafici, guardie sui fatti e revisioni. Puro, senza rete né database:
// lo usano l'agente, le API, l'editor, la pagina pubblica, l'export e i test.
//
// Le regole che reggono tutto:
// - L'AI propone, il codice decide. Tipi di slide, limiti, foto e id li controlla qui.
// - Un importo o una percentuale che non sta nei materiali diventa [DA VERIFICARE].
// - Nessuna cifra economica sta nelle slide: la slide "investimento" legge il preventivo.

import { DECK_TODO, DECK_TODO_PATTERN, numbersIn } from './tourism-deck'

export { DECK_TODO as AGENCY_TODO, DECK_TODO_PATTERN as AGENCY_TODO_PATTERN }

// ---- Categorie di servizio ------------------------------------------------

export type ServiceCategory = { slug: string; name: string; description: string; sort_order: number; is_active: boolean }

/** Le categorie di partenza: si rinominano, si spengono e se ne aggiungono altre da Template. */
export const DEFAULT_SERVICE_CATEGORIES: Omit<ServiceCategory, 'is_active'>[] = [
  { slug: 'siti-web', name: 'Siti web premium', description: 'Progettazione e sviluppo di siti istituzionali, editoriali ed e-commerce.', sort_order: 10 },
  { slug: 'branding', name: 'Branding e identità visiva', description: 'Marchio, sistema visivo, linee guida, naming.', sort_order: 20 },
  { slug: 'seo-geo', name: 'SEO, GEO e motori AI', description: 'Posizionamento sui motori di ricerca e sulle risposte dei motori generativi.', sort_order: 30 },
  { slug: 'marketing', name: 'Marketing digitale', description: 'Strategia, funnel, email, automazioni di marketing.', sort_order: 40 },
  { slug: 'advertising', name: 'Campagne pubblicitarie', description: 'Campagne a pagamento su motori di ricerca e social.', sort_order: 50 },
  { slug: 'consulenza', name: 'Consulenza strategica', description: 'Analisi, posizionamento, piani di trasformazione digitale.', sort_order: 60 },
  { slug: 'software', name: 'Software e piattaforme', description: 'Applicazioni web, piattaforme, integrazioni.', sort_order: 70 },
  { slug: 'ai-automazioni', name: 'Automazioni e AI', description: 'Assistenti, agenti, automazione dei processi con intelligenza artificiale.', sort_order: 80 },
  { slug: 'social-contenuti', name: 'Social media e contenuti', description: 'Piano editoriale, produzione di contenuti, gestione dei canali.', sort_order: 90 },
  { slug: 'progetti-digitali', name: 'Progetti digitali su misura', description: 'Tutto ciò che non rientra in una categoria standard.', sort_order: 100 }
]

export function categorySlug(value: unknown) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

// ---- Opportunità ----------------------------------------------------------

export const AGENCY_STAGES = ['brief', 'proposal', 'negotiation', 'won', 'lost', 'on_hold'] as const
export type AgencyStage = (typeof AGENCY_STAGES)[number]
export const AGENCY_STAGE_LABELS: Record<AgencyStage, string> = {
  brief: 'Brief',
  proposal: 'Proposta',
  negotiation: 'Trattativa',
  won: 'Vinta',
  lost: 'Persa',
  on_hold: 'In pausa'
}
export const isAgencyStage = (v: unknown): v is AgencyStage => AGENCY_STAGES.includes(v as AgencyStage)

export const PRESENTATION_STATUSES = ['draft', 'generating', 'ready', 'approved', 'failed'] as const
export type PresentationStatus = (typeof PRESENTATION_STATUSES)[number]
export const PRESENTATION_STATUS_LABELS: Record<PresentationStatus, string> = {
  draft: 'Bozza',
  generating: 'In generazione',
  ready: 'Da rivedere',
  approved: 'Approvata',
  failed: 'Da correggere'
}

// ---- Slide ----------------------------------------------------------------

export const SLIDE_KINDS = [
  'cover',
  'agenda',
  'section',
  'statement',
  'context',
  'problems',
  'opportunities',
  'solution',
  'services',
  'process',
  'roadmap',
  'deliverables',
  'benefits',
  'metrics',
  'chart',
  'comparison',
  'quote',
  'investment',
  'next_steps',
  'closing'
] as const
export type SlideKind = (typeof SLIDE_KINDS)[number]

/** Nome e uso di ogni layout: li legge l'agente per scegliere e l'editor per mostrarli. */
export const SLIDE_KIND_INFO: Record<SlideKind, { label: string; use: string; items: [number, number] }> = {
  cover: { label: 'Copertina', use: 'Apertura: titolo della proposta, cliente, foto o marchio del cliente.', items: [0, 0] },
  agenda: { label: 'Indice', use: 'I capitoli della presentazione, da 3 a 6 voci.', items: [3, 7] },
  section: { label: 'Capitolo', use: 'Divisore di capitolo con un titolo grande. Solo per presentazioni lunghe.', items: [0, 0] },
  statement: { label: 'Messaggio', use: 'Una frase forte e un testo breve; può avere una foto.', items: [0, 0] },
  context: { label: 'Contesto', use: 'Chi è il cliente e dove si trova oggi: fatti dai materiali.', items: [0, 4] },
  problems: { label: 'Problemi', use: 'I problemi o i limiti attuali del cliente, da 2 a 4.', items: [2, 4] },
  opportunities: { label: 'Opportunità', use: 'Le opportunità che si aprono, da 2 a 4.', items: [2, 4] },
  solution: { label: 'Soluzione', use: 'La proposta in sintesi: titolo, testo e 2-4 pilastri.', items: [0, 4] },
  services: { label: 'Servizi', use: 'I servizi o i moduli inclusi nella proposta, da 2 a 6.', items: [2, 6] },
  process: { label: 'Metodo', use: 'Le fasi del lavoro in ordine, da 3 a 6.', items: [3, 6] },
  roadmap: { label: 'Roadmap', use: 'Fasi nel tempo: in "value" il periodo (es. "Mese 1-2"). Tempi solo se indicati nei materiali, altrimenti [DA VERIFICARE].', items: [3, 6] },
  deliverables: { label: 'Deliverable', use: 'Cosa riceve il cliente, da 3 a 8 voci concrete.', items: [3, 8] },
  benefits: { label: 'Benefici', use: 'I benefici attesi, qualitativi; nessun risultato numerico inventato.', items: [2, 4] },
  metrics: { label: 'Numeri', use: 'Da 2 a 4 numeri chiave in "value". Solo numeri presenti nei materiali.', items: [2, 4] },
  chart: { label: 'Grafico', use: 'Grafico a barre: "value" numerico per ogni voce. Solo dati presenti nei materiali.', items: [2, 6] },
  comparison: { label: 'Prima / dopo', use: 'Due colonne: la prima voce è "Oggi", la seconda "Con il progetto". Il testo di ogni voce è un elenco con righe separate da a capo.', items: [2, 2] },
  quote: { label: 'Citazione', use: 'Una frase del cliente o dei suoi materiali, con l’autore nella nota. Mai inventata.', items: [0, 0] },
  investment: { label: 'Investimento', use: 'Il riepilogo economico. Le cifre arrivano dal preventivo collegato: non scrivere importi.', items: [0, 0] },
  next_steps: { label: 'Prossimi passi', use: 'Cosa succede dopo il sì, da 2 a 4 passi.', items: [2, 4] },
  closing: { label: 'Chiusura', use: 'Chiusura breve con il contatto.', items: [0, 0] }
}

export const SLIDE_LAYOUTS = ['auto', 'image_left', 'image_right', 'centered'] as const
export type SlideLayout = (typeof SLIDE_LAYOUTS)[number]

export type SlideItem = { title: string; text: string; value: string }
export type AgencySlide = {
  id: string
  kind: SlideKind
  kicker: string
  title: string
  body: string
  items: SlideItem[]
  note: string
  image_asset_id: string | null
  layout: SlideLayout
}

export const LIMITS = {
  slides: 24,
  items: 8,
  kicker: 60,
  title: 180,
  body: 900,
  note: 300,
  itemTitle: 90,
  itemText: 400,
  itemValue: 40
}

const clip = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/\u0000/g, '').trim().slice(0, max) : '')
const isAssetId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v)

export const isSlideKind = (v: unknown): v is SlideKind => SLIDE_KINDS.includes(v as SlideKind)

function slugId(value: unknown, fallback: string) {
  const id = String(value ?? '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  return id || fallback
}

export function normalizeSlide(raw: unknown, index = 0): AgencySlide {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const kind = isSlideKind(r.kind) ? r.kind : 'statement'
  const max = Math.max(SLIDE_KIND_INFO[kind].items[1], 0)
  const items = (Array.isArray(r.items) ? r.items : [])
    .slice(0, Math.min(max, LIMITS.items))
    .map((item) => {
      const i = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
      return { title: clip(i.title, LIMITS.itemTitle), text: clip(i.text, LIMITS.itemText), value: clip(i.value, LIMITS.itemValue) }
    })
    .filter((item) => item.title || item.text || item.value)
  return {
    id: slugId(r.id, `slide-${index + 1}`),
    kind,
    kicker: clip(r.kicker, LIMITS.kicker),
    title: clip(r.title, LIMITS.title),
    body: clip(r.body, LIMITS.body),
    // La slide investimento non porta righe: le righe sono quelle del preventivo.
    items: kind === 'investment' ? [] : items,
    note: clip(r.note, LIMITS.note),
    image_asset_id: isAssetId(r.image_asset_id) ? r.image_asset_id : null,
    layout: SLIDE_LAYOUTS.includes(r.layout as SlideLayout) ? (r.layout as SlideLayout) : 'auto'
  }
}

/** Legge le slide da JSON: scarta il superfluo, rende unici gli id, non lancia. */
export function normalizeSlides(raw: unknown): AgencySlide[] {
  const seen = new Set<string>()
  return (Array.isArray(raw) ? raw : []).slice(0, LIMITS.slides).map((s, i) => {
    const n = normalizeSlide(s, i)
    let id = n.id
    for (let k = 2; seen.has(id); k++) id = `${n.id}-${k}`
    seen.add(id)
    return { ...n, id }
  })
}

export function blankSlide(kind: SlideKind, existingIds: string[] = []): AgencySlide {
  const base = kind.replace(/_/g, '-')
  let id = base
  for (let k = 2; existingIds.includes(id); k++) id = `${base}-${k}`
  const [min] = SLIDE_KIND_INFO[kind].items
  return normalizeSlide({
    id,
    kind,
    title: kind === 'investment' ? 'L’investimento' : SLIDE_KIND_INFO[kind].label,
    items: Array.from({ length: kind === 'comparison' ? 2 : min }, (_, i) =>
      kind === 'comparison' ? { title: i === 0 ? 'Oggi' : 'Con il progetto', text: '' } : { title: `Voce ${i + 1}`, text: '' }
    )
  })
}

// ---- Temi grafici ---------------------------------------------------------

export const THEME_STYLES = ['editorial', 'institutional', 'bold'] as const
export type ThemeStyle = (typeof THEME_STYLES)[number]
export const THEME_STYLE_INFO: Record<ThemeStyle, { label: string; description: string }> = {
  editorial: { label: 'Editoriale', description: 'Fondo crema, titoli grandi, molto respiro. Per proposte creative e di brand.' },
  institutional: { label: 'Istituzionale', description: 'Fondo bianco, gerarchie sobrie, accento misurato. Per enti, aziende strutturate, gare.' },
  bold: { label: 'Bold', description: 'Fondo scuro, tipografia fuori scala, accento forte. Per pitch d’impatto.' }
}

export type AgencyTheme = {
  style: ThemeStyle
  /** Colore d'accento: quello Speaqi o quello del cliente. */
  accent: string
  /** Mostrare il logo del cliente in copertina e nel piede. */
  client_logo: boolean
  language: 'it' | 'en'
}

export const DEFAULT_ACCENT = '#fc511f'
export const DEFAULT_THEME: AgencyTheme = { style: 'editorial', accent: DEFAULT_ACCENT, client_logo: true, language: 'it' }

export function normalizeHex(value: unknown): string | null {
  const v = String(value ?? '').trim().toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(v)) return v
  if (/^#[0-9a-f]{3}$/.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`
  return null
}

export function normalizeTheme(raw: unknown, fallback: AgencyTheme = DEFAULT_THEME): AgencyTheme {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    style: THEME_STYLES.includes(r.style as ThemeStyle) ? (r.style as ThemeStyle) : fallback.style,
    accent: normalizeHex(r.accent) || fallback.accent,
    client_logo: typeof r.client_logo === 'boolean' ? r.client_logo : fallback.client_logo,
    language: r.language === 'en' || r.language === 'it' ? r.language : fallback.language
  }
}

/** Luminanza relativa (WCAG): per scegliere il testo sopra il colore d'accento. */
export function luminance(hex: string) {
  const n = normalizeHex(hex) || DEFAULT_ACCENT
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(n.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
export const inkOn = (hex: string) => (luminance(hex) > 0.45 ? '#1d2d44' : '#ffffff')

export type ClientBrand = { name: string; accent: string | null; logo_asset_id: string | null }
export function normalizeClientBrand(raw: unknown): ClientBrand {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return { name: clip(r.name, 120), accent: normalizeHex(r.accent), logo_asset_id: isAssetId(r.logo_asset_id) ? r.logo_asset_id : null }
}

// ---- Preventivo collegato -------------------------------------------------

export type QuoteSummary = {
  id: string
  number: string
  title: string
  status: string
  currency: string
  billing_interval: 'one_time' | 'year'
  lines: { description: string; details: string; quantity: number; total: number }[]
  subtotal: number
  discount: number
  tax_rate: number
  tax: number
  total: number
  valid_until: string | null
  public_token: string | null
  updated_at: string | null
}

const money = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0
}

/** Dal record del preventivo a ciò che la slide mostra: solo le righe che concorrono al totale. */
export function quoteSummary(row: Record<string, any> | null | undefined): QuoteSummary | null {
  if (!row || !row.id) return null
  const items = Array.isArray(row.items) ? row.items : []
  return {
    id: String(row.id),
    number: String(row.quote_number || ''),
    title: String(row.title || ''),
    status: String(row.status || ''),
    currency: /^[A-Z]{3}$/.test(String(row.currency || '')) ? String(row.currency) : 'EUR',
    billing_interval: row.billing_interval === 'year' ? 'year' : 'one_time',
    lines: items
      .filter((i: any) => !i?.choice_group_id || i?.selected === true)
      .map((i: any) => ({
        description: clip(i?.description, 200),
        details: clip(i?.details, 400),
        quantity: money(i?.quantity),
        total: money(i?.line_total ?? Number(i?.quantity) * Number(i?.unit_price))
      })),
    subtotal: money(row.subtotal_amount),
    discount: money(row.discount_amount),
    tax_rate: money(row.tax_rate),
    tax: money(row.tax_amount),
    total: money(row.total_amount),
    valid_until: row.valid_until ? String(row.valid_until) : null,
    public_token: row.status === 'cancelled' ? null : row.public_token ? String(row.public_token) : null,
    updated_at: row.updated_at ? String(row.updated_at) : null
  }
}

export function formatMoney(value: number, currency = 'EUR') {
  try {
    return new Intl.NumberFormat('it-IT', { style: 'currency', currency, minimumFractionDigits: 2 }).format(value)
  } catch {
    return `${value.toFixed(2)} ${currency}`
  }
}

// ---- [DA VERIFICARE] ------------------------------------------------------

const slideStrings = (s: AgencySlide) => [s.kicker, s.title, s.body, s.note, ...s.items.flatMap((i) => [i.title, i.text, i.value])]

/** Da completare prima di approvare. Una slide investimento senza preventivo è una mancanza. */
export function countTodo(slides: AgencySlide[], opts: { hasQuote: boolean } = { hasQuote: true }) {
  let n = 0
  for (const s of slides) {
    for (const text of slideStrings(s)) n += text.match(DECK_TODO_PATTERN)?.length || 0
    if (s.kind === 'investment' && !opts.hasQuote) n++
  }
  return n
}

// ---- Guardie sui fatti ----------------------------------------------------

const AMOUNT = /(?:€\s*\d[\d.,]*(?:\s*(?:k|mila|mln|milioni))?|\d[\d.,]*\s*(?:k|mila|mln|milioni)?\s*(?:€|euro\b|eur\b))/gi
const PERCENT = /[+-]?\d[\d.,]*\s*%/g
const NUMBER = /\d[\d.,]*/g
const digitsOnly = (value: string) => value.replace(/[^\d]/g, '')
const isYear = (d: string) => /^(19|20)\d{2}$/.test(d)

export type AgencyWarning = { slide: string; message: string }

/**
 * Controlla l'output dell'agente contro i materiali.
 * - Importi e percentuali senza riscontro diventano [DA VERIFICARE] (un "+30% di contatti"
 *   inventato è un risultato non dimostrabile).
 * - Il "value" di numeri e grafici senza riscontro diventa [DA VERIFICARE].
 * - Gli altri numeri senza riscontro restano ma si segnalano.
 * - Una foto che non è fra quelle del progetto si toglie.
 * - La slide investimento perde ogni importo: le cifre le mette il preventivo.
 */
export function guardSlides(slides: AgencySlide[], corpus: string, assetIds: string[]) {
  const known = numbersIn(corpus)
  // Una percentuale vale solo se nei materiali c'è la stessa percentuale: "40 ettari" non
  // giustifica "+40% di ordini".
  const knownPercents = new Set((corpus.match(PERCENT) || []).map(digitsOnly))
  const warnings: AgencyWarning[] = []
  const guard = (text: string, slideId: string, strict = false) => {
    let out = text.replace(AMOUNT, (m) => {
      if (!strict && known.has(digitsOnly(m))) return m
      warnings.push({ slide: slideId, message: `Importo senza riscontro sostituito: ${m.trim()}` })
      return DECK_TODO
    })
    out = out.replace(PERCENT, (m) => {
      if (knownPercents.has(digitsOnly(m))) return m
      warnings.push({ slide: slideId, message: `Percentuale senza riscontro sostituita: ${m.trim()}` })
      return DECK_TODO
    })
    for (const m of out.match(NUMBER) || []) {
      const d = digitsOnly(m)
      if (d.length >= 2 && !isYear(d) && !known.has(d)) warnings.push({ slide: slideId, message: `Numero senza riscontro nei materiali: ${m}` })
    }
    return out
  }
  const guardValue = (value: string, slideId: string) => {
    if (!value || value === DECK_TODO) return value
    const nums = value.match(NUMBER) || []
    const pct = /%/.test(value)
    if (nums.some((m) => !isYear(digitsOnly(m)) && !(pct ? knownPercents : known).has(digitsOnly(m)))) {
      warnings.push({ slide: slideId, message: `Valore senza riscontro sostituito: ${value}` })
      return DECK_TODO
    }
    return value
  }
  const out = slides.map((s) => {
    const strict = s.kind === 'investment'
    const valueIsData = s.kind === 'metrics' || s.kind === 'chart'
    return {
      ...s,
      kicker: guard(s.kicker, s.id, strict),
      title: guard(s.title, s.id, strict),
      body: guard(s.body, s.id, strict),
      note: guard(s.note, s.id, strict),
      items: s.items.map((i) => ({
        title: guard(i.title, s.id),
        text: guard(i.text, s.id),
        value: valueIsData ? guardValue(i.value, s.id) : guard(i.value, s.id)
      })),
      image_asset_id: s.image_asset_id && assetIds.includes(s.image_asset_id) ? s.image_asset_id : null
    }
  })
  // Una foto per slide e mai la stessa due volte: la seconda volta si toglie.
  const used = new Set<string>()
  for (const s of out) {
    if (!s.image_asset_id) continue
    if (used.has(s.image_asset_id)) s.image_asset_id = null
    else used.add(s.image_asset_id)
  }
  return { slides: out, warnings: dedupeWarnings(warnings) }
}

function dedupeWarnings(list: AgencyWarning[]) {
  const seen = new Set<string>()
  return list.filter((w) => {
    const k = `${w.slide}|${w.message}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/** Una presentazione senza struttura minima non si consegna: copertina in testa, chiusura in fondo. */
export function ensureFrame(slides: AgencySlide[], fallbackTitle: string): AgencySlide[] {
  const list = [...slides]
  if (!list.length || list[0].kind !== 'cover') {
    const idx = list.findIndex((s) => s.kind === 'cover')
    if (idx > 0) list.unshift(list.splice(idx, 1)[0])
    else list.unshift(normalizeSlide({ id: 'cover', kind: 'cover', title: fallbackTitle }))
  }
  if (list[list.length - 1].kind !== 'closing') {
    const idx = list.findIndex((s) => s.kind === 'closing')
    if (idx >= 0) list.push(list.splice(idx, 1)[0])
  }
  return normalizeSlides(list)
}

// ---- Analisi --------------------------------------------------------------

export type AgencyAnalysis = {
  client_summary: string
  sector: string
  needs: string[]
  objectives: string[]
  verified_facts: { fact: string; source: string }[]
  assumptions: string[]
  missing: string[]
  strategy: { positioning: string; proposal: string; services: string[] }
  outline: { kind: SlideKind; purpose: string }[]
  generated_at?: string
  model?: string
}

const list = (v: unknown, max: number, len = 300) =>
  (Array.isArray(v) ? v : []).filter((x): x is string => typeof x === 'string').map((x) => clip(x, len)).filter(Boolean).slice(0, max)

export function normalizeAnalysis(raw: unknown): AgencyAnalysis {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>
  const st = (r.strategy && typeof r.strategy === 'object' ? r.strategy : {}) as Record<string, unknown>
  return {
    client_summary: clip(r.client_summary, 1200),
    sector: clip(r.sector, 200),
    needs: list(r.needs, 10),
    objectives: list(r.objectives, 10),
    verified_facts: (Array.isArray(r.verified_facts) ? r.verified_facts : [])
      .map((f: any) => ({ fact: clip(f?.fact, 300), source: clip(f?.source, 160) }))
      .filter((f: { fact: string }) => f.fact)
      .slice(0, 20),
    assumptions: list(r.assumptions, 12),
    missing: list(r.missing, 12),
    strategy: { positioning: clip(st.positioning, 800), proposal: clip(st.proposal, 1200), services: list(st.services, 10, 120) },
    outline: (Array.isArray(r.outline) ? r.outline : [])
      .filter((o: any) => isSlideKind(o?.kind))
      .map((o: any) => ({ kind: o.kind as SlideKind, purpose: clip(o?.purpose, 200) }))
      .slice(0, LIMITS.slides),
    generated_at: typeof r.generated_at === 'string' ? r.generated_at : undefined,
    model: typeof r.model === 'string' ? clip(r.model, 80) : undefined
  }
}

// ---- Revisioni --------------------------------------------------------------

export type RevisionOp =
  | { op: 'update'; id: string; slide: Partial<AgencySlide> }
  | { op: 'insert'; after_id: string | null; slide: Partial<AgencySlide> }
  | { op: 'delete'; id: string }
  | { op: 'move'; id: string; after_id: string | null }

/** Legge le operazioni proposte dall'agente: scarta ciò che non riconosce. */
export function normalizeOps(raw: unknown): RevisionOp[] {
  const out: RevisionOp[] = []
  for (const o of Array.isArray(raw) ? raw.slice(0, 40) : []) {
    if (!o || typeof o !== 'object') continue
    const r = o as Record<string, any>
    const id = typeof r.id === 'string' ? r.id : ''
    const after = typeof r.after_id === 'string' && r.after_id ? r.after_id : null
    const slide = r.slide && typeof r.slide === 'object' ? (r.slide as Partial<AgencySlide>) : null
    if (r.op === 'update' && id && slide) out.push({ op: 'update', id, slide })
    else if (r.op === 'insert' && slide) out.push({ op: 'insert', after_id: after, slide })
    else if (r.op === 'delete' && id) out.push({ op: 'delete', id })
    else if (r.op === 'move' && id) out.push({ op: 'move', id, after_id: after })
  }
  return out
}

/**
 * Applica una revisione toccando solo le slide nominate. Un'operazione su un id che non
 * esiste si salta e si dice; una modifica non cambia l'id; una nuova slide prende un id libero.
 * Restituisce anche gli id cambiati, così le guardie si applicano solo a quelli.
 */
export function applyRevision(current: AgencySlide[], ops: RevisionOp[]) {
  let slides = current.map((s) => ({ ...s, items: s.items.map((i) => ({ ...i })) }))
  const changed = new Set<string>()
  const skipped: string[] = []
  const ids = () => slides.map((s) => s.id)
  const indexAfter = (after: string | null) => {
    if (after === null) return slides.length
    if (after === '__start__') return 0
    const i = slides.findIndex((s) => s.id === after)
    return i < 0 ? slides.length : i + 1
  }
  for (const op of ops) {
    if (op.op === 'update') {
      const i = slides.findIndex((s) => s.id === op.id)
      if (i < 0) { skipped.push(`modifica di "${op.id}": slide inesistente`); continue }
      const prev = slides[i]
      const merged = normalizeSlide(
        {
          ...prev,
          ...Object.fromEntries(Object.entries(op.slide).filter(([, v]) => v !== undefined && v !== null)),
          id: prev.id,
          kind: isSlideKind(op.slide.kind) ? op.slide.kind : prev.kind
        },
        i
      )
      // Un campo restituito vuoto non svuota la slide, salvo body/note/kicker (togliere è lecito).
      slides[i] = { ...merged, title: merged.title || prev.title, items: Array.isArray(op.slide.items) ? merged.items : prev.items }
      changed.add(prev.id)
    } else if (op.op === 'insert') {
      if (slides.length >= LIMITS.slides) { skipped.push('nuova slide: limite di slide raggiunto'); continue }
      const kind = isSlideKind(op.slide.kind) ? op.slide.kind : 'statement'
      const fresh = blankSlide(kind, ids())
      const merged = normalizeSlide({ ...fresh, ...op.slide, id: fresh.id, kind })
      slides.splice(indexAfter(op.after_id), 0, { ...merged, id: fresh.id, title: merged.title || fresh.title })
      changed.add(fresh.id)
    } else if (op.op === 'delete') {
      const before = slides.length
      slides = slides.filter((s) => s.id !== op.id)
      if (slides.length === before) skipped.push(`eliminazione di "${op.id}": slide inesistente`)
      if (!slides.length) { slides = current; skipped.push('non si possono eliminare tutte le slide'); break }
    } else if (op.op === 'move') {
      const i = slides.findIndex((s) => s.id === op.id)
      if (i < 0) { skipped.push(`spostamento di "${op.id}": slide inesistente`); continue }
      const [s] = slides.splice(i, 1)
      slides.splice(Math.min(indexAfter(op.after_id), slides.length), 0, s)
    }
  }
  return { slides: normalizeSlides(slides), changed: [...changed], skipped }
}

/** Testo di tutte le slide: entra nel corpus delle revisioni (ciò che l'utente ha scritto vale). */
export function slidesText(slides: AgencySlide[]) {
  return slides.flatMap(slideStrings).filter(Boolean).join('\n')
}

export function summaryOf(slides: AgencySlide[], hasQuote: boolean) {
  return { slides: slides.length, todo: countTodo(slides, { hasQuote }) }
}

/** Nome file leggibile per PDF e PPTX. */
export function fileStem(value: string) {
  return (
    value
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'proposta'
  )
}

// ---- Identità dell'agenzia ------------------------------------------------

export type AgencySettings = {
  /** Come si firma l'agenzia nelle slide. */
  name: string
  /** Riga sotto il nome in copertina e in chiusura. */
  signature: string
  /** Contatto in chiusura: nome, email, telefono. Vuoto = [DA VERIFICARE]. */
  contact: string
  /** Chi siamo, in poche righe: l'agente lo usa, non lo inventa. */
  about: string
  default_style: ThemeStyle
  default_accent: string
}

export const DEFAULT_AGENCY_SETTINGS: AgencySettings = {
  name: 'Speaqi Agency',
  signature: 'Strategia, design e tecnologia per progetti digitali',
  contact: '',
  about: '',
  default_style: 'editorial',
  default_accent: DEFAULT_ACCENT
}

export function normalizeAgencySettings(raw: unknown): AgencySettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    name: clip(r.name, 80) || DEFAULT_AGENCY_SETTINGS.name,
    signature: clip(r.signature, 160),
    contact: clip(r.contact, 300),
    about: clip(r.about, 2000),
    default_style: THEME_STYLES.includes(r.default_style as ThemeStyle) ? (r.default_style as ThemeStyle) : DEFAULT_AGENCY_SETTINGS.default_style,
    default_accent: normalizeHex(r.default_accent) || DEFAULT_ACCENT
  }
}
