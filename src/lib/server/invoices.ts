import {
  buildFatturaXml,
  computeFeTotals,
  feText,
  grossToNetLine,
  isPlausibleCodiceFiscale,
  isValidPartitaIva,
  normalizePartitaIva,
  progressivoInvio,
  quoteItemsToFeLines,
  splitComuneProvincia,
  toCents,
  validateFeInput,
  type FeCustomer,
  type FeInvoiceInput,
  type FeLine,
  type FePaymentMethod,
  type FeSeller,
} from '@/lib/fatturapa'
import { ArubaError, arubaConfigured, arubaEnv, arubaInvoiceStatus, arubaUploadInvoice, mapArubaStatus } from '@/lib/server/aruba-fe'

/**
 * Fatture del CRM: bozza dal preventivo o dal rinnovo Stripe, invio ad Aruba,
 * stato SDI. Tutte le funzioni ricevono il client service role e l'id del
 * proprietario del workspace: chi chiama ha gia' controllato che sia lui.
 */

export type InvoiceSettings = {
  user_id?: string
  denominazione: string
  partita_iva: string
  codice_fiscale: string | null
  regime_fiscale: string
  indirizzo: string
  cap: string
  comune: string
  provincia: string | null
  nazione: string
  iban: string | null
  natura_esente: string | null
  bollo_virtuale: boolean
  causale_extra: string | null
  numero_formato: string
}

export type InvoiceRow = {
  id: string
  user_id: string
  quote_id: string | null
  contact_id: string | null
  source: 'quote' | 'stripe_renewal' | 'manual'
  stripe_invoice_id: string | null
  status: string
  year: number | null
  number: number | null
  numero: string | null
  issue_date: string
  customer: FeCustomer
  lines: FeLine[]
  payment_method: FePaymentMethod
  causale: string | null
  imponibile: number
  imposta: number
  totale: number
  warnings: string[]
  xml: string | null
  send_attempts: number
  aruba_env: string | null
  aruba_filename: string | null
  sdi_status: string | null
  sdi_detail: string | null
  last_error: string | null
  sent_at: string | null
  last_synced_at: string | null
  created_at: string
  updated_at: string
}

/** Stati in cui la fattura si puo' ancora correggere e (re)inviare. */
export const EDITABLE_STATUSES = ['draft', 'error', 'rejected']

/** Dati dell'entita' legale di Speaqi (CLAUDE.md): solo il punto di partenza del modulo, mai salvati da soli. */
export const DEFAULT_INVOICE_SETTINGS: InvoiceSettings = {
  denominazione: 'TheBestItaly',
  partita_iva: '10831191217',
  codice_fiscale: '95125440636',
  regime_fiscale: 'RF01',
  indirizzo: '',
  cap: '',
  comune: '',
  provincia: null,
  nazione: 'IT',
  iban: null,
  natura_esente: null,
  bollo_virtuale: false,
  causale_extra: null,
  numero_formato: '{n}',
}

export async function loadInvoiceSettings(admin: any, userId: string): Promise<{ settings: InvoiceSettings; saved: boolean }> {
  const { data, error } = await admin.from('invoice_settings').select('*').eq('user_id', userId).maybeSingle()
  if (error) throw error
  return data ? { settings: data as InvoiceSettings, saved: true } : { settings: { ...DEFAULT_INVOICE_SETTINGS }, saved: false }
}

export function sellerFromSettings(settings: InvoiceSettings): FeSeller {
  return {
    denominazione: settings.denominazione,
    partitaIva: settings.partita_iva,
    codiceFiscale: settings.codice_fiscale || null,
    regimeFiscale: settings.regime_fiscale,
    indirizzo: settings.indirizzo,
    cap: settings.cap,
    comune: settings.comune,
    provincia: settings.provincia,
    nazione: settings.nazione || 'IT',
    iban: settings.iban,
  }
}

export function formatNumero(format: string, number: number, year: number): string {
  const text = (format || '{n}')
    .replace(/\{n\}/g, String(number))
    .replace(/\{yyyy\}/g, String(year))
    .replace(/\{yy\}/g, String(year % 100).padStart(2, '0'))
  return text.includes(String(number)) ? text.slice(0, 20) : String(number)
}

/** Il campo "P.IVA / CF" del preventivo e' uno solo: si decide dalla forma. */
export function splitTaxId(value: unknown): { partitaIva: string | null; codiceFiscale: string | null } {
  const raw = String(value ?? '').replace(/\s+/g, '').toUpperCase()
  if (!raw) return { partitaIva: null, codiceFiscale: null }
  if (isValidPartitaIva(raw)) return { partitaIva: normalizePartitaIva(raw), codiceFiscale: null }
  if (isPlausibleCodiceFiscale(raw)) return { partitaIva: null, codiceFiscale: raw }
  return { partitaIva: normalizePartitaIva(raw), codiceFiscale: null }
}

