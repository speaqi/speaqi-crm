// Presentazione per destinazione (Tourism Intelligence): modello, segnaposto e guardie.
// Puro, senza accesso a rete o database: lo usano l'agente, le API, la pagina e i test.

export const DECK_TODO = '[DA VERIFICARE]'
/** Ogni segnaposto da completare, anche con la nota ("[DA VERIFICARE per questo ente]"). */
export const DECK_TODO_PATTERN = /\[DA VERIFICARE[^\]]{0,80}\]/g

export const DECK_SLIDE_KINDS = ['cover', 'statement', 'cards', 'steps', 'closing'] as const
export type DeckSlideKind = (typeof DECK_SLIDE_KINDS)[number]

export const DECK_STATUSES = ['draft', 'generating', 'ready', 'approved', 'failed'] as const
export type DeckStatus = (typeof DECK_STATUSES)[number]

export type DeckItem = { title: string; text: string }
export type DeckSlide = {
  id: string
  kind: DeckSlideKind
  title: string
  body: string
  items: DeckItem[]
  /** Riga in fondo alla slide (es. il prezzo). */
  note: string
  /** Foto scelta fra quelle caricate per questo deck; mai un indirizzo esterno. */
  image_asset_id: string | null
  /** Istruzione per l'agente: cosa si personalizza in questa slide. Non si mostra al cliente. */
  hint: string
}
export type DeckTemplate = {
  version: 1
  /** Valori di partenza dei segnaposto {{nome}}. */
  vars: Record<string, string>
  slides: DeckSlide[]
}

export const DECK_VAR_NAMES = ['destinazione', 'ente', 'paese', 'prezzo', 'contatto'] as const
export type DeckVarName = (typeof DECK_VAR_NAMES)[number]
export type DeckInput = Partial<Record<DeckVarName, string>>

const LIMITS = { slides: 12, items: 6, title: 160, body: 700, note: 300, itemTitle: 80, itemText: 260, hint: 500, varValue: 300 }

const slide = (s: Partial<DeckSlide> & Pick<DeckSlide, 'id' | 'kind' | 'title'>): DeckSlide => ({
  body: '',
  items: [],
  note: '',
  image_asset_id: null,
  hint: '',
  ...s
})

/**
 * La presentazione TTG "Mappa per destinazioni": promessa, contenuti, visitatore,
 * metodo e prezzo, più copertina e chiusura. Fonte: profilo Speaqi (repo speaqidesign).
 * Nessuna funzione, tempo o prezzo che non stia nel profilo: il resto è [DA VERIFICARE].
 */
export const DEFAULT_DECK_TEMPLATE: DeckTemplate = {
  version: 1,
  vars: {
    prezzo: 'da 249 €/mese. Extra e video su preventivo [DA VERIFICARE per questo ente]',
    contatto: DECK_TODO
  },
  slides: [
    slide({
      id: 'cover',
      kind: 'cover',
      title: '{{destinazione}}, nella lingua di ogni visitatore',
      body: 'Proposta per {{ente}}',
      hint: 'Titolo con il nome della destinazione. Nel corpo il nome dell’ente destinatario. Scegli come foto la più rappresentativa della destinazione, se ce n’è una.'
    }),
    slide({
      id: 'promise',
      kind: 'statement',
      title: 'Una sola conoscenza. Ogni lingua. Ogni punto di contatto.',
      body: 'Raccontate {{destinazione}} una volta. Speaqi la fa parlare con i visitatori nella loro lingua, in ogni luogo.',
      hint: 'Mantieni la promessa nel titolo. Nel corpo aggiungi al massimo un dettaglio sulla destinazione che sia scritto nei materiali; se non c’è, lascia il testo com’è.'
    }),
    slide({
      id: 'content',
      kind: 'cards',
      title: 'Ogni luogo di {{destinazione}} ha voce, immagini e video',
      items: [
        { title: 'Mappa interattiva', text: 'I luoghi della destinazione su una mappa che si apre dal browser.' },
        { title: 'Audio guida', text: 'Ogni luogo racconta la sua storia, in più lingue.' },
        { title: 'Video girati sul posto', text: 'Brevi video girati nei luoghi, per far vedere prima di andare.' },
        { title: 'AI Concierge', text: 'Risponde ai visitatori usando solo le informazioni che approvate voi.' }
      ],
      hint: 'Mantieni le quattro voci. Puoi citare nel testo i luoghi o le esperienze di questa destinazione solo se compaiono nei materiali. Non aggiungere funzioni.'
    }),
    slide({
      id: 'visitor',
      kind: 'cards',
      title: 'Il visitatore apre la guida da dove si trova, senza app',
      items: [
        { title: 'Da QR Code o link', text: 'Un QR sul luogo o un link: si apre dal browser, senza scaricare niente.' },
        { title: '«Sono qui»', text: 'Il visitatore trova subito i luoghi intorno a sé.' },
        { title: 'In oltre 50 lingue', text: 'Testi e audio nella lingua di chi visita.' }
      ],
      hint: 'Se i materiali dicono quali sono le lingue dei visitatori di questa destinazione, citale nella terza voce. Altrimenti lascia il testo com’è.'
    }),
    slide({
      id: 'method',
      kind: 'steps',
      title: 'Cinque passi, e approvate voi prima di pubblicare',
      items: [
        { title: 'Analisi', text: 'Partiamo dai luoghi e dai materiali della destinazione.' },
        { title: 'Costruzione', text: 'Creiamo mappa, testi, audio e video.' },
        { title: 'Approvazione', text: 'La destinazione rivede e approva i contenuti.' },
        { title: 'Pubblicazione', text: 'La guida va online solo dopo l’approvazione.' },
        { title: 'Aggiornamento', text: 'I contenuti restano aggiornati nel tempo.' }
      ],
      note: 'Offerta Destinazioni: {{prezzo}}',
      hint: 'Non promettere tempi di consegna. Non cambiare il prezzo nella nota: usa solo quello indicato dall’utente. Non parlare di white label.'
    }),
    slide({
      id: 'closing',
      kind: 'closing',
      title: 'Partiamo da {{destinazione}}',
      body: 'Scrivici e cominciamo dall’analisi dei luoghi. {{contatto}}',
      hint: 'Chiusura breve e concreta. Non inventare contatti: usa solo quello indicato.'
    })
  ]
}

