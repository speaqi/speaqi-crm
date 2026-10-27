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

/** Confronto economico stabile: ignora id/line_total generati e l'ordine delle chiavi. */
function economicItemSignature(item: QuoteLineItem) {
  return {
    description: item.description,
    details: item.details || null,
    quantity: item.quantity,
    unit_price: roundMoney(item.unit_price),
    list_unit_price: item.list_unit_price ? roundMoney(item.list_unit_price) : null,
    choice_group_id: item.choice_group_id || null,
    choice_group_label: item.choice_group_label || null,
    selected: item.choice_group_id ? item.selected === true : undefined,
  }
}

function cents(value: unknown) {
  return Math.round(normalizeNumber(value, 0) * 100)
}

function sameMoney(left: unknown, right: unknown) {
  return cents(left) === cents(right)
}

const SIGNED_ECONOMIC_LABELS: Record<string, string> = {
  items: 'righe offerta',
  discount_amount: 'sconto',
  tax_rate: 'IVA',
  payment_terms_mode: 'modalità pagamento',
  deposit_percent: 'acconto',
  deposit_manual_amount: 'acconto manuale',
  currency: 'valuta',
  billing_interval: 'periodicità',
  payment_method: 'metodo di pagamento',
  valid_until: 'validità',
  subtotal_amount: 'subtotale',
  tax_amount: 'importo IVA',
  total_amount: 'totale',
  deposit_amount: 'importo acconto',
  balance_amount: 'saldo',
}

/**
 * Campi economici cambiati dopo la firma. Il contratto accettato vale per
 * l'offerta firmata: cambiarne righe, sconto, IVA, valuta o periodicità
 * significa proporre condizioni diverse, che richiedono un nuovo preventivo.
 */
export function signedQuoteEconomicChanges(
  body: Record<string, unknown>,
  current: Record<string, unknown>
): string[] {
  const changed: string[] = []

  if (body.items !== undefined) {
    const nextItems = normalizeQuoteItems(body.items).map(economicItemSignature)
    const currentItems = normalizeQuoteItems(current.items).map(economicItemSignature)
    if (JSON.stringify(nextItems) !== JSON.stringify(currentItems)) changed.push('items')
  }

  if (body.discount_amount !== undefined && !sameMoney(body.discount_amount, current.discount_amount)) {
    changed.push('discount_amount')
  }
  if (body.tax_rate !== undefined && !sameMoney(normalizeNumber(body.tax_rate, 22), current.tax_rate)) {
    changed.push('tax_rate')
  }
  if (
    body.payment_terms_mode !== undefined &&
    normalizePaymentTermsMode(body.payment_terms_mode, 'percent') !==
      normalizePaymentTermsMode(current.payment_terms_mode, 'percent')
  ) {
    changed.push('payment_terms_mode')
  }
  if (
    body.deposit_percent !== undefined &&
    !sameMoney(normalizeNumber(body.deposit_percent, 30), current.deposit_percent)
  ) {
    changed.push('deposit_percent')
  }
  if (
    body.deposit_manual_amount !== undefined &&
    !sameMoney(body.deposit_manual_amount, current.deposit_manual_amount)
  ) {
    changed.push('deposit_manual_amount')
  }
  if (body.currency !== undefined && currencyCode(body.currency as string) !== currencyCode(current.currency as string)) {
    changed.push('currency')
  }
  if (
    body.billing_interval !== undefined &&
    normalizeBillingInterval(body.billing_interval) !== normalizeBillingInterval(current.billing_interval)
  ) {
    changed.push('billing_interval')
  }
  if (
    body.payment_method !== undefined &&
    normalizePaymentMethod(body.payment_method) !== normalizePaymentMethod(current.payment_method)
  ) {
    changed.push('payment_method')
  }
  if (
    body.valid_until !== undefined &&
    String(normalizeText(body.valid_until) || '') !== String(normalizeText(current.valid_until) || '')
  ) {
    changed.push('valid_until')
  }

  for (const field of ['subtotal_amount', 'tax_amount', 'total_amount', 'deposit_amount', 'balance_amount']) {
    if (body[field] !== undefined && !sameMoney(body[field], current[field])) changed.push(field)
  }

  return changed
}

export function signedQuoteEconomicChangeMessage(changed: string[]) {
  const labels = changed.map((field) => SIGNED_ECONOMIC_LABELS[field] || field)
  return `Il contratto è già stato firmato: non si possono cambiare ${labels.join(', ')}. Duplica il preventivo per proporre nuove condizioni.`
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

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

/**
 * La firma vale per l'offerta intera. Due preventivi con lo stesso totale ma
 * righe, IVA o valuta diverse non sono la stessa offerta.
 */
export function quoteSignatureMismatches(snapshot: any, quote: any): string[] {
  const mismatches: string[] = []
  const sameNumber = (left: unknown, right: unknown) => cents(left) === cents(right)
  if (!sameNumber(snapshot?.subtotal, quote.subtotal_amount)) mismatches.push('subtotal')
  if (!sameNumber(snapshot?.discount, quote.discount_amount)) mismatches.push('discount')
  if (!sameNumber(snapshot?.tax_rate, quote.tax_rate)) mismatches.push('tax_rate')
  if (!sameNumber(snapshot?.tax, quote.tax_amount)) mismatches.push('tax')
  if (!sameNumber(snapshot?.total, quote.total_amount)) mismatches.push('total')
  if (String(snapshot?.currency || '').toUpperCase() !== String(quote.currency || '').toUpperCase()) {
    mismatches.push('currency')
  }
  if (String(snapshot?.billing_interval || 'one_time') !== String(quote.billing_interval || 'one_time')) {
    mismatches.push('billing_interval')
  }
  const economicItems = (items: unknown) => normalizeQuoteItems(items).map(economicItemSignature)
  if (stableJson(economicItems(snapshot?.items)) !== stableJson(economicItems(quote.items))) mismatches.push('items')
  return mismatches
}
