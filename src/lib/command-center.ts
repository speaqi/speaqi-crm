/**
 * Prima pagina del titolare e scheda completa del cliente: dai dati grezzi di
 * CRM, StudioMap e Speaqi alle poche cose da guardare.
 *
 * Modulo puro (niente import): lo usano le rotte e i test. Le date si leggono
 * nel fuso italiano, i soldi si sommano in centesimi.
 */

export type MoneyQuote = {
  id: string
  quote_number: string
  title?: string | null
  customer_name?: string | null
  customer_company?: string | null
  contact_id?: string | null
  status: string
  payment_state?: string | null
  total_amount: number | string | null
  paid_at?: string | null
  billing_interval?: string | null
  subscription_status?: string | null
  current_period_end?: string | null
  cancel_at_period_end?: boolean | null
}

export type MoneyInvoice = {
  id: string
  quote_id: string | null
  source: string
  status: string
  totale: number | string
  numero?: string | null
  customer?: { denominazione?: string } | null
  sent_at?: string | null
}

export type WaitingItem = {
  kind: 'office_output' | 'invoice_draft' | 'invoice_problem' | 'presentation' | 'deck' | 'unsigned' | 'past_due' | 'to_invoice'
  title: string
  detail: string
  href: string
  tone: 'act' | 'warn' | 'bad'
}

export type MapStage = 'online' | 'su_speaqi' | 'pronta' | 'in_lavorazione'

export type StudioCatalogEntry = {
  slug: string
  name: string
  status: 'in_lavorazione' | 'pronta' | 'su_speaqi'
  places: number
  ready_places: number
  routes?: number
  speaqi_map_id: string | null
  updated_at?: string
}

export type SpeaqiGuideMap = {
  id: string
  slug: string
  name: string
  is_paid: boolean
  price_cents: number | null
  points: number | null
}

export type MapStatusRow = {
  key: string
  name: string
  stage: MapStage
  places: number | null
  ready_places: number | null
  speaqi_slug: string | null
  studiomap_slug: string | null
  price_cents: number | null
}

export const MAP_STAGE_LABEL: Record<MapStage, string> = {
  online: 'Online',
  su_speaqi: 'Su Speaqi, non ancora online',
  pronta: 'Pronta in StudioMap',
  in_lavorazione: 'In lavorazione',
}

const cents = (value: unknown) => Math.round((Number(value) || 0) * 100)

/** "2026-10" nel fuso italiano. */
export function romeMonthKey(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit' }).format(d).slice(0, 7)
}

export function isQuotePaid(quote: Pick<MoneyQuote, 'status' | 'payment_state'>): boolean {
  return quote.status === 'paid' || quote.payment_state === 'paid'
}

function quoteLabel(quote: MoneyQuote): string {
  return quote.customer_company || quote.customer_name || quote.quote_number
}

/**
 * I soldi del mese: incassato (preventivi pagati nel mese), da fatturare
 * (pagati senza fattura), rinnovi dei prossimi 30 giorni, pagamenti falliti.
 */
export function summarizeMoney(quotes: MoneyQuote[], invoices: MoneyInvoice[], now = new Date()) {
  const month = romeMonthKey(now)
  const invoicedQuotes = new Set(invoices.filter((inv) => inv.source === 'quote' && inv.quote_id).map((inv) => inv.quote_id as string))
  const horizon = now.getTime() + 30 * 86400_000

  let paidMonthCents = 0
  let paidMonthCount = 0
  const toInvoice: MoneyQuote[] = []
  const renewals: Array<{ quote: MoneyQuote; date: string }> = []
  const pastDue: MoneyQuote[] = []

  for (const quote of quotes) {
    if (quote.status === 'cancelled') continue
    const paid = isQuotePaid(quote)
    if (paid && quote.paid_at && romeMonthKey(quote.paid_at) === month) {
      paidMonthCents += cents(quote.total_amount)
      paidMonthCount += 1
    }
    if (paid && !invoicedQuotes.has(quote.id)) toInvoice.push(quote)
    if (quote.billing_interval === 'year' && quote.current_period_end && !quote.cancel_at_period_end && quote.subscription_status !== 'canceled') {
      const end = new Date(quote.current_period_end).getTime()
      if (end >= now.getTime() && end <= horizon) renewals.push({ quote, date: quote.current_period_end })
    }
    if (quote.subscription_status === 'past_due' || quote.subscription_status === 'unpaid') pastDue.push(quote)
  }

  // Fatture emesse nel mese: quello che il commercialista vede.
  const invoicedMonthCents = invoices
    .filter((inv) => inv.sent_at && romeMonthKey(inv.sent_at) === month && !['draft', 'error', 'rejected', 'sending'].includes(inv.status))
    .reduce((sum, inv) => sum + cents(inv.totale), 0)

  renewals.sort((a, b) => a.date.localeCompare(b.date))
  return {
    month,
    paid_month: paidMonthCents / 100,
    paid_month_count: paidMonthCount,
    invoiced_month: invoicedMonthCents / 100,
    to_invoice_count: toInvoice.length,
    to_invoice_amount: toInvoice.reduce((sum, q) => sum + cents(q.total_amount), 0) / 100,
    to_invoice: toInvoice.slice(0, 5).map((q) => ({ id: q.id, label: quoteLabel(q), amount: Number(q.total_amount) || 0, contact_id: q.contact_id || null })),
    renewals: renewals.slice(0, 6).map(({ quote, date }) => ({ id: quote.id, label: quoteLabel(quote), date, amount: Number(quote.total_amount) || 0, contact_id: quote.contact_id || null })),
    renewals_amount: renewals.reduce((sum, r) => sum + cents(r.quote.total_amount), 0) / 100,
    past_due: pastDue.map((q) => ({ id: q.id, label: quoteLabel(q), amount: Number(q.total_amount) || 0, contact_id: q.contact_id || null })),
  }
}