export function customerFromQuote(quote: any, contact: any = null): FeCustomer {
  const pick = (quoteKey: string, contactKey: string) => {
    const fromQuote = quote?.[quoteKey]
    return (typeof fromQuote === 'string' && fromQuote.trim() ? fromQuote : contact?.[contactKey]) || ''
  }
  const tax = splitTaxId(pick('customer_tax_id', 'billing_tax_id'))
  const place = splitComuneProvincia(pick('customer_city', 'billing_city'))
  return {
    denominazione: feText(quote?.customer_company || contact?.company || quote?.customer_name || contact?.name || '', 80),
    partitaIva: tax.partitaIva,
    codiceFiscale: tax.codiceFiscale,
    codiceDestinatario: String(pick('customer_sdi', 'billing_sdi')).trim() || null,
    pec: String(pick('customer_pec', 'billing_pec')).trim() || null,
    indirizzo: String(pick('customer_address', 'billing_address')).trim(),
    cap: String(pick('customer_zip', 'billing_zip')).trim(),
    comune: place.comune,
    provincia: place.provincia,
    nazione: 'IT',
  }
}

export function feInputFromInvoice(invoice: Pick<InvoiceRow, 'customer' | 'lines' | 'payment_method' | 'causale' | 'issue_date' | 'numero'>, settings: InvoiceSettings, numero = 'BOZZA1', progressivo = 'BOZZA1'): FeInvoiceInput {
  return {
    seller: sellerFromSettings(settings),
    customer: invoice.customer,
    numero: invoice.numero || numero,
    data: String(invoice.issue_date).slice(0, 10),
    progressivoInvio: progressivo,
    lines: invoice.lines,
    paymentMethod: invoice.payment_method,
    causale: [invoice.causale, settings.causale_extra].filter(Boolean).join(' '),
    naturaEsente: settings.natura_esente,
    bolloVirtuale: settings.bollo_virtuale,
  }
}

/** Cosa manca prima di poter inviare. Vuoto = pronta. */
export function invoiceProblems(invoice: InvoiceRow, settings: InvoiceSettings): string[] {
  return validateFeInput(feInputFromInvoice(invoice, settings))
}

function totalsFor(lines: FeLine[], settings: InvoiceSettings) {
  const totals = computeFeTotals(lines, { naturaEsente: settings.natura_esente, bolloVirtuale: settings.bollo_virtuale })
  return { imponibile: totals.imponibileCents / 100, imposta: totals.impostaCents / 100, totale: totals.totaleCents / 100 }
}

function quotePaymentMethod(quote: any, viaStripe: boolean): FePaymentMethod {
  return viaStripe || quote?.payment_method === 'stripe' || quote?.stripe_payment_status === 'paid' ? 'MP08' : 'MP05'
}

/** Oggi nel fuso italiano, YYYY-MM-DD: alle 00:30 di Roma il server in UTC e' ancora a ieri. */
export function romeToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

function formatDay(iso: string | null | undefined) {
  if (!iso) return ''
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Rome' })
}

export type DraftFromQuoteOptions = {
  /** Rinnovo di un abbonamento: una fattura per incasso Stripe. */
  stripeInvoiceId?: string | null
  /** Importo incassato IVA compresa (rinnovi). */
  grossAmount?: number | null
  periodEnd?: string | null
  viaStripe?: boolean
}

/**
 * Bozza di fattura da un preventivo. Idempotente: se esiste gia' (stesso
 * preventivo, o stesso incasso Stripe per un rinnovo) restituisce quella.
 */
