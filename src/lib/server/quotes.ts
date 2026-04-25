import { randomBytes, randomUUID } from 'node:crypto'
import type { QuoteLineItem, QuotePaymentMethod, QuoteStatus } from '@/types'

export { DEFAULT_BANK_TRANSFER_INSTRUCTIONS, DEFAULT_CONTRACT_TERMS } from '@/lib/quote-defaults'

const VALID_STATUSES = new Set<QuoteStatus>(['draft', 'sent', 'accepted', 'paid', 'cancelled'])
const VALID_PAYMENT_METHODS = new Set<QuotePaymentMethod>(['bank_transfer', 'stripe', 'both'])

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

      return {
        id: normalizeText(row.id) || randomUUID(),
        description,
        details: normalizeText(row.details),
        quantity,
        unit_price: roundMoney(unitPrice),
        ...(listUnitPrice ? { list_unit_price: listUnitPrice } : {}),
        line_total: lineTotal,
      }
    })
    .forEach((item) => {
      if (item) items.push(item)
    })

  return items
}

export function calculateQuoteTotals(
  items: QuoteLineItem[],
  options?: {
    discountAmount?: number
    taxRate?: number
    depositPercent?: number
  }
) {
  const subtotalAmount = roundMoney(
    items.reduce((total, item) => total + Math.max(0, Number(item.line_total ?? item.quantity * item.unit_price)), 0)
  )
  const discountAmount = roundMoney(Math.min(Math.max(0, options?.discountAmount ?? 0), subtotalAmount))
  const taxableAmount = Math.max(0, subtotalAmount - discountAmount)
  const taxRate = roundMoney(Math.max(0, options?.taxRate ?? 22))
  const taxAmount = roundMoney(taxableAmount * (taxRate / 100))
  const totalAmount = roundMoney(taxableAmount + taxAmount)
  const depositPercent = roundMoney(Math.max(0, Math.min(100, options?.depositPercent ?? 30)))
  const depositAmount = roundMoney(totalAmount * (depositPercent / 100))
  const balanceAmount = roundMoney(Math.max(0, totalAmount - depositAmount))

  return {
    subtotal_amount: subtotalAmount,
    discount_amount: discountAmount,
    tax_rate: taxRate,
    tax_amount: taxAmount,
    total_amount: totalAmount,
    deposit_percent: depositPercent,
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

export function publicQuoteUrl(origin: string, token: string) {
  return `${origin.replace(/\/$/, '')}/preventivo?id=${encodeURIComponent(token)}`
}

export function currencyCode(value?: string | null) {
  const normalized = String(value || 'EUR').trim().toUpperCase()
  return /^[A-Z]{3}$/.test(normalized) ? normalized : 'EUR'
}
