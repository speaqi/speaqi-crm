/**
 * Fattura elettronica: dai dati del CRM all'XML FatturaPA 1.2 (FPR12) che
 * Aruba firma e consegna allo SDI.
 *
 * Modulo puro (niente import): lo usano le rotte, il webhook Stripe e i test.
 * I conti si fanno in centesimi interi: un 0,1 + 0,2 sbagliato su una fattura
 * e' uno scarto dello SDI, non un dettaglio estetico.
 */

export type FeRegimeFiscale = string

export type FeSeller = {
  denominazione: string
  partitaIva: string
  codiceFiscale?: string | null
  regimeFiscale: FeRegimeFiscale
  indirizzo: string
  cap: string
  comune: string
  provincia?: string | null
  nazione?: string | null
  iban?: string | null
}

export type FeCustomer = {
  denominazione: string
  partitaIva?: string | null
  codiceFiscale?: string | null
  codiceDestinatario?: string | null
  pec?: string | null
  indirizzo: string
  cap: string
  comune: string
  provincia?: string | null
  nazione?: string | null
}

export type FeLine = {
  description: string
  quantity: number
  /** Prezzo unitario netto IVA, in euro. Puo' essere negativo (sconto). */
  unitPrice: number
  vatRate: number
}

/** MP05 bonifico, MP08 carta di pagamento. */
export type FePaymentMethod = 'MP05' | 'MP08'

export type FeInvoiceInput = {
  seller: FeSeller
  customer: FeCustomer
  numero: string
  /** YYYY-MM-DD */
  data: string
  progressivoInvio: string
  lines: FeLine[]
  paymentMethod: FePaymentMethod
  causale?: string | null
  /** Natura dell'operazione quando l'aliquota e' 0 (es. N2.2 per il forfettario). */
  naturaEsente?: string | null
  /** Bollo virtuale da 2 euro sulle fatture senza IVA sopra 77,47 euro. */
  bolloVirtuale?: boolean
}

export type FeSummaryRow = { vatRate: number; natura: string | null; imponibileCents: number; impostaCents: number }

export type FeTotals = {
  rows: FeSummaryRow[]
  imponibileCents: number
  impostaCents: number
  bolloCents: number
  totaleCents: number
}

export const REGIMI_FISCALI: Array<{ code: string; label: string }> = [
  { code: 'RF01', label: 'Ordinario' },
  { code: 'RF19', label: 'Forfettario' },
  { code: 'RF02', label: 'Contribuenti minimi' },
  { code: 'RF04', label: 'Agricoltura e pesca' },
  { code: 'RF18', label: 'Altro' },
]

export const NATURE_ESENTI: Array<{ code: string; label: string }> = [
  { code: 'N2.2', label: 'N2.2 Non soggette (forfettario, minimi)' },
  { code: 'N2.1', label: 'N2.1 Non soggette, art. 7 (servizi a soggetti esteri)' },
  { code: 'N4', label: 'N4 Esenti' },
  { code: 'N1', label: 'N1 Escluse ex art. 15' },
  { code: 'N3.2', label: 'N3.2 Non imponibili, cessioni intracomunitarie' },
]

const BOLLO_SOGLIA_CENTS = 7747
const BOLLO_CENTS = 200

export function toCents(value: number): number {
  return Math.round(Number(value) * 100)
}

function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

function formatQuantity(quantity: number): string {
  return (Math.round(quantity * 100) / 100).toFixed(2)
}

function formatRate(rate: number): string {
  return (Math.round(rate * 100) / 100).toFixed(2)
}

/** Totale di riga in centesimi: quantita' per prezzo, arrotondato una volta sola. */
export function lineTotalCents(line: Pick<FeLine, 'quantity' | 'unitPrice'>): number {
  return Math.round(line.quantity * line.unitPrice * 100)
}