export async function createInvoiceDraftFromQuote(admin: any, userId: string, quoteId: string, options: DraftFromQuoteOptions = {}): Promise<{ invoice: InvoiceRow; created: boolean }> {
  const renewal = Boolean(options.stripeInvoiceId) && options.grossAmount != null && options.grossAmount > 0
  const findExisting = () =>
    renewal
      ? admin.from('invoices').select('*').eq('stripe_invoice_id', options.stripeInvoiceId).maybeSingle()
      : admin.from('invoices').select('*').eq('quote_id', quoteId).eq('source', 'quote').maybeSingle()
  const { data: existing } = await findExisting()
  if (existing) return { invoice: existing as InvoiceRow, created: false }

  const { data: quote, error: quoteError } = await admin.from('quotes').select('*').eq('id', quoteId).eq('user_id', userId).maybeSingle()
  if (quoteError) throw quoteError
  if (!quote) throw new Error('Preventivo non trovato')
  let contact = null
  if (quote.contact_id) {
    const { data } = await admin.from('contacts').select('name, company, billing_tax_id, billing_pec, billing_sdi, billing_address, billing_zip, billing_city').eq('id', quote.contact_id).maybeSingle()
    contact = data
  }

  const { settings } = await loadInvoiceSettings(admin, userId)
  const vatRate = Number(quote.tax_rate ?? 22)
  const warnings: string[] = []
  let lines = quoteItemsToFeLines(Array.isArray(quote.items) ? quote.items : [], vatRate, Number(quote.discount_amount) || 0)
  let causale = feText(`Preventivo ${quote.quote_number}${quote.title ? ` - ${quote.title}` : ''}`, 200)

  if (renewal) {
    const gross = Number(options.grossAmount)
    const fromItems = computeFeTotals(lines).totaleCents
    // Se il rinnovo costa quanto il preventivo si fatturano le stesse righe; altrimenti una riga netta dall'incasso.
    if (fromItems !== toCents(gross)) {
      lines = [grossToNetLine(`Rinnovo abbonamento ${quote.title || quote.quote_number}`, gross, vatRate)]
    }
    const until = formatDay(options.periodEnd)
    causale = feText(`Rinnovo abbonamento, preventivo ${quote.quote_number}${until ? `, fino al ${until}` : ''}`, 200)
    const billed = computeFeTotals(lines).totaleCents
    if (billed !== toCents(gross)) warnings.push(`Incassati ${gross.toFixed(2)} €, in fattura ${(billed / 100).toFixed(2)} € per l'arrotondamento dell'IVA: controlla prima di inviare.`)
  } else {
    const billed = computeFeTotals(lines).totaleCents
    const expected = toCents(Number(quote.total_amount) || 0)
    if (expected && billed !== expected) warnings.push(`Il preventivo dice ${(expected / 100).toFixed(2)} €, le righe fanno ${(billed / 100).toFixed(2)} €: controlla le righe.`)
    if (Number(quote.deposit_amount) > 0 && Number(quote.balance_amount) > 0) {
      warnings.push('Il preventivo ha acconto e saldo: questa bozza fattura l’intero importo. Se hai incassato solo l’acconto, correggi le righe.')
    }
  }

  const row = {
    user_id: userId,
    quote_id: quote.id,
    contact_id: quote.contact_id || null,
    source: renewal ? 'stripe_renewal' : 'quote',
    stripe_invoice_id: renewal ? options.stripeInvoiceId : null,
    status: 'draft',
    issue_date: romeToday(),
    customer: customerFromQuote(quote, contact),
    lines,
    payment_method: quotePaymentMethod(quote, Boolean(options.viaStripe || renewal)),
    causale,
    warnings,
    ...totalsFor(lines, settings),
  }
  const { data, error } = await admin.from('invoices').insert(row).select('*').single()
  if (error) {
    // Due webhook insieme: ha vinto l'altro, si restituisce la sua bozza.
    if (error.code === '23505') {
      const { data: again } = await findExisting()
      if (again) return { invoice: again as InvoiceRow, created: false }
    }
    throw error
  }
  return { invoice: data as InvoiceRow, created: true }
}

export function normalizeLines(raw: unknown): FeLine[] | null {
  if (!Array.isArray(raw)) return null
  const lines: FeLine[] = []
  for (const item of raw) {
    const description = feText((item as any)?.description, 1000)
    const quantity = Number((item as any)?.quantity)
    const unitPrice = Number(String((item as any)?.unitPrice ?? '').replace(',', '.'))
    const vatRate = Number((item as any)?.vatRate)
    if (!description || !(quantity > 0) || !Number.isFinite(unitPrice) || !(vatRate >= 0 && vatRate < 100)) return null
    lines.push({ description, quantity, unitPrice: Math.round(unitPrice * 100) / 100, vatRate })
  }
  return lines
}