const clip = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/\u0000/g, '').trim().slice(0, max) : '')

const slugId = (value: unknown, fallback: string) => {
  const id = String(value ?? '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  return id || fallback
}

export function normalizeSlide(raw: unknown, index: number): DeckSlide {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const kind = DECK_SLIDE_KINDS.includes(r.kind as DeckSlideKind) ? (r.kind as DeckSlideKind) : 'statement'
  const items = (Array.isArray(r.items) ? r.items : [])
    .slice(0, LIMITS.items)
    .map((item) => {
      const i = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
      return { title: clip(i.title, LIMITS.itemTitle), text: clip(i.text, LIMITS.itemText) }
    })
    .filter((item) => item.title || item.text)
  return {
    id: slugId(r.id, `slide-${index + 1}`),
    kind,
    title: clip(r.title, LIMITS.title),
    body: clip(r.body, LIMITS.body),
    items,
    note: clip(r.note, LIMITS.note),
    image_asset_id: typeof r.image_asset_id === 'string' && /^[0-9a-f-]{36}$/i.test(r.image_asset_id) ? r.image_asset_id : null,
    hint: clip(r.hint, LIMITS.hint)
  }
}

/** Legge un modello o un deck da JSON: scarta il superfluo, rende unici gli id, non lancia. */
export function normalizeTemplate(raw: unknown): DeckTemplate {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const seen = new Set<string>()
  const slides = (Array.isArray(r.slides) ? r.slides : []).slice(0, LIMITS.slides).map((s, i) => {
    const n = normalizeSlide(s, i)
    let id = n.id
    for (let k = 2; seen.has(id); k++) id = `${n.id}-${k}`
    seen.add(id)
    return { ...n, id }
  })
  const vars: Record<string, string> = {}
  if (r.vars && typeof r.vars === 'object') {
    for (const name of DECK_VAR_NAMES) {
      const value = clip((r.vars as Record<string, unknown>)[name], LIMITS.varValue)
      if (value) vars[name] = value
    }
  }
  if (!slides.length) return structuredClone(DEFAULT_DECK_TEMPLATE)
  return { version: 1, vars, slides }
}

/** Valori dei segnaposto: input dell'utente, poi i valori di partenza del modello, poi [DA VERIFICARE]. */
export function resolveVars(template: DeckTemplate, input: DeckInput): Record<DeckVarName, string> {
  const out = {} as Record<DeckVarName, string>
  for (const name of DECK_VAR_NAMES) {
    out[name] = clip(input[name], LIMITS.varValue) || template.vars[name] || DECK_TODO
  }
  return out
}

export function fillPlaceholders(text: string, vars: Record<string, string>) {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, name: string) => vars[name.toLowerCase()] || DECK_TODO)
}

/** Il modello con i segnaposto riempiti: il punto di partenza dell'agente e il ripiego se l'agente non risponde. */
export function applyVars(template: DeckTemplate, input: DeckInput): DeckSlide[] {
  const vars = resolveVars(template, input)
  const fill = (s: string) => fillPlaceholders(s, vars)
  return template.slides.map((s) => ({
    ...s,
    title: fill(s.title),
    body: fill(s.body),
    note: fill(s.note),
    items: s.items.map((i) => ({ title: fill(i.title), text: fill(i.text) }))
  }))
}