export function computeFeTotals(lines: FeLine[], options: { naturaEsente?: string | null; bolloVirtuale?: boolean } = {}): FeTotals {
  const byRate = new Map<number, FeSummaryRow>()
  for (const line of lines) {
    const key = Math.round(line.vatRate * 100) / 100
    const row = byRate.get(key) || { vatRate: key, natura: key === 0 ? options.naturaEsente || null : null, imponibileCents: 0, impostaCents: 0 }
    row.imponibileCents += lineTotalCents(line)
    byRate.set(key, row)
  }
  const rows = [...byRate.values()].sort((a, b) => b.vatRate - a.vatRate)
  // L'imposta si calcola sul riepilogo, non riga per riga: e' cosi' che lo SDI la ricontrolla.
  for (const row of rows) row.impostaCents = Math.round((row.imponibileCents * row.vatRate) / 100)
  const imponibileCents = rows.reduce((sum, row) => sum + row.imponibileCents, 0)
  const impostaCents = rows.reduce((sum, row) => sum + row.impostaCents, 0)
  const exemptCents = rows.filter((row) => row.vatRate === 0).reduce((sum, row) => sum + row.imponibileCents, 0)
  const bolloCents = options.bolloVirtuale && exemptCents > BOLLO_SOGLIA_CENTS ? BOLLO_CENTS : 0
  return { rows, imponibileCents, impostaCents, bolloCents, totaleCents: imponibileCents + impostaCents + bolloCents }
}

/** Lo SDI accetta solo l'alfabeto latino di base e il Latin-1: virgolette tipografiche, lineette ed euro si traducono. */
export function feText(value: unknown, max = 1000): string {
  const text = String(value ?? '')
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/…/g, '...')
    .replace(/€/g, 'EUR')
    .replace(/[   ]/g, ' ')
    .replace(/[\r\n\t]+/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x20-\x7E¡-ÿ]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return text.length > max ? text.slice(0, max).trimEnd() : text
}

function xml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

function el(name: string, value: string): string {
  return `<${name}>${xml(value)}</${name}>`
}

export function normalizePartitaIva(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, '').replace(/^IT/i, '').toUpperCase()
}

/** Controllo del codice di controllo della partita IVA italiana (11 cifre). */
export function isValidPartitaIva(value: unknown): boolean {
  const piva = normalizePartitaIva(value)
  if (!/^\d{11}$/.test(piva)) return false
  let sum = 0
  for (let i = 0; i < 10; i += 1) {
    let digit = Number(piva[i])
    if (i % 2 === 1) {
      digit *= 2
      if (digit > 9) digit -= 9
    }
    sum += digit
  }
  return (10 - (sum % 10)) % 10 === Number(piva[10])
}

/** Codice fiscale: 16 caratteri della persona fisica o 11 cifre di societa' ed enti. */
export function isPlausibleCodiceFiscale(value: unknown): boolean {
  const cf = String(value ?? '').replace(/\s+/g, '').toUpperCase()
  return /^[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]$/.test(cf) || /^\d{11}$/.test(cf)
}

/** "Napoli (NA)" o "Napoli NA" -> comune e provincia; senza sigla resta solo il comune. */
export function splitComuneProvincia(value: unknown): { comune: string; provincia: string | null } {
  const text = String(value ?? '').trim()
  // La sigla si riconosce solo fra parentesi o maiuscola in coda: "Bari" non e' "Ba" + "ri".
  const match = text.match(/^(.+?)\s*\(([A-Za-z]{2})\)$/) || text.match(/^(.+?)[\s,]+([A-Z]{2})$/)
  if (match) return { comune: match[1].replace(/[\s,-]+$/, '').trim(), provincia: match[2].toUpperCase() }
  return { comune: text, provincia: null }
}

export function feDestinatario(customer: FeCustomer): { codice: string; pec: string | null } {
  const nazione = (customer.nazione || 'IT').toUpperCase()
  if (nazione !== 'IT') return { codice: 'XXXXXXX', pec: null }
  const code = String(customer.codiceDestinatario ?? '').replace(/\s+/g, '').toUpperCase()
  if (/^[A-Z0-9]{7}$/.test(code) && code !== '0000000') return { codice: code, pec: null }
  const pec = String(customer.pec ?? '').trim()
  return { codice: '0000000', pec: pec || null }
}