/**
 * Quello che e' fermo su di te, in ordine di urgenza: pagamenti falliti,
 * fatture in errore o scartate, bozze da inviare, presentazioni da approvare,
 * preventivi accettati da firmare.
 */
export function buildWaiting(input: {
  invoices: Array<MoneyInvoice & { warnings?: string[] | null; last_error?: string | null }>
  presentations: Array<{ id: string; title: string; status: string; project_title?: string | null }>
  decks: Array<{ id: string; title: string; status: string; destination?: string | null }>
  pastDue: Array<{ id: string; label: string; contact_id: string | null }>
  toInvoiceCount: number
  officeOutputs?: Array<{ id: string; title: string; status: string; agent_id: string }>
}): WaitingItem[] {
  const items: WaitingItem[] = []
  for (const q of input.pastDue) {
    items.push({ kind: 'past_due', title: `Pagamento non riuscito: ${q.label}`, detail: 'Stripe ritenta da solo, conviene avvisare il cliente.', href: q.contact_id ? `/scheda/${q.contact_id}` : '/preventivi', tone: 'bad' })
  }
  for (const inv of input.invoices) {
    const who = inv.customer?.denominazione || 'cliente'
    if (inv.status === 'error' || inv.status === 'rejected') {
      items.push({ kind: 'invoice_problem', title: `Fattura ${inv.numero || 'in bozza'} da correggere: ${who}`, detail: inv.status === 'rejected' ? 'Scartata dallo SDI.' : 'Invio non riuscito.', href: '/fatture', tone: 'bad' })
    } else if (inv.status === 'draft') {
      items.push({ kind: 'invoice_draft', title: `Fattura da inviare: ${who}`, detail: `${formatEuroPlain(Number(inv.totale))} in bozza, da controllare e inviare allo SDI.`, href: '/fatture', tone: 'act' })
    }
  }
  if (input.toInvoiceCount > 0) {
    items.push({ kind: 'to_invoice', title: input.toInvoiceCount === 1 ? '1 preventivo pagato senza fattura' : `${input.toInvoiceCount} preventivi pagati senza fattura`, detail: 'Da fatturare in Fatture.', href: '/fatture', tone: 'act' })
  }
  for (const p of input.presentations) {
    if (p.status === 'ready') items.push({ kind: 'presentation', title: `Proposta da approvare: ${p.title}`, detail: p.project_title ? `Agency · ${p.project_title}` : 'Agency', href: `/agency/presentazioni/${p.id}`, tone: 'act' })
  }
  for (const d of input.decks) {
    if (d.status === 'ready') items.push({ kind: 'deck', title: `Presentazione da approvare: ${d.title}`, detail: d.destination ? `Destinazione ${d.destination}` : 'Tourism', href: '/tourism', tone: 'act' })
  }
  for (const output of input.officeOutputs || []) {
    if (output.status === 'pending') items.push({ kind: 'office_output', title: output.title, detail: `Ufficio · ${output.agent_id}`, href: `/ufficio/agenti#uscita-${output.id}`, tone: 'act' })
  }
  const order: Record<WaitingItem['tone'], number> = { bad: 0, warn: 1, act: 2 }
  return items.sort((a, b) => order[a.tone] - order[b.tone])
}