export function normalizeCustomer(raw: any): FeCustomer | null {
  if (!raw || typeof raw !== 'object') return null
  const text = (v: unknown, max = 80) => feText(v ?? '', max)
  return {
    denominazione: text(raw.denominazione),
    partitaIva: normalizePartitaIva(raw.partitaIva) || null,
    codiceFiscale: String(raw.codiceFiscale ?? '').replace(/\s+/g, '').toUpperCase() || null,
    codiceDestinatario: String(raw.codiceDestinatario ?? '').replace(/\s+/g, '').toUpperCase() || null,
    pec: String(raw.pec ?? '').trim() || null,
    indirizzo: text(raw.indirizzo, 60),
    cap: String(raw.cap ?? '').trim(),
    comune: text(raw.comune, 60),
    provincia: String(raw.provincia ?? '').trim().toUpperCase().slice(0, 2) || null,
    nazione: (String(raw.nazione ?? 'IT').trim().toUpperCase() || 'IT').slice(0, 2),
  }
}

/** Ricalcola i totali dopo una modifica della bozza. */
export function recomputeTotals(lines: FeLine[], settings: InvoiceSettings) {
  return totalsFor(lines, settings)
}

export type SendResult =
  | { ok: true; invoice: InvoiceRow }
  | { ok: false; status: number; error: string; problems?: string[]; invoice?: InvoiceRow }

/**
 * Invia una fattura ad Aruba. Il numero si prende qui, solo dopo che i dati
 * hanno passato i controlli: una fattura che non partirebbe non brucia un
 * numero. Se Aruba rifiuta, il numero resta alla fattura e si reinvia quella.
 */
/**
 * `manual: true` = numera e prepara l'XML senza chiamare Aruba: lo carica a
 * mano chi emette sul pannello Aruba (la prima fattura, per controllarla).
 * La fattura resta "inviata" con `aruba_env = 'manual'` e niente nome file,
 * quindi la lettura dello stato SDI la salta.
 */