/** Errori che lo SDI scarterebbe, scritti per chi deve correggerli. Lista vuota = si puo' inviare. */
export function validateFeInput(input: FeInvoiceInput): string[] {
  const errors: string[] = []
  const s = input.seller
  if (!feText(s.denominazione)) errors.push('Manca la denominazione di chi emette la fattura (Dati fiscali).')
  if (!isValidPartitaIva(s.partitaIva)) errors.push('La partita IVA di chi emette la fattura non è valida (Dati fiscali).')
  if (s.codiceFiscale && !isPlausibleCodiceFiscale(s.codiceFiscale)) errors.push('Il codice fiscale di chi emette la fattura non è valido (Dati fiscali).')
  if (!/^RF\d{2}$/.test(s.regimeFiscale || '')) errors.push('Manca il regime fiscale (Dati fiscali).')
  if (!feText(s.indirizzo) || !/^\d{5}$/.test(s.cap || '') || !feText(s.comune)) errors.push('Indirizzo, CAP o comune della sede mancanti (Dati fiscali).')

  const c = input.customer
  const nazione = (c.nazione || 'IT').toUpperCase()
  if (!feText(c.denominazione)) errors.push('Manca il nome o la ragione sociale del cliente.')
  if (nazione === 'IT') {
    const hasPiva = Boolean(normalizePartitaIva(c.partitaIva))
    if (hasPiva && !isValidPartitaIva(c.partitaIva)) errors.push('La partita IVA del cliente non è valida.')
    if (!hasPiva && !isPlausibleCodiceFiscale(c.codiceFiscale)) errors.push('Serve la partita IVA o il codice fiscale del cliente.')
    if (c.codiceFiscale && !isPlausibleCodiceFiscale(c.codiceFiscale)) errors.push('Il codice fiscale del cliente non è valido.')
    if (!/^\d{5}$/.test(c.cap || '')) errors.push('Il CAP del cliente deve avere 5 cifre.')
    const dest = feDestinatario(c)
    if (dest.codice === '0000000' && !dest.pec && hasPiva) {
      errors.push('Il cliente ha la partita IVA ma non c’è né il codice destinatario né la PEC: senza, la fattura finisce solo nel suo cassetto fiscale.')
    }
  }
  if (!feText(c.indirizzo) || !feText(c.comune)) errors.push('Indirizzo o comune del cliente mancanti.')

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.data)) errors.push('Data della fattura non valida.')
  if (!/\d/.test(input.numero) || input.numero.length > 20) errors.push('Numero della fattura non valido.')
  if (!/^[A-Za-z0-9]{1,10}$/.test(input.progressivoInvio)) errors.push('Progressivo di invio non valido.')
  if (!input.lines.length) errors.push('La fattura non ha righe.')
  input.lines.forEach((line, index) => {
    if (!feText(line.description)) errors.push(`Riga ${index + 1}: manca la descrizione.`)
    if (!(line.quantity > 0)) errors.push(`Riga ${index + 1}: quantità non valida.`)
    if (!Number.isFinite(line.unitPrice)) errors.push(`Riga ${index + 1}: prezzo non valido.`)
    if (!(line.vatRate >= 0 && line.vatRate < 100)) errors.push(`Riga ${index + 1}: aliquota IVA non valida.`)
  })
  if (input.lines.some((line) => line.vatRate === 0) && !/^N\d(\.\d)?$/.test(input.naturaEsente || '')) {
    errors.push('Ci sono righe senza IVA: scegli la natura dell’operazione (Dati fiscali).')
  }
  const totals = computeFeTotals(input.lines, input)
  if (totals.totaleCents <= 0) errors.push('Il totale della fattura deve essere maggiore di zero.')
  if (input.paymentMethod === 'MP05' && input.seller.iban && !/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(input.seller.iban.replace(/\s+/g, '').toUpperCase())) {
    errors.push('L’IBAN nei Dati fiscali non è valido.')
  }
  return errors
}