export function formatEuroPlain(value: number): string {
  const fixed = (Math.round(value * 100) / 100).toFixed(2)
  const [int, dec] = fixed.split('.')
  const withDots = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return dec === '00' ? `${withDots} €` : `${withDots},${dec} €`
}

/**
 * Una riga per mappa, unendo StudioMap (dove si costruisce) e Speaqi (dove si
 * vende). La chiave e' l'id della mappa Speaqi quando StudioMap ce l'ha:
 * i nomi non bastano (Capri e "caprispeaqiguide").
 */
export function mergeMapStatus(catalog: StudioCatalogEntry[] | null, guides: SpeaqiGuideMap[] | null): MapStatusRow[] {
  const online = new Map((guides || []).map((g) => [g.id, g]))
  const used = new Set<string>()
  const rows: MapStatusRow[] = []
  for (const entry of catalog || []) {
    const guide = entry.speaqi_map_id ? online.get(entry.speaqi_map_id) : undefined
    if (guide) used.add(guide.id)
    rows.push({
      key: guide?.id || `studiomap:${entry.slug}`,
      name: entry.name,
      stage: guide ? 'online' : entry.status,
      places: guide?.points ?? entry.places,
      ready_places: entry.ready_places,
      speaqi_slug: guide?.slug || null,
      studiomap_slug: entry.slug,
      price_cents: guide?.is_paid ? guide.price_cents : null,
    })
  }
  for (const guide of guides || []) {
    if (used.has(guide.id)) continue
    rows.push({ key: guide.id, name: guide.name, stage: 'online', places: guide.points, ready_places: null, speaqi_slug: guide.slug, studiomap_slug: null, price_cents: guide.is_paid ? guide.price_cents : null })
  }
  const order: Record<MapStage, number> = { online: 0, su_speaqi: 1, pronta: 2, in_lavorazione: 3 }
  return rows.sort((a, b) => order[a.stage] - order[b.stage] || a.name.localeCompare(b.name, 'it'))
}

export function countMapStages(rows: MapStatusRow[]): Record<MapStage, number> {
  const counts: Record<MapStage, number> = { online: 0, su_speaqi: 0, pronta: 0, in_lavorazione: 0 }
  for (const row of rows) counts[row.stage] += 1
  return counts
}

/** Minuscole, senza accenti ne' punteggiatura: "Città di Capri" -> "citta di capri". */
export const normalizeForSearch = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** Trova una mappa per slug o per nome ("capri", "Capri", "caprispeaqiguide"). */
export function findMapRow(rows: MapStatusRow[], ref: string): MapStatusRow | null {
  const key = normalizeForSearch(ref)
  if (!key) return null
  return (
    rows.find((row) => row.speaqi_slug === ref || row.studiomap_slug === ref) ||
    rows.find((row) => normalizeForSearch(row.name) === key) ||
    rows.find((row) => (row.speaqi_slug && normalizeForSearch(row.speaqi_slug) === key) || (row.studiomap_slug && normalizeForSearch(row.studiomap_slug) === key)) ||
    null
  )
}

/** Testo cercato -> filtro ILIKE sicuro per PostgREST: niente virgole, parentesi o jolly dell'utente. */
export function searchPattern(raw: unknown): string | null {
  const text = String(raw ?? '')
    .replace(/[%_,()*\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length >= 2 ? `%${text.slice(0, 60)}%` : null
}

/** Lo stato del cliente in una frase: chi e', a che punto e', cosa manca. */
export function clientHeadline(input: {
  status: string
  openDeal: { stage: string } | null
  quotes: Array<Pick<MoneyQuote, 'status' | 'payment_state' | 'billing_interval' | 'subscription_status'>>
  signedQuoteIds: number
}): string {
  const paid = input.quotes.filter(isQuotePaid)
  const subscription = input.quotes.find((q) => q.billing_interval === 'year' && isQuotePaid(q) && q.subscription_status && q.subscription_status !== 'canceled')
  if (subscription) return subscription.subscription_status === 'past_due' ? 'Cliente con abbonamento, ultimo pagamento non riuscito.' : 'Cliente con abbonamento attivo.'
  if (paid.length) return paid.length === 1 ? 'Cliente: ha pagato un preventivo.' : `Cliente: ha pagato ${paid.length} preventivi.`
  const open = input.quotes.filter((q) => q.status === 'sent' || q.status === 'accepted')
  if (open.length) return input.signedQuoteIds ? 'Ha firmato, manca il pagamento.' : 'Preventivo inviato, in attesa di risposta.'
  if (input.openDeal) return `Trattativa aperta, fase ${input.openDeal.stage}.`
  return 'Nessuna trattativa aperta.'
}
