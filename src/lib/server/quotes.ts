import { randomBytes, randomUUID } from 'node:crypto'
import {
  SUBSCRIPTION_PAYMENT_TERMS,
  SUBSCRIPTION_PAYMENT_TERMS_NOTE,
} from '@/lib/speaqi-quote-packages'
import type {
  QuoteBillingInterval,
  QuoteLineItem,
  QuotePaymentMethod,
  QuotePaymentTermsMode,
  QuoteStatus,
} from '@/types'

export { DEFAULT_BANK_TRANSFER_INSTRUCTIONS, DEFAULT_CONTRACT_TERMS } from '@/lib/quote-defaults'

const VALID_STATUSES = new Set<QuoteStatus>(['draft', 'sent', 'accepted', 'paid', 'cancelled'])
const VALID_PAYMENT_METHODS = new Set<QuotePaymentMethod>(['bank_transfer', 'stripe', 'both'])
const VALID_PAYMENT_TERMS_MODES = new Set<QuotePaymentTermsMode>(['percent', 'manual'])

export function normalizeText(value: unknown) {
  const normalized = String(value || '').trim()
  return normalized || null
}

export function normalizeNumber(value: unknown, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function normalizeStatus(value: unknown, fallback: QuoteStatus = 'sent'): QuoteStatus {
  const normalized = String(value || '').trim() as QuoteStatus
  return VALID_STATUSES.has(normalized) ? normalized : fallback
}

export function normalizePaymentMethod(
  value: unknown,
  fallback: QuotePaymentMethod = 'bank_transfer'
): QuotePaymentMethod {
  const normalized = String(value || '').trim() as QuotePaymentMethod
  return VALID_PAYMENT_METHODS.has(normalized) ? normalized : fallback
}

export function normalizePaymentTermsMode(
  value: unknown,
  fallback: QuotePaymentTermsMode = 'percent'
): QuotePaymentTermsMode {
  const normalized = String(value || '').trim() as QuotePaymentTermsMode
  return VALID_PAYMENT_TERMS_MODES.has(normalized) ? normalized : fallback
}

export function normalizeBillingInterval(
  value: unknown,
  fallback: QuoteBillingInterval = 'one_time'
): QuoteBillingInterval {
  const normalized = String(value || '').trim()
  if (normalized === 'year' || normalized === 'one_time') return normalized
  return fallback
}

/**
 * Un abbonamento annuale si paga solo con carta e per intero: qualunque cosa
 * arrivi dal costruttore, metodo, acconto e condizioni vengono riallineati
 * qui, cosi' non esiste un abbonamento "a bonifico con acconto 30%" che
 * Stripe non saprebbe rinnovare.
 */
export function applyBillingRules<
  T extends {
    billing_interval?: unknown
    payment_method?: unknown
    payment_terms_mode?: unknown
    deposit_percent?: unknown
    deposit_manual_amount?: unknown
    payment_terms_note?: unknown
  },
>(body: T): T & { billing_interval: QuoteBillingInterval } {
  const billingInterval = normalizeBillingInterval(body.billing_interval)
  if (billingInterval !== 'year') return { ...body, billing_interval: billingInterval }
  return {
    ...body,
    ...SUBSCRIPTION_PAYMENT_TERMS,
    payment_terms_note: normalizeText(body.payment_terms_note) || SUBSCRIPTION_PAYMENT_TERMS_NOTE,
    billing_interval: billingInterval,
  }
}

export function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function normalizeQuoteItems(value: unknown): QuoteLineItem[] {
  if (!Array.isArray(value)) return []

  const items: QuoteLineItem[] = []

  value
    .map((item) => {
      const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
      const description = normalizeText(row.description)
      if (!description) return null

      const quantity = Math.max(0, normalizeNumber(row.quantity, 1))
      const unitPrice = Math.max(0, normalizeNumber(row.unit_price, 0))
      const listUnitRaw = normalizeNumber(row.list_unit_price, 0)
      const listUnitPrice = listUnitRaw > 0 ? roundMoney(listUnitRaw) : null
      const lineTotal = roundMoney(quantity * unitPrice)
      const choiceGroupId = normalizeText(row.choice_group_id)

      return {
        id: normalizeText(row.id) || randomUUID(),
        description,
        details: normalizeText(row.details),
        quantity,
        unit_price: roundMoney(unitPrice),
        ...(listUnitPrice ? { list_unit_price: listUnitPrice } : {}),
        line_total: lineTotal,
        ...(choiceGroupId
          ? {
              choice_group_id: choiceGroupId,
              choice_group_label: normalizeText(row.choice_group_label),
              selected: row.selected === true,
            }
          : {}),
      }
    })
    .forEach((item) => {
      if (item) items.push(item)
    })

  const chosenByGroup = new Map<string, string | undefined>()
  for (const item of items) {
    if (!item.choice_group_id || chosenByGroup.has(item.choice_group_id)) continue
    const group = items.filter((candidate) => candidate.choice_group_id === item.choice_group_id)
    chosenByGroup.set(item.choice_group_id, group.find((candidate) => candidate.selected)?.id || group[0]?.id)
  }
  return items.map((item) =>
    item.choice_group_id
      ? { ...item, selected: item.id === chosenByGroup.get(item.choice_group_id) }
      : item
  )
}

export function isQuoteItemIncluded(item: QuoteLineItem) {
  return !item.choice_group_id || item.selected === true
}

export function calculateQuoteTotals(
  items: QuoteLineItem[],
  options?: {
    discountAmount?: number
    taxRate?: number
    paymentTermsMode?: QuotePaymentTermsMode
    depositPercent?: number
    depositManualAmount?: number
  }
) {
  const subtotalAmount = roundMoney(
    items.reduce(
      (total, item) =>
        total +
        (isQuoteItemIncluded(item)
          ? Math.max(0, Number(item.line_total ?? item.quantity * item.unit_price))
          : 0),
      0
    )
  )
  const discountAmount = roundMoney(Math.min(Math.max(0, options?.discountAmount ?? 0), subtotalAmount))
  const taxableAmount = Math.max(0, subtotalAmount - discountAmount)
  const taxRate = roundMoney(Math.max(0, options?.taxRate ?? 22))
  const taxAmount = roundMoney(taxableAmount * (taxRate / 100))
  const totalAmount = roundMoney(taxableAmount + taxAmount)
  const paymentTermsMode = normalizePaymentTermsMode(options?.paymentTermsMode, 'percent')
  const requestedPercent = roundMoney(Math.max(0, Math.min(100, options?.depositPercent ?? 30)))
  const requestedManualNet = roundMoney(Math.max(0, options?.depositManualAmount ?? 0))
  const clampedManualNet = roundMoney(Math.min(requestedManualNet, taxableAmount))
  const depositNet =
    paymentTermsMode === 'manual'
      ? clampedManualNet
      : roundMoney(taxableAmount * (requestedPercent / 100))
  const depositPercent =
    paymentTermsMode === 'manual'
      ? taxableAmount > 0
        ? roundMoney((depositNet / taxableAmount) * 100)
        : 0
      : requestedPercent
  const depositAmount = roundMoney(depositNet + depositNet * (taxRate / 100))
  const balanceAmount = roundMoney(Math.max(0, totalAmount - depositAmount))

  return {
    subtotal_amount: subtotalAmount,
    discount_amount: discountAmount,
    tax_rate: taxRate,
    tax_amount: taxAmount,
    total_amount: totalAmount,
    payment_terms_mode: paymentTermsMode,
    deposit_percent: depositPercent,
    deposit_manual_amount: paymentTermsMode === 'manual' ? depositNet : null,
    deposit_amount: depositAmount,
    balance_amount: balanceAmount,
  }
}

function moneyCents(value: unknown, fallback: number) {
  return Math.round(normalizeNumber(value, fallback) * 100)
}

/** Cio' che di una riga conta per il prezzo: l'id no, perche' una riga senza id ne riceve uno a caso. */
function itemFingerprint(items: unknown) {
  return JSON.stringify(
    normalizeQuoteItems(items).map((item) => [
      item.description,
      item.details,
      item.quantity,
      item.unit_price,
      item.list_unit_price ?? null,
      item.choice_group_id ?? null,
      item.selected ?? null,
    ])
  )
}

/**
 * Su un preventivo gia' accettato o firmato, i campi economici che il corpo
 * di un PATCH chiede di cambiare. Si confrontano solo i campi presenti nel
 * corpo, normalizzati come quando si salvano: chi rimanda il preventivo
 * com'era (per segnarlo pagato, o per correggere i dati di fatturazione)
 * non viene fermato.
 */
export function signedQuoteEconomicChanges(current: Record<string, any>, body: Record<string, unknown>) {
  const changed: string[] = []
  if (body.items !== undefined && itemFingerprint(body.items) !== itemFingerprint(current.items)) {
    changed.push('righe')
  }
  if (body.discount_amount !== undefined && moneyCents(body.discount_amount, 0) !== moneyCents(current.discount_amount, 0)) {
    changed.push('sconto')
  }
  if (body.tax_rate !== undefined && moneyCents(body.tax_rate, 22) !== moneyCents(current.tax_rate, 22)) {
    changed.push('IVA')
  }
  const currentMode = normalizePaymentTermsMode(current.payment_terms_mode, 'percent')
  const nextMode =
    body.payment_terms_mode !== undefined ? normalizePaymentTermsMode(body.payment_terms_mode, 'percent') : currentMode
  if (nextMode !== currentMode) {
    changed.push('condizioni di pagamento')
  } else if (
    nextMode === 'percent' &&
    body.deposit_percent !== undefined &&
    moneyCents(body.deposit_percent, 30) !== moneyCents(current.deposit_percent, 30)
  ) {
    changed.push('acconto')
  } else if (
    nextMode === 'manual' &&
    body.deposit_manual_amount !== undefined &&
    moneyCents(body.deposit_manual_amount, 0) !== moneyCents(current.deposit_manual_amount, 0)
  ) {
    changed.push('acconto')
  }
  if (body.currency !== undefined && currencyCode(body.currency as string) !== currencyCode(current.currency)) {
    changed.push('valuta')
  }
  if (
    body.billing_interval !== undefined &&
    normalizeBillingInterval(body.billing_interval) !== normalizeBillingInterval(current.billing_interval)
  ) {
    changed.push('tipo di pagamento (una tantum o annuale)')
  }
  return changed
}

export function buildQuoteNumber() {
  const now = new Date()
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('')
  return `PREV-${stamp}-${randomBytes(3).toString('hex').toUpperCase()}`
}

export function buildPublicToken() {
  return randomBytes(18).toString('hex')
}

export function buildQuoteAcceptanceToken() {
  return randomBytes(24).toString('hex')
}

export function publicQuoteUrl(origin: string, token: string) {
  return `${origin.replace(/\/$/, '')}/preventivo?id=${encodeURIComponent(token)}`
}

export function quoteAcceptanceUrl(origin: string, publicToken: string, acceptanceToken: string) {
  const base = publicQuoteUrl(origin, publicToken)
  return `${base}&accept=${encodeURIComponent(acceptanceToken)}`
}

export function currencyCode(value?: string | null) {
  const normalized = String(value || 'EUR').trim().toUpperCase()
  return /^[A-Z]{3}$/.test(normalized) ? normalized : 'EUR'
}