function sedeXml(party: { indirizzo: string; cap: string; comune: string; provincia?: string | null; nazione?: string | null }): string {
  const nazione = (party.nazione || 'IT').toUpperCase()
  const cap = nazione === 'IT' ? party.cap : /^\d{5}$/.test(party.cap || '') ? party.cap : '00000'
  return (
    '<Sede>' +
    el('Indirizzo', feText(party.indirizzo, 60)) +
    el('CAP', cap) +
    el('Comune', feText(party.comune, 60)) +
    (party.provincia && nazione === 'IT' ? el('Provincia', party.provincia.toUpperCase().slice(0, 2)) : '') +
    el('Nazione', nazione) +
    '</Sede>'
  )
}

function chunks(text: string, size: number): string[] {
  const out: string[] = []
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size))
  return out
}

export function buildFatturaXml(input: FeInvoiceInput): string {
  const errors = validateFeInput(input)
  if (errors.length) throw new Error(errors.join(' '))

  const s = input.seller
  const c = input.customer
  const sellerPiva = normalizePartitaIva(s.partitaIva)
  const dest = feDestinatario(c)
  const totals = computeFeTotals(input.lines, input)
  const nazioneCliente = (c.nazione || 'IT').toUpperCase()
  const customerPiva = normalizePartitaIva(c.partitaIva)
  const customerCf = String(c.codiceFiscale ?? '').replace(/\s+/g, '').toUpperCase()

  const header =
    '<FatturaElettronicaHeader>' +
    '<DatiTrasmissione>' +
    '<IdTrasmittente>' + el('IdPaese', 'IT') + el('IdCodice', (s.codiceFiscale || sellerPiva).toUpperCase()) + '</IdTrasmittente>' +
    el('ProgressivoInvio', input.progressivoInvio) +
    el('FormatoTrasmissione', 'FPR12') +
    el('CodiceDestinatario', dest.codice) +
    (dest.pec ? el('PECDestinatario', dest.pec) : '') +
    '</DatiTrasmissione>' +
    '<CedentePrestatore><DatiAnagrafici>' +
    '<IdFiscaleIVA>' + el('IdPaese', 'IT') + el('IdCodice', sellerPiva) + '</IdFiscaleIVA>' +
    (s.codiceFiscale ? el('CodiceFiscale', s.codiceFiscale.toUpperCase()) : '') +
    '<Anagrafica>' + el('Denominazione', feText(s.denominazione, 80)) + '</Anagrafica>' +
    el('RegimeFiscale', s.regimeFiscale) +
    '</DatiAnagrafici>' + sedeXml(s) + '</CedentePrestatore>' +
    '<CessionarioCommittente><DatiAnagrafici>' +
    (customerPiva ? '<IdFiscaleIVA>' + el('IdPaese', nazioneCliente) + el('IdCodice', customerPiva) + '</IdFiscaleIVA>' : '') +
    (customerCf && nazioneCliente === 'IT' ? el('CodiceFiscale', customerCf) : '') +
    '<Anagrafica>' + el('Denominazione', feText(c.denominazione, 80)) + '</Anagrafica>' +
    '</DatiAnagrafici>' + sedeXml(c) + '</CessionarioCommittente>' +
    '</FatturaElettronicaHeader>'

  const causale = feText(input.causale || '', 2000)
  const generali =
    '<DatiGenerali><DatiGeneraliDocumento>' +
    el('TipoDocumento', 'TD01') +
    el('Divisa', 'EUR') +
    el('Data', input.data) +
    el('Numero', input.numero) +
    (totals.bolloCents ? '<DatiBollo>' + el('BolloVirtuale', 'SI') + el('ImportoBollo', formatCents(totals.bolloCents)) + '</DatiBollo>' : '') +
    el('ImportoTotaleDocumento', formatCents(totals.totaleCents)) +
    chunks(causale, 200).map((part) => el('Causale', part)).join('') +
    '</DatiGeneraliDocumento></DatiGenerali>'

  const linee = input.lines
    .map((line, index) => {
      const rate = Math.round(line.vatRate * 100) / 100
      return (
        '<DettaglioLinee>' +
        el('NumeroLinea', String(index + 1)) +
        el('Descrizione', feText(line.description, 1000)) +
        el('Quantita', formatQuantity(line.quantity)) +
        el('PrezzoUnitario', formatCents(toCents(line.unitPrice))) +
        el('PrezzoTotale', formatCents(lineTotalCents(line))) +
        el('AliquotaIVA', formatRate(rate)) +
        (rate === 0 ? el('Natura', input.naturaEsente || '') : '') +
        '</DettaglioLinee>'
      )
    })
    .join('')
  const riepilogo = totals.rows
    .map(
      (row) =>
        '<DatiRiepilogo>' +
        el('AliquotaIVA', formatRate(row.vatRate)) +
        (row.natura ? el('Natura', row.natura) : '') +
        el('ImponibileImporto', formatCents(row.imponibileCents)) +
        el('Imposta', formatCents(row.impostaCents)) +
        (row.vatRate > 0 ? el('EsigibilitaIVA', 'I') : '') +
        '</DatiRiepilogo>'
    )
    .join('')

  const iban = (s.iban || '').replace(/\s+/g, '').toUpperCase()
  const pagamento =
    '<DatiPagamento>' +
    el('CondizioniPagamento', 'TP02') +
    '<DettaglioPagamento>' +
    el('ModalitaPagamento', input.paymentMethod) +
    el('ImportoPagamento', formatCents(totals.totaleCents)) +
    (input.paymentMethod === 'MP05' && iban ? el('IBAN', iban) : '') +
    '</DettaglioPagamento></DatiPagamento>'

  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<p:FatturaElettronica versione="FPR12" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" ' +
    'xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2" ' +
    'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
    'xsi:schemaLocation="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2 http://www.fatturapa.gov.it/export/fatturazione/sdi/fatturapa/v1.2/Schema_del_file_xml_FatturaPA_versione_1.2.xsd">' +
    header +
    '<FatturaElettronicaBody>' +
    generali +
    '<DatiBeniServizi>' + linee + riepilogo + '</DatiBeniServizi>' +
    pagamento +
    '</FatturaElettronicaBody>' +
    '</p:FatturaElettronica>'
  )
}

