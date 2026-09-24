import { SPEAQI_PACKAGES } from '@/lib/speaqi-quote-packages'

/**
 * Programma commerciali: l'unico posto dove stanno le provvigioni mostrate
 * su /diventa-commerciale. Il prezzo arriva dal pacchetto, cosi' se cambia
 * il listino gli esempi della pagina si aggiornano da soli.
 */
export const SALES_PROGRAM = {
  productKey: 'video_map' as const,
  /** Percentuale sul netto del primo anno. */
  firstYearPercent: 30,
  /** Percentuale sul netto di ogni rinnovo, finche' il cliente resta. */
  renewalPercent: 10,
  payoutTerms: 'entro 30 giorni dall’incasso',
}

export function salesProgramProduct() {
  const p = SPEAQI_PACKAGES[SALES_PROGRAM.productKey]
  return { label: p.label, netPrice: p.unit_price, listPrice: p.list_unit_price }
}

function round2(value: number) {
  return Math.round(value * 100) / 100
}

export function commissionExamples(clients = 10) {
  const { netPrice } = salesProgramProduct()
  const firstYear = round2((netPrice * SALES_PROGRAM.firstYearPercent) / 100)
  const renewal = round2((netPrice * SALES_PROGRAM.renewalPercent) / 100)
  return {
    perSale: { firstYear, renewal },
    portfolio: { clients, firstYear: round2(firstYear * clients), renewalPerYear: round2(renewal * clients) },
  }
}

export type SalesApplication = {
  name: string
  email: string
  phone: string
  area: string
  experience: string | null
  hasVatNumber: boolean | null
  availability: string | null
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const APPLICATION_TEXT_MAX = 2000

function line(value: unknown, max = 200) {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim()
  return normalized ? normalized.slice(0, max) : null
}

function block(value: unknown, max = APPLICATION_TEXT_MAX) {
  const normalized = String(value ?? '').replace(/\r\n/g, '\n').trim()
  return normalized ? normalized.slice(0, max) : null
}

export type ApplicationParse =
  | { ok: true; value: SalesApplication }
  | { ok: false; error: string }
  | { ok: false; spam: true }

/**
 * Validazione della candidatura. `website` e' l'honeypot: un campo nascosto
 * che una persona non vede e un bot compila. In quel caso si finge successo
 * e non si scrive niente.
 */
export function parseSalesApplication(body: unknown): ApplicationParse {
  const row = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  if (line(row.website)) return { ok: false, spam: true }

  const name = line(row.name)
  const email = line(row.email)?.toLowerCase() || null
  const phone = line(row.phone, 40)
  const area = line(row.area, 120)

  if (!name || name.length < 3) return { ok: false, error: 'Scrivi nome e cognome' }
  if (!email || !EMAIL_RE.test(email)) return { ok: false, error: 'Email non valida' }
  if (!phone || phone.replace(/\D/g, '').length < 6) return { ok: false, error: 'Numero di telefono non valido' }
  if (!area) return { ok: false, error: 'Indica la zona in cui vuoi lavorare' }
  if (row.privacy !== true) return { ok: false, error: 'Serve il consenso al trattamento dei dati' }

  const vat = row.has_vat_number
  return {
    ok: true,
    value: {
      name,
      email,
      phone,
      area,
      experience: block(row.experience),
      hasVatNumber: vat === true || vat === 'yes' ? true : vat === false || vat === 'no' ? false : null,
      availability: line(row.availability, 120),
    },
  }
}

export function applicationSummary(application: SalesApplication) {
  return [
    `Candidatura commerciale: ${application.name}`,
    `Zona: ${application.area}`,
    `Telefono: ${application.phone}`,
    `Email: ${application.email}`,
    `Partita IVA: ${application.hasVatNumber === true ? 'sì' : application.hasVatNumber === false ? 'no' : 'non indicato'}`,
    application.availability ? `Disponibilità: ${application.availability}` : null,
    application.experience ? `Esperienza:\n${application.experience}` : null,
  ]
    .filter(Boolean)
    .join('\n')
}
