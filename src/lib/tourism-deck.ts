// Presentazione per destinazione (Tourism Intelligence): modello, segnaposto e guardie.
import { normalizeQuoteTemplate, type QuoteTemplate } from './commercial-proposal'
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
  quote_template?: QuoteTemplate
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
 * La proposta base per le destinazioni ("Speaqi — Proposta destinazioni",
 * ottobre 2026): la mappa è gratuita per l'ente, che in cambio garantisce
 * almeno 100.000 accessi all'anno e la distribuisce (QR nei luoghi, sulle
 * mappe, sul sito e sui social). Dodici slide nello stesso ordine della
 * presentazione di riferimento: apertura, territorio, problema, risposta,
 * prova, contenuti, lingue, visitatore, metodo, prezzo, area riservata, demo.
 * Nessuna funzione, tempo o prezzo che non stia lì: il resto è [DA VERIFICARE].
 */
export const DEFAULT_DECK_TEMPLATE: DeckTemplate = {
  version: 1,
  vars: {
    prezzo:
      'in cambio garantite almeno 100.000 accessi all’anno: QR in ogni luogo, sulle mappe e sui materiali, link sul sito e sui social. A pagamento, su richiesta: Concierge personalizzato e sezione eventi.',
    contatto: DECK_TODO
  },
  slides: [
    slide({
      id: 'cover',
      kind: 'cover',
      title: 'La mappa perfetta per {{ente}}',
      body: 'Costruita da Speaqi. Distribuita insieme a voi, fino a 50 lingue.',
      hint: 'Il titolo porta il nome dell’ente. Come foto scegli una schermata della mappa o la foto più rappresentativa della destinazione, se ce n’è una.'
    }),
    slide({
      id: 'territorio',
      kind: 'cards',
      title: 'Tutto {{destinazione}} in una mappa sola',
      items: [
        { title: 'Luoghi da vedere', text: '[DA VERIFICARE: quanti] luoghi, dai monumenti ai panorami.' },
        { title: 'Itinerari', text: '[DA VERIFICARE: quanti] itinerari, a piedi, a tema, di mezza giornata o più giorni.' },
        { title: 'Strutture e servizi', text: '[DA VERIFICARE: quanti] fra dove dormire, dove mangiare e servizi utili.' }
      ],
      hint: 'Metti i tre numeri del territorio solo se stanno nei materiali o nei luoghi approvati. Se un numero non è noto, sostituisci il segnaposto con una frase qualitativa sulla destinazione, senza cifre.'
    }),
    slide({
      id: 'problema',
      kind: 'statement',
      title: 'Oggi il visitatore scopre {{destinazione}} a pezzi.',
      body: 'Google Maps, Tripadvisor, Instagram, TikTok, brochure, blog e il sito dell’ente: sette fonti diverse, in lingue diverse, con informazioni che non si parlano. Nessuna parla per voi.',
      hint: 'Puoi adattare l’elenco delle fonti a quelle che i materiali citano per questa destinazione. Chiudi sempre con «Nessuna parla per voi».'
    }),
    slide({
      id: 'soluzione',
      kind: 'statement',
      title: 'Una mappa. Tutto il territorio. Ogni lingua.',
      body: 'Speaqi crea la guida digitale ufficiale di {{destinazione}}: la voce della destinazione, nella lingua di chi la visita. Si apre da un link o da un QR Code, senza app.',
      hint: 'Mantieni il titolo. Nel corpo nessuna funzione in più.'
    }),
    slide({
      id: 'prova',
      kind: 'cards',
      title: 'Prima del resto, provate una mappa vera',
      body: 'Aprite il link o scansionate il QR. È gratis, senza app.',
      items: [
        { title: 'Napoli', text: 'guides.speaqi.com/napoli' },
        { title: 'Roma', text: 'guides.speaqi.com/roma' },
        { title: 'E altre', text: 'guides.speaqi.com' }
      ],
      hint: 'Lascia le mappe reali di Speaqi così come sono: sono la prova. Non inventare altri link.'
    }),
    slide({
      id: 'contenuti',
      kind: 'cards',
      title: 'Tutto quello che il visitatore cerca, in un posto solo',
      items: [
        { title: 'Luoghi da vedere', text: 'Monumenti, musei, piazze, panorami.' },
        { title: 'Itinerari', text: 'A piedi, a tema, di mezza giornata o più giorni.' },
        { title: 'Esperienze', text: 'Cultura, natura, eventi, enogastronomia.' },
        { title: 'Dove dormire', text: 'Hotel, B&B, agriturismi.' },
        { title: 'Dove mangiare', text: 'Ristoranti, trattorie, prodotti tipici.' },
        { title: 'Servizi utili', text: 'Infopoint, trasporti, parcheggi.' }
      ],
      note: 'Ogni luogo ha la sua audio guida e può avere un video girato sul posto.',
      hint: 'Mantieni le sei categorie. Negli esempi puoi citare luoghi o esperienze di questa destinazione solo se compaiono nei materiali.'
    }),
    slide({
      id: 'lingue',
      kind: 'statement',
      title: 'Fino a 50 lingue. Le prime 10 sono incluse, con audio.',
      body: 'Le dieci lingue si scelgono sui mercati di {{destinazione}}: per esempio italiano, inglese, spagnolo, francese, tedesco, portoghese, russo, giapponese, cinese e polacco. Le altre, fino a 50, su richiesta.',
      hint: 'Se i materiali dicono da quali paesi arrivano i visitatori, scegli le dieci lingue su quelli e togli «per esempio». Altrimenti lascia l’elenco d’esempio.'
    }),
    slide({
      id: 'visitatore',
      kind: 'steps',
      title: 'Dal QR alla visita, in quattro passi',
      items: [
        { title: 'Scansiona', text: 'Un QR Code o un link. Nessuna app da scaricare.' },
        { title: 'È già nella sua lingua', text: 'La mappa si apre nella lingua del telefono. Nessuna scelta da fare.' },
        { title: 'Esplora', text: '«Sono qui» mostra cosa c’è intorno, a due passi.' },
        { title: 'Chiede all’AI Concierge', text: 'Risponde solo con le informazioni approvate dall’ente.' }
      ],
      hint: 'Mantieni i quattro passi così come sono.'
    }),
    slide({
      id: 'metodo',
      kind: 'steps',
      title: 'La custodiamo noi. Voi la provate.',
      items: [
        { title: 'Analisi', text: 'Partiamo dai dati che avete già, a cominciare dal vostro sito.' },
        { title: 'Costruzione', text: 'La costruiamo noi: testi, lingue e audio.' },
        { title: 'Approvazione', text: 'Voi la provate e la approvate prima di pubblicare.' },
        { title: 'Pubblicazione', text: 'La mappa va online, con i QR Code pronti.' },
        { title: 'Aggiornamento', text: 'La custodiamo e la manteniamo noi, nel tempo.' }
      ],
      hint: 'Non promettere tempi di consegna. Non parlare di white label.'
    }),
    slide({
      id: 'prezzo',
      kind: 'cards',
      title: 'La mappa è gratuita.',
      items: [
        { title: '500 punti di interesse', text: 'I luoghi del territorio, ognuno con la sua scheda.' },
        { title: '10 lingue, con audio', text: 'Scelte sui mercati della destinazione.' },
        { title: '10 itinerari', text: 'Pronti da seguire, sulla mappa.' },
        { title: 'AI Concierge', text: 'Risponde solo con le informazioni approvate.' },
        { title: 'QR Code pronti', text: 'Per i luoghi, le mappe e i materiali.' },
        { title: 'Area riservata', text: 'Con le statistiche degli accessi.' }
      ],
      note: 'In cambio: {{prezzo}}',
      hint: 'Non cambiare le condizioni nella nota: usa solo quelle indicate dall’utente. Non aggiungere il video di presentazione fra gli inclusi finché non è confermato. Nessun importo in euro.'
    }),
    slide({
      id: 'area-riservata',
      kind: 'cards',
      title: 'Seguite tutto, in chiaro',
      items: [
        { title: 'Statistiche degli accessi', text: 'Sempre visibili nell’area riservata di {{ente}}.' },
        { title: 'Report condiviso', text: 'Lo stesso report lo vediamo noi e lo vedete voi.' },
        { title: 'Regole scritte', text: 'Che cosa è un «accesso» lo scriviamo nel contratto.' }
      ],
      hint: 'Mantieni le tre voci. Non mostrare numeri di accessi inventati.'
    }),
    slide({
      id: 'demo',
      kind: 'closing',
      title: 'Guardate la mappa di {{ente}}',
      body: 'Provate la demo, definiamo insieme le soglie e partiamo con la mappa. {{contatto}}',
      hint: 'Chiusura breve. Non inventare link della demo o contatti: usa solo quelli indicati.'
    })
  ]
}