/** Progressivo di invio: anno, numero e tentativo in base 36, al massimo 10 caratteri. Un reinvio dopo uno scarto ne prende uno nuovo. */
export function progressivoInvio(year: number, number: number, attempt: number): string {
  const value = (year % 100) * 1_000_000_00 + (number % 1_000_000) * 100 + (attempt % 100)
  return value.toString(36).toUpperCase().slice(0, 10)
}

/** Righe di un preventivo del CRM -> righe di fattura. Solo le alternative scelte; lo sconto diventa una riga negativa. */
export function quoteItemsToFeLines(
  items: Array<{ description?: string | null; details?: string | null; quantity?: number | null; unit_price?: number | null; choice_group_id?: string | null; selected?: boolean | null }>,
  vatRate: number,
  discountAmount = 0
): FeLine[] {
  const lines: FeLine[] = []
  for (const item of items || []) {
    if (item.choice_group_id && item.selected === false) continue
    const description = [item.description, item.details].map((part) => feText(part || '', 600)).filter(Boolean).join(' - ')
    const quantity = Number(item.quantity) > 0 ? Number(item.quantity) : 1
    lines.push({ description: description || 'Servizio', quantity, unitPrice: Number(item.unit_price) || 0, vatRate })
  }
  if (discountAmount > 0) lines.push({ description: 'Sconto', quantity: 1, unitPrice: -Number(discountAmount), vatRate })
  return lines
}

/** Un incasso IVA compresa diventa una riga netta: la differenza di arrotondamento resta dentro il centesimo. */
export function grossToNetLine(description: string, grossAmount: number, vatRate: number): FeLine {
  const grossCents = toCents(grossAmount)
  const netCents = Math.round(grossCents / (1 + vatRate / 100))
  return { description, quantity: 1, unitPrice: netCents / 100, vatRate }
}