const slideStrings = (s: DeckSlide) => [s.title, s.body, s.note, ...s.items.flatMap((i) => [i.title, i.text])]

export function countTodo(slides: DeckSlide[]) {
  return slides.reduce((sum, s) => sum + slideStrings(s).reduce((n, text) => n + (text.match(DECK_TODO_PATTERN)?.length || 0), 0), 0)
}

// ---- Guardie sui fatti ----------------------------------------------------

const AMOUNT = /(?:€\s*\d[\d.,]*|\d[\d.,]*\s*(?:€|euro\b))/gi
const NUMBER = /\d[\d.,]*/g

const digitsOnly = (value: string) => value.replace(/[^\d]/g, '')

/** Cifre (senza separatori) di tutti i numeri presenti in un testo. */
export function numbersIn(text: string): Set<string> {
  const out = new Set<string>()
  for (const m of text.match(NUMBER) || []) {
    const d = digitsOnly(m)
    if (d) out.add(d)
  }
  return out
}

const isYear = (digits: string) => /^(19|20)\d{2}$/.test(digits)

export type DeckWarning = { slide: string; message: string }

/**
 * Controlla l'output dell'agente contro ciò che esiste davvero.
 * - Un importo in euro che non sta nel modello, nei valori inseriti o nei materiali diventa [DA VERIFICARE].
 * - Un altro numero senza riscontro nei materiali non si tocca ma si segnala.
 * - Una foto che non è fra quelle del deck si toglie.
 */
export function guardGenerated(
  slides: DeckSlide[],
  corpus: string,
  assetIds: string[]
): { slides: DeckSlide[]; warnings: DeckWarning[] } {
  const known = numbersIn(corpus)
  const warnings: DeckWarning[] = []
  const guard = (text: string, slideId: string) => {
    const out = text.replace(AMOUNT, (match) => {
      const d = digitsOnly(match)
      if (known.has(d)) return match
      warnings.push({ slide: slideId, message: `Importo non presente nei materiali sostituito: ${match.trim()}` })
      return DECK_TODO
    })
    for (const m of out.match(NUMBER) || []) {
      const d = digitsOnly(m)
      if (d.length >= 2 && !isYear(d) && !known.has(d)) {
        warnings.push({ slide: slideId, message: `Numero senza riscontro nei materiali: ${m}` })
      }
    }
    return out
  }
  const result = slides.map((s) => ({
    ...s,
    title: guard(s.title, s.id),
    body: guard(s.body, s.id),
    note: guard(s.note, s.id),
    items: s.items.map((i) => ({ title: guard(i.title, s.id), text: guard(i.text, s.id) })),
    image_asset_id: s.image_asset_id && assetIds.includes(s.image_asset_id) ? s.image_asset_id : null
  }))
  return { slides: result, warnings }
}

/**
 * Fonde la risposta dell'agente nelle slide di base: conta solo cosa è stato chiesto.
 * Id sconosciuti si scartano, tipo e istruzione restano quelli del modello, un campo
 * vuoto o mancante resta il testo di base (mai una slide svuotata).
 */
export function mergeGenerated(base: DeckSlide[], generated: unknown): DeckSlide[] {
  const list = Array.isArray((generated as { slides?: unknown })?.slides) ? ((generated as { slides: unknown[] }).slides) : []
  const byId = new Map<string, Record<string, unknown>>()
  for (const g of list) {
    if (g && typeof g === 'object' && typeof (g as { id?: unknown }).id === 'string') byId.set((g as { id: string }).id, g as Record<string, unknown>)
  }
  return base.map((b) => {
    const g = byId.get(b.id)
    if (!g) return b
    const title = clip(g.title, LIMITS.title)
    const body = clip(g.body, LIMITS.body)
    const note = clip(g.note, LIMITS.note)
    const items = Array.isArray(g.items)
      ? normalizeSlide({ items: g.items }, 0).items
      : []
    return {
      ...b,
      title: title || b.title,
      body: b.body ? body || b.body : body,
      note: b.note ? note || b.note : note,
      // Il numero delle voci lo decide il modello della slide, non l'agente.
      items: b.items.length ? b.items.map((bi, idx) => ({ title: items[idx]?.title || bi.title, text: items[idx]?.text || bi.text })) : [],
      image_asset_id: typeof g.image_asset_id === 'string' ? g.image_asset_id : b.image_asset_id
    }
  })
}

/** Testo da cui l'agente può prendere numeri e importi: modello, valori inseriti e materiali. */
export function buildCorpus(template: DeckTemplate, input: DeckInput, materials: string[]) {
  return [
    ...template.slides.flatMap(slideStrings),
    ...Object.values(template.vars),
    ...Object.values(input),
    ...materials
  ].join('\n')
}

export function deckSummary(slides: DeckSlide[]) {
  return { slides: slides.length, todo: countTodo(slides) }
}
