/**
 * Soldi da ricevere (/incassi): un'area personale, fuori da Speaqi.
 * Qui solo la logica pura, condivisa fra la pagina e la rotta.
 */

export type Receivable = {
  id: string
  name: string
  amount: number
  collected_at: string | null
  created_at: string
  updated_at: string
}

export const RECEIVABLE_NAME_MAX = 120
export const RECEIVABLE_AMOUNT_MAX = 9_999_999_999.99

export function normalizeReceivableName(value: unknown) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, RECEIVABLE_NAME_MAX)
}

/**
 * Legge un importo scritto come lo si scrive: "1.250,50", "1250.5", "€ 300",
 * "1,250.50". Restituisce null per tutto cio' che non e' un importo positivo.
 *
 * Con un solo separatore la regola e': la virgola e' sempre decimale; il punto
 * e' decimale solo se seguito da una o due cifre ("12.5"), altrimenti e' delle
 * migliaia ("1.250"). Con entrambi, il separatore che viene per ultimo e' quello
 * decimale.
 */
export function parseReceivableAmount(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 && value <= RECEIVABLE_AMOUNT_MAX
      ? Math.round(value * 100) / 100
      : null
  }

  let text = String(value ?? '').replace(/[€\s']/g, '').replace(/eur$/i, '')
  if (!text || !/^[\d.,]+$/.test(text)) return null

  const lastComma = text.lastIndexOf(',')
  const lastDot = text.lastIndexOf('.')

  if (lastComma >= 0 && lastDot >= 0) {
    const decimal = lastComma > lastDot ? ',' : '.'
    const thousands = decimal === ',' ? '.' : ','
    text = text.split(thousands).join('')
    if (text.split(decimal).length > 2) return null
    text = text.replace(decimal, '.')
  } else if (lastComma >= 0) {
    if (text.split(',').length > 2) return null
    text = text.replace(',', '.')
  } else if (lastDot >= 0) {
    const parts = text.split('.')
    const decimalLike = parts.length === 2 && parts[1].length > 0 && parts[1].length <= 2
    text = decimalLike ? text : parts.join('')
  }

  if (!/^\d+(\.\d+)?$/.test(text)) return null
  const amount = Math.round(Number(text) * 100) / 100
  return Number.isFinite(amount) && amount > 0 && amount <= RECEIVABLE_AMOUNT_MAX ? amount : null
}

const euro = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' })

export function formatEuro(amount: number) {
  return euro.format(Number(amount) || 0)
}

/** Somme in centesimi: sommare float di euro accumula errori di arrotondamento. */
export function summarizeReceivables(items: Receivable[]) {
  let pendingCents = 0
  let collectedCents = 0
  let pendingCount = 0
  let collectedCount = 0

  for (const item of items) {
    const cents = Math.round(Number(item.amount) * 100)
    if (item.collected_at) {
      collectedCents += cents
      collectedCount += 1
    } else {
      pendingCents += cents
      pendingCount += 1
    }
  }

  return {
    pending: pendingCents / 100,
    collected: collectedCents / 100,
    pendingCount,
    collectedCount,
  }
}

/**
 * Da incassare: i piu' vecchi in cima, sono quelli da sollecitare.
 * Incassati: gli ultimi arrivati in cima. A parita' si scende sull'id, cosi'
 * due righe uguali non si scambiano di posto a ogni render.
 */
export function sortReceivables(items: Receivable[]) {
  const pending = items
    .filter((item) => !item.collected_at)
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
  const collected = items
    .filter((item) => item.collected_at)
    .sort((a, b) => String(b.collected_at).localeCompare(String(a.collected_at)) || a.id.localeCompare(b.id))
  return { pending, collected }
}