export async function sendInvoice(admin: any, userId: string, invoiceId: string, options: { manual?: boolean } = {}): Promise<SendResult> {
  const manual = Boolean(options.manual)
  if (!manual && !arubaConfigured()) return { ok: false, status: 503, error: 'Aruba non è collegato: mancano ARUBA_FE_USERNAME e ARUBA_FE_PASSWORD.' }
  const env = manual ? 'manual' : arubaEnv()
  const { settings, saved } = await loadInvoiceSettings(admin, userId)
  if (!saved) return { ok: false, status: 400, error: 'Prima salva i dati fiscali di chi emette le fatture.' }

  const { data: current, error: loadError } = await admin.from('invoices').select('*').eq('id', invoiceId).eq('user_id', userId).maybeSingle()
  if (loadError) throw loadError
  if (!current) return { ok: false, status: 404, error: 'Fattura non trovata' }
  if (!EDITABLE_STATUSES.includes(current.status)) return { ok: false, status: 409, error: 'Questa fattura è già stata inviata.' }

  const problems = invoiceProblems(current as InvoiceRow, settings)
  if (problems.length) return { ok: false, status: 400, error: 'La fattura non è pronta.', problems }

  // Presa in carico: un secondo clic o una seconda scheda trovano la fattura gia' "in invio".
  const { data: claimed } = await admin
    .from('invoices')
    .update({ status: 'sending', last_error: null })
    .eq('id', invoiceId)
    .eq('user_id', userId)
    .in('status', EDITABLE_STATUSES)
    .select('*')
    .maybeSingle()
  if (!claimed) return { ok: false, status: 409, error: 'La fattura è già in invio.' }

  let invoice = claimed as InvoiceRow
  try {
    if (invoice.number == null) {
      const year = Number(String(invoice.issue_date).slice(0, 4))
      // La numerazione segue le date: la fattura nuova non puo' essere datata prima dell'ultima emessa.
      const { data: latest } = await admin
        .from('invoices')
        .select('issue_date, numero')
        .eq('user_id', userId)
        .eq('year', year)
        .order('issue_date', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (latest && String(latest.issue_date) > String(invoice.issue_date)) {
        throw new Error(`La fattura ${latest.numero} è del ${latest.issue_date}: questa deve avere una data uguale o successiva.`)
      }
      const { data: number, error } = await admin.rpc('reserve_invoice_number', { p_user_id: userId, p_year: year })
      if (error) throw error
      const { data: numbered, error: numberError } = await admin
        .from('invoices')
        .update({ number, year, numero: formatNumero(settings.numero_formato, Number(number), year) })
        .eq('id', invoiceId)
        .select('*')
        .single()
      if (numberError) throw numberError
      invoice = numbered as InvoiceRow
    }

    const attempt = (invoice.send_attempts || 0) + 1
    const xml = buildFatturaXml(feInputFromInvoice(invoice, settings, invoice.numero!, progressivoInvio(invoice.year!, invoice.number!, attempt)))
    const totals = totalsFor(invoice.lines, settings)
    await admin.from('invoices').update({ xml, send_attempts: attempt, aruba_env: env, ...totals }).eq('id', invoiceId)

    if (manual) {
      const { data: prepared } = await admin
        .from('invoices')
        .update({ status: 'sent', aruba_filename: null, sent_at: new Date().toISOString(), sdi_status: 'XML pronto: da caricare a mano sul pannello Aruba', sdi_detail: null, last_error: null })
        .eq('id', invoiceId)
        .select('*')
        .single()
      return { ok: true, invoice: prepared as InvoiceRow }
    }

    const { filename } = await arubaUploadInvoice(xml, env as 'demo' | 'production')
    const { data: sent } = await admin
      .from('invoices')
      .update({ status: 'sent', aruba_filename: filename, sent_at: new Date().toISOString(), sdi_status: 'Inviata ad Aruba', sdi_detail: null, last_error: null })
      .eq('id', invoiceId)
      .select('*')
      .single()
    return { ok: true, invoice: sent as InvoiceRow }
  } catch (error) {
    const uncertain = error instanceof ArubaError && error.uncertain
    const message = error instanceof Error ? error.message : String(error)
    const lastError = uncertain
      ? `${message} Non è certo che Aruba l’abbia ricevuta: controlla sul pannello Aruba prima di reinviare (un doppione verrebbe comunque scartato dallo SDI).`
      : message
    const { data: failed } = await admin.from('invoices').update({ status: 'error', last_error: lastError }).eq('id', invoiceId).select('*').single()
    return { ok: false, status: 502, error: lastError, invoice: failed as InvoiceRow }
  }
}

/** Pausa fra due letture di stato: Aruba ne ammette 12 al minuto per IP. */
const STATUS_CALL_SPACING_MS = 6_000
/** Una fattura si rilegge al massimo ogni due ore: la quota base e' 10.000 richieste l'anno. */
const STATUS_RECHECK_MS = 2 * 3600_000

/**
 * Rilegge da Aruba lo stato SDI delle fatture ancora "inviate" (senza esito)
 * degli ultimi 20 giorni. Poche per giro, distanziate, e al primo 429 si ferma:
 * una richiesta rifiutata allunga il blocco della quota.
 */
export async function syncInvoiceStatuses(admin: any, limit = 8, spacingMs = STATUS_CALL_SPACING_MS) {
  const result = { checked: 0, updated: 0, errors: [] as string[], rate_limited: false }
  if (!arubaConfigured()) return { ...result, skipped: 'aruba_not_configured' }

  // Un invio rimasto a meta' (processo morto fra la presa in carico e la risposta) torna in errore.
  const staleSending = new Date(Date.now() - 10 * 60_000).toISOString()
  await admin
    .from('invoices')
    .update({ status: 'error', last_error: 'Invio interrotto: controlla sul pannello Aruba se la fattura è arrivata prima di reinviarla.' })
    .eq('status', 'sending')
    .lt('updated_at', staleSending)

  const since = new Date(Date.now() - 20 * 86400_000).toISOString()
  const recheckBefore = Date.now() - STATUS_RECHECK_MS
  const { data, error } = await admin
    .from('invoices')
    .select('id, aruba_filename, aruba_env, status, sdi_status, last_synced_at')
    .eq('status', 'sent')
    .not('aruba_filename', 'is', null)
    .gte('sent_at', since)
    .order('last_synced_at', { ascending: true, nullsFirst: true })
    .limit(limit * 3)
  if (error) throw error

  const due = (data || []).filter((row: any) => !row.last_synced_at || new Date(row.last_synced_at).getTime() < recheckBefore).slice(0, limit)
  for (const [index, row] of due.entries()) {
    if (index > 0 && spacingMs > 0) await new Promise((resolve) => setTimeout(resolve, spacingMs))
    result.checked += 1
    try {
      const env = row.aruba_env === 'production' ? 'production' : 'demo'
      const state = await arubaInvoiceStatus(row.aruba_filename, env)
      const patch: Record<string, unknown> = { last_synced_at: new Date().toISOString() }
      if (state) {
        patch.sdi_status = state.status
        patch.sdi_detail = state.detail
        patch.status = mapArubaStatus(state.status)
      }
      await admin.from('invoices').update(patch).eq('id', row.id)
      if (state && (state.status !== row.sdi_status || patch.status !== row.status)) result.updated += 1
    } catch (error) {
      result.errors.push(`${row.id}: ${error instanceof Error ? error.message : String(error)}`)
      if (error instanceof ArubaError && error.rateLimited) {
        result.rate_limited = true
        break
      }
    }
  }
  return result
}
