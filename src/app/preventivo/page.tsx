import Link from 'next/link'
import { BrandLockup } from '@/components/layout/BrandLockup'
import { resolvePublicBankInstructions } from '@/lib/quote-defaults'
import { createPublicServerClient } from '@/lib/server/supabase'
import type { Quote, QuoteLineItem } from '@/types'
import { QuotePaymentActions } from './QuotePaymentActions'

export const dynamic = 'force-dynamic'

type PreventivoPageProps = {
  searchParams: Promise<{
    id?: string
    checkout?: string
  }>
}

function formatMoney(value: number | string | null | undefined, currency = 'EUR') {
  return new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency,
  }).format(Number(value || 0))
}

function formatDate(value?: string | null) {
  if (!value) return null
  return new Date(value).toLocaleDateString('it-IT', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })
}

function safeItems(value: unknown): QuoteLineItem[] {
  return Array.isArray(value) ? (value as QuoteLineItem[]) : []
}

/** Somma imponibile di listino (o prezzo unitario se listino assente) per riga — coerente con le righe + IVA. */
function initialListNetTotal(items: QuoteLineItem[]) {
  return items.reduce((sum, item) => {
    const qty = Number(item.quantity || 0)
    const listRaw = item.list_unit_price != null ? Number(item.list_unit_price) : null
    const list = listRaw != null && listRaw > 0 ? listRaw : null
    const unit = Number(item.unit_price || 0)
    return sum + qty * (list ?? unit)
  }, 0)
}

function publicLineHeading(description: string) {
  return description
    .replace(/\s*—\s*accesso 12 mesi\s*\(listino[^)]*\)/i, '')
    .trim()
}

function MissingQuote({ message }: { message: string }) {
  return (
    <main className="public-quote-page">
      <section className="public-quote-shell public-quote-missing">
        <BrandLockup tone="light" size="hero" centered />
        <h1>Preventivo non disponibile</h1>
        <p>{message}</p>
      </section>
    </main>
  )
}

