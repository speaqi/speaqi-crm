import { BrandLockup } from '@/components/layout/BrandLockup'
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
  const canUseStripe = quote.payment_method === 'stripe' || quote.payment_method === 'both'
  const hasBankTransfer = quote.payment_method === 'bank_transfer' || quote.payment_method === 'both'
  const validUntil = formatDate(quote.valid_until)
  const checkoutStatus = params.checkout

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
            <span>Totale offerta</span>
            <strong>{formatMoney(quote.total_amount, quote.currency)}</strong>
            <small>IVA inclusa</small>
          </div>
        </div>

        <div className="public-quote-grid">
          <section className="public-quote-card public-quote-items">
            <h2>Dettaglio offerta</h2>
            <div className="public-quote-item-list">
              {items.map((item) => (
                <article className="public-quote-item" key={item.id || item.description}>
                  <div>
                    <h3>{item.description}</h3>
                    {item.details && (
                      <ul>
                        {String(item.details)
                          .split('\n')
                          .map((detail) => detail.trim())
                          .filter(Boolean)
                          .map((detail) => (
                            <li key={detail}>{detail}</li>
                          ))}
                      </ul>
                    )}
                  </div>
                  <strong>{formatMoney(Number(item.quantity || 0) * Number(item.unit_price || 0), quote.currency)}</strong>
                </article>
              ))}
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
            {quote.contract_terms ? (
              <div className="public-quote-contract-body">{quote.contract_terms}</div>
            ) : (
              <p className="public-quote-muted">Nessun testo contrattuale allegato.</p>
            )}
            <p className="public-quote-muted">
              Accettazione registrata il {formatDate(quote.contract_accepted_at) || 'giorno di emissione'}.
            </p>
          </section>

          <section className="public-quote-card">
            <h2>Bonifico</h2>
            {hasBankTransfer ? (
              quote.bank_transfer_instructions ? (
                <div className="public-quote-bank-body">{quote.bank_transfer_instructions}</div>
              ) : (
                <p className="public-quote-muted">Coordinate bonifico non specificate.</p>
              )
            ) : (
              <p>Pagamento tramite Stripe previsto per questa offerta.</p>
            )}
            {quote.public_note && <p className="public-quote-note">{quote.public_note}</p>}
            {validUntil && <p className="public-quote-muted">Offerta valida fino al {validUntil}.</p>}
          </section>
        </div>
      </section>
    </main>
  )
}