/** Base Tourism per aziende: stessi strumenti, senza impegni di partnership impliciti. */
export const TOURISM_COMPANY_TEMPLATE: DeckTemplate = {
  version: 1,
  vars: { contatto: DECK_TODO, prezzo: 'Importi, durata, eventuali servizi e condizioni sono indicati nel preventivo e nel contratto collegati.' },
  slides: [
    slide({ id: 'cover', kind: 'cover', title: '{{ente}}, nella lingua di chi vi sceglie', body: 'Una proposta Speaqi Tourism per {{destinazione}}.', hint: 'Personalizza la promessa sul destinatario e sul suo pubblico. Non promettere risultati numerici.' }),
    slide({ id: 'contesto', kind: 'statement', title: 'Partiamo dall’esperienza dei vostri ospiti', body: '[DA VERIFICARE] Il bisogno emerso dal brief: informazioni, accoglienza, scoperta del territorio o assistenza ai visitatori.', hint: 'Usa il bisogno specifico del cliente e la sua fonte; evita affermazioni negative non verificate sul sito o sul servizio attuale.' }),
    slide({ id: 'obiettivo', kind: 'cards', title: 'Le informazioni giuste, prima e durante la visita', items: [
      { title: 'Prima dell’arrivo', text: 'Presentare l’offerta e aiutare il visitatore a orientarsi.' },
      { title: 'Durante l’esperienza', text: 'Rendere accessibili contenuti e indicazioni nella sua lingua.' },
      { title: 'Per il vostro team', text: 'Aggiornare le informazioni da una base condivisa.' }
    ], hint: 'Adatta i benefici all’attività e al pubblico citati nei materiali. Nessuna previsione economica senza dati.' }),
    slide({ id: 'soluzione', kind: 'statement', title: 'Una base di conoscenza. Più punti di contatto.', body: 'Le informazioni approvate di {{ente}} alimentano pagine web, QR dinamici, testi, audio multilingua e AI Concierge.', hint: 'Spiega il caso d’uso concreto; non aggiungere integrazioni, prenotazioni o funzionalità non confermate.' }),
    slide({ id: 'esperienza', kind: 'steps', title: 'Dal primo accesso alle risposte utili', items: [
      { title: 'Accede', text: 'Da un link o da un QR Code, senza scaricare un’app.' },
      { title: 'Scopre', text: 'Consulta le informazioni del progetto in più lingue.' },
      { title: 'Ascolta', text: 'Usa i contenuti audio multilingua.' },
      { title: 'Chiede', text: 'L’AI Concierge risponde sulla conoscenza approvata.' }
    ], hint: 'Personalizza i punti di accesso su quelli concordati per il cliente.' }),
    slide({ id: 'perimetro', kind: 'cards', title: 'Cosa attiviamo per il vostro progetto', items: [
      { title: 'Contenuti', text: '[DA VERIFICARE] Materiali iniziali, argomenti e responsabilità editoriali.' },
      { title: 'Lingue e audio', text: '[DA VERIFICARE] Lingue iniziali in base al pubblico e ai materiali.' },
      { title: 'Distribuzione', text: '[DA VERIFICARE] Link, QR e canali effettivamente concordati.' }
    ], note: 'Tutta la piattaforma è inclusa nel piano per progetto. La produzione video AI è separata, in minuti.', hint: 'Non inventare quantità, lingue, impegni di accessi o deliverable. Usa solo il perimetro concordato.' }),
    slide({ id: 'prova', kind: 'cards', title: 'Provate un’esperienza Speaqi reale', body: 'Esempi del prodotto, da esplorare prima di definire il vostro progetto.', items: [
      { title: 'Napoli', text: 'guides.speaqi.com/napoli' }, { title: 'Roma', text: 'guides.speaqi.com/roma' }
    ], hint: 'Sono demo del prodotto, non casi studio o risultati commerciali del settore del destinatario.' }),
    slide({ id: 'metodo', kind: 'steps', title: 'Prepariamo il progetto e lo provate quando è pronto', items: [
      { title: 'Costruzione', text: 'Raccogliamo e organizziamo i contenuti del progetto.' },
      { title: 'Validazione', text: 'Speaqi verifica il progetto prima dell’attivazione pubblica.' },
      { title: 'Prova', text: 'Trial pubblico di 30 giorni, attivato manualmente dopo la validazione.' },
      { title: 'Attivazione', text: 'Confermiamo l’abbonamento o l’accordo commerciale del progetto.' }
    ], hint: 'La durata del trial viene dal modello commerciale Speaqi. Non promettere tempi di produzione.' }),
    slide({ id: 'responsabilita', kind: 'cards', title: 'Un referente e un percorso condiviso', items: [
      { title: 'Il vostro team', text: 'Fornisce i materiali e approva i contenuti prima della pubblicazione.' },
      { title: 'Speaqi', text: '[DA VERIFICARE] Servizi operativi, consegne e assistenza compresi nell’offerta.' },
      { title: 'Verifica', text: '[DA VERIFICARE] Referenti, tempi e criteri di approvazione concordati.' }
    ], hint: 'Non dedurre assistenza gestita, aggiornamenti editoriali o SLA dal solo abbonamento.' }),
    slide({ id: 'condizioni', kind: 'statement', title: 'Perimetro e condizioni, definiti prima di partire', body: '{{prezzo}}', note: 'Un progetto ha il proprio accordo e il proprio ciclo di vita.', hint: 'Usa il preventivo per i prezzi. Non applicare automaticamente gratuità, soglie di accessi o condizioni delle partnership destinazioni.' }),
    slide({ id: 'prossimi-passi', kind: 'steps', title: 'Confermiamo il progetto più utile per voi', items: [
      { title: 'Allineamento', text: 'Rivediamo obiettivi, perimetro e materiali.' },
      { title: 'Proposta', text: 'Confermiamo preventivo e contratto del progetto.' },
      { title: 'Avvio', text: 'Concordiamo il primo passaggio operativo.' }
    ], hint: 'Aggiungi una demo personalizzata solo se il suo link esiste nei materiali.' }),
    slide({ id: 'chiusura', kind: 'closing', title: 'Prepariamo il prossimo passo per {{ente}}', body: '{{contatto}}', hint: 'Solo il contatto reale inserito dall’utente.' })
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
  return { version: 1, vars, slides, quote_template: normalizeQuoteTemplate(r.quote_template, 'tourism') }
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