export default async function PreventivoPage({ searchParams }: PreventivoPageProps) {
  const params = await searchParams
  const token = String(params.id || '').trim()

  if (!token) {
    return <MissingQuote message="Apri il link completo ricevuto dal team Speaqi." />
  }

  const supabase = createPublicServerClient()
  const { data, error } = await supabase.rpc('get_public_quote', { p_public_token: token })
  const quote = (Array.isArray(data) ? data[0] : null) as Quote | null

  if (error || !quote) {
    return <MissingQuote message="Il link non esiste oppure il preventivo è stato annullato." />
  }

  const items = safeItems(quote.items)
  const canUseStripe = false
  const hasBankTransfer = true
  const validUntil = formatDate(quote.valid_until)
  const checkoutStatus = params.checkout
  const bankBody = resolvePublicBankInstructions(quote.bank_transfer_instructions)
  const heroInitialNet = initialListNetTotal(items)

  return (
    <main className="public-quote-page">
      <section className="public-quote-shell">
        <header className="public-quote-header">
          <BrandLockup tone="light" size="hero" />
          <div className="public-quote-number">
            <span>Preventivo</span>
            <strong>{quote.quote_number}</strong>
          </div>
        </header>

        {checkoutStatus === 'success' && (
          <div className="public-quote-success">
            Pagamento avviato correttamente. Riceverai conferma dal team Speaqi.
          </div>
        )}
        {checkoutStatus === 'cancelled' && (
          <div className="public-quote-error">
            Pagamento non completato. Puoi riprovare o procedere con bonifico.
          </div>
        )}

        <div className="public-quote-hero">
          <div>
            <p className="public-quote-kicker">Offerta commerciale</p>
            <h1>{quote.title}</h1>
            <p className="public-quote-customer">
              {quote.customer_company || quote.customer_name}
              {quote.customer_company && quote.customer_name ? ` · ${quote.customer_name}` : ''}
            </p>
          </div>
          <div className="public-quote-total">
            <span>Prezzo totale iniziale</span>
            <strong>{formatMoney(heroInitialNet, quote.currency)}</strong>
            <small>+ IVA</small>
          </div>
        </div>

        <div className="public-quote-grid">
          <section className="public-quote-card public-quote-items">
            <h2>Dettaglio offerta</h2>
            <div className="public-quote-item-list">
              {items.map((item) => {
                const qty = Number(item.quantity || 0)
                const unit = Number(item.unit_price || 0)
                const listUnit = item.list_unit_price != null ? Number(item.list_unit_price) : null
                const lineNet = qty * unit
                const lineList =
                  listUnit != null && Number.isFinite(listUnit) && listUnit > 0 ? qty * listUnit : null
                const showListPrice = lineList != null && lineList > lineNet + 0.005

                return (
                  <article className="public-quote-item" key={item.id || item.description}>
                    <div>
                      <h3>{publicLineHeading(item.description)}</h3>
                      {item.details && (
                        <ul>
                          {String(item.details)
                            .split('\n')
                            .map((line) => line.trim())
                            .filter(Boolean)
                            .map((line, index) => {
                              const isBullet = line.startsWith('•') || /^-\s/.test(line)
                              const text = isBullet ? line.replace(/^[•-]\s*/, '') : line
                              return (
                                <li
                                  key={`${item.id || index}-${index}`}
                                  className={isBullet ? undefined : 'public-quote-li-plain'}
                                >
                                  {text}
                                </li>
                              )
                            })}
                        </ul>
                      )}
                    </div>
                    <div className="public-quote-item-prices">
                      {showListPrice && lineList != null && (
                        <span className="public-quote-price-was">{formatMoney(lineList, quote.currency)}</span>
                      )}
                      <div className="public-quote-price-active">
                        <strong>{formatMoney(lineNet, quote.currency)}</strong>
                        <span className="public-quote-price-tax">+ IVA</span>
                      </div>
                    </div>
                  </article>
                )
              })}
            </div>
          </section>

          <aside className="public-quote-card public-quote-side">
            <h2>Pagamento</h2>
            <div className="public-quote-money-row">
              <span>Subtotale</span>
              <strong>{formatMoney(quote.subtotal_amount, quote.currency)}</strong>
            </div>
            {Number(quote.discount_amount || 0) > 0 && (
              <div className="public-quote-money-row">
                <span>Sconto</span>
                <strong>-{formatMoney(quote.discount_amount, quote.currency)}</strong>
              </div>
            )}
            <div className="public-quote-money-row">
              <span>IVA {Number(quote.tax_rate || 0)}%</span>
              <strong>{formatMoney(quote.tax_amount, quote.currency)}</strong>
            </div>
            <div className="public-quote-money-row main">
              <span>Acconto {Number(quote.deposit_percent || 0)}%</span>
              <strong>{formatMoney(quote.deposit_amount, quote.currency)}</strong>
            </div>
            <div className="public-quote-money-row">
              <span>Saldo alla consegna</span>
              <strong>{formatMoney(quote.balance_amount, quote.currency)}</strong>
            </div>

            <QuotePaymentActions
              token={quote.public_token}
              canUseStripe={canUseStripe}
              hasBankTransfer={hasBankTransfer}
              depositLabel={formatMoney(quote.deposit_amount, quote.currency)}
              totalLabel={formatMoney(quote.total_amount, quote.currency)}
            />
          </aside>
        </div>

        <div className="public-quote-grid lower">
          <section className="public-quote-card">
            <h2>Contratto</h2>
            <div className="public-quote-contract-badge">Contratto accettato</div>
            <p className="public-quote-contract-summary">
              Con la presente offerta, l’accettazione del pagamento da parte del Cliente — inclusi acconto, saldo o
              importo totale, effettuati tramite bonifico — comporta anche l’accettazione integrale delle
              condizioni contrattuali stabilite nei{' '}
              <Link href="/termini-speaqi" target="_blank" rel="noopener noreferrer">
                Termini di servizio Speaqi
              </Link>
              .
            </p>
            <p className="public-quote-muted">
              Accettazione registrata il {formatDate(quote.contract_accepted_at) || 'giorno di emissione'}.
            </p>
          </section>

          <section className="public-quote-card">
            <h2>Bonifico</h2>
            {bankBody ? (
              <div className="public-quote-bank-body">{bankBody}</div>
            ) : (
              <p className="public-quote-muted">Coordinate bonifico non specificate.</p>
            )}
            {quote.public_note && <p className="public-quote-note">{quote.public_note}</p>}
            {validUntil && <p className="public-quote-muted">Offerta valida fino al {validUntil}.</p>}
          </section>
        </div>

        <p className="public-quote-legal-footer">
          Speaqi di TheBestItaly · P.IVA: 10831191217 · C.F.: 95125440636
        </p>
      </section>
    </main>
  )
}
