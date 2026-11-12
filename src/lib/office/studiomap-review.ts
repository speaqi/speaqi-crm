/**
 * La coda «Da decidere» di StudioMap su Telegram: «dubbi Marsiglia» manda una scheda per
 * messaggio con **Tieni** e **Togli**, le stesse due risposte della coda nella dashboard.
 * Un tocco vale come il clic in pagina (chat del titolare, verificata dal webhook).
 *
 * Mappa e scheda viaggiano nel pulsante come impronte corte decise da StudioMap (8 e 12
 * caratteri esadecimali): un pulsante porta al massimo 64 byte e il CRM non salva niente.
 * Puro e testato: niente rete.
 */
import type { TelegramKeyboard } from './telegram-actions'

export type ReviewAction =
  | { kind: 'review_decide'; map: string; item: string; decision: 'keep' | 'remove' }
  | { kind: 'review_more'; map: string; offset: number }
  | { kind: 'review_done' }

export interface ReviewCard {
  item: string
  name: string
  area: string
  category: string
  kind: string
  reasons: string[]
  has_text: boolean
  itineraries: number
  maps_url?: string
  image_url?: string
}

export interface ReviewPage {
  map: string
  city: string
  total: number
  next_offset: number | null
  link: string
  cards: ReviewCard[]
}

/** Quante schede per giro: abbastanza per svuotare la coda, poche da non riempire la chat. */
export const REVIEW_PAGE_SIZE = 5

const MAP = '[0-9a-f]{8}'
const ITEM = '[0-9a-f]{12}'

export const reviewDecideData = (map: string, item: string, decision: 'keep' | 'remove') =>
  `r:${decision === 'keep' ? 'k' : 'x'}:${map}:${item}`
export const reviewMoreData = (map: string, offset: number) => `r:n:${map}:${offset}`
export const REVIEW_DONE_DATA = 'r:done'

/** Solo le forme note: qualunque altro dato si ignora. */
export function parseReviewAction(data: unknown): ReviewAction | null {
  const value = typeof data === 'string' ? data.trim().toLowerCase() : ''
  if (value === REVIEW_DONE_DATA) return { kind: 'review_done' }
  const decide = new RegExp(`^r:([kx]):(${MAP}):(${ITEM})$`).exec(value)
  if (decide) return { kind: 'review_decide', map: decide[2], item: decide[3], decision: decide[1] === 'k' ? 'keep' : 'remove' }
  const more = new RegExp(`^r:n:(${MAP}):(\\d{1,4})$`).exec(value)
  if (more) return { kind: 'review_more', map: more[1], offset: Number(more[2]) }
  return null
}

/**
 * «dubbi», «dubbi Marsiglia», «/dubbi Marsiglia», «da decidere Marsiglia». La città è il
 * resto del messaggio; senza, si elencano le mappe con decisioni aperte.
 */
export function parseReviewCommand(text: string): { city: string | null } | null {
  const match = /^\/?(?:dubbi|da\s+decidere)(?:@\w+)?(?:\s+(?:di|a|per|su)\b)?\s*[:,-]?\s*(.*)$/i.exec(String(text || '').trim())
  if (!match) return null
  const city = match[1].replace(/[?.!]+$/, '').trim()
  return { city: city ? city.slice(0, 80) : null }
}

/** Il messaggio di una scheda: chi è, perché è in dubbio, cosa succede togliendola. */
export function reviewCardMessage(card: ReviewCard, map: string): { text: string; keyboard: TelegramKeyboard } {
  const lines = [
    `${card.name} · ${card.area}${card.category ? ` (${card.category})` : ''}`,
    card.kind,
    ...card.reasons.map((r) => `– ${r}`),
    card.itineraries ? `Togliendola esce da ${card.itineraries} ${card.itineraries === 1 ? 'itinerario' : 'itinerari'}.` : '',
    card.has_text ? 'Ha già un testo.' : '',
  ].filter(Boolean)
  const keyboard: TelegramKeyboard = [[
    { text: '✅ Tieni', callback_data: reviewDecideData(map, card.item, 'keep') },
    { text: '🗑 Togli', callback_data: reviewDecideData(map, card.item, 'remove') },
  ]]
  if (card.maps_url) keyboard.push([{ text: 'Apri su Google Maps', url: card.maps_url }])
  return { text: lines.join('\n').slice(0, 1000), keyboard }
}

/** In testa al giro: quante decisioni aspettano e cosa fanno i pulsanti. */
export function reviewIntro(page: Pick<ReviewPage, 'city' | 'total' | 'cards'>, offset: number): string {
  if (!page.total) return `${page.city}: niente da decidere.`
  const from = offset + 1
  const to = offset + page.cards.length
  return `${page.city}: ${page.total} ${page.total === 1 ? 'scheda da decidere' : 'schede da decidere'}. Eccone ${from === to ? `la ${from}` : `${from}-${to}`}. ` +
    'Tieni = resta in mappa e nessun agente la ripropone; Togli = esce dalla mappa (si recupera dalla cronologia di StudioMap).'
}

/**
 * In fondo al giro: le prossime, o la coda in StudioMap. «Le prossime» riparte dalla testa
 * della coda: le schede decise ne sono uscite, quelle saltate tornano prima delle altre.
 * Con un offset le saltate si perderebbero, e le decise sposterebbero tutto in avanti.
 */
export function reviewFooter(page: ReviewPage): { text: string; keyboard: TelegramKeyboard } | null {
  const keyboard: TelegramKeyboard = []
  if (page.next_offset !== null) keyboard.push([{ text: 'Le prossime →', callback_data: reviewMoreData(page.map, 0) }])
  if (page.link.startsWith('https://')) keyboard.push([{ text: 'Apri la mappa in StudioMap', url: page.link }])
  if (!keyboard.length) return null
  return {
    text: page.next_offset !== null
      ? `Dopo queste ne restano ${page.total - page.next_offset}. Quando hai deciso, «Le prossime» le porta (le saltate tornano in testa).`
      : 'Sono le ultime.',
    keyboard,
  }
}

/** «dubbi» senza città: dove ci sono decisioni aperte. */
export function reviewMapsList(maps: Array<{ city: string; total: number }>): string {
  if (!maps.length) return 'Nessuna decisione aperta nelle mappe di StudioMap.'
  return ['Decisioni aperte in StudioMap:', ...maps.map((m) => `– ${m.city}: ${m.total}`), '', `Scrivi «dubbi ${maps[0].city}» per cominciare.`].join('\n')
}

/** L'esito di un tocco, per la rotellina del pulsante e il bottone che resta al posto dei due. */
export function reviewOutcome(result: { status: string; decision?: string; name?: string; remaining?: number }): { toast: string; label: string; done: boolean } {
  if (result.status === 'done') {
    const kept = result.decision === 'keep'
    const left = typeof result.remaining === 'number' ? ` Ne restano ${result.remaining}.` : ''
    return { toast: `${kept ? 'Tenuta' : 'Tolta'}: ${result.name ?? ''}.${left}`.slice(0, 190), label: kept ? '✅ Tenuta' : '🗑 Tolta', done: true }
  }
  if (result.status === 'already') return { toast: 'Già decisa (anche dalla dashboard): niente cambiato.', label: '✔️ Già decisa', done: true }
  return { toast: 'Scheda o mappa non trovata: forse cambiata nel frattempo.', label: '— Non trovata', done: true }
}
