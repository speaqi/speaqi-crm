import { BrandLockup } from '@/components/layout/BrandLockup'
import { resolvePublicBankInstructions } from '@/lib/quote-defaults'
import { confirmSubscriptionCheckout } from '@/lib/server/quote-payments'
import { createPublicServerClient, createServiceRoleClient } from '@/lib/server/supabase'
import type { Quote, QuoteLineItem } from '@/types'
import { QuoteContractAcceptance } from './QuoteContractAcceptance'
import { QuoteChoiceGroup } from './QuoteChoiceGroup'
import { QuotePaymentActions } from './QuotePaymentActions'
import { QuoteSignatureForm } from './QuoteSignatureForm'

export const dynamic = 'force-dynamic'

type PreventivoPageProps = {
  searchParams: Promise<{
    id?: string
    checkout?: string
    accept?: string
    session_id?: string
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
  return items.filter((item) => !item.choice_group_id || item.selected === true).reduce((sum, item) => {
    const qty = Number(item.quantity || 0)
    const listRaw = item.list_unit_price != null ? Number(item.list_unit_price) : null
    const list = listRaw != null && listRaw > 0 ? listRaw : null
    const unit = Number(item.unit_price || 0)
    return sum + qty * (list ?? unit)
  }, 0)
}

function formatQuantity(value: number) {
  return Number.isInteger(value) ? String(value) : new Intl.NumberFormat('it-IT', { maximumFractionDigits: 2 }).format(value)
}

function lineUnitBreakdownLabel(item: QuoteLineItem, currency: string) {
  const lineNet = Number(item.line_total ?? Number(item.quantity || 0) * Number(item.unit_price || 0))
  if (!Number.isFinite(lineNet) || lineNet <= 0) return null

  const explicitQty = Number(item.quantity || 0)
  if (explicitQty > 1 && Number(item.unit_price || 0) > 0) {
    return `${formatQuantity(explicitQty)} x ${formatMoney(item.unit_price, currency)}`
  }

  const text = `${item.description || ''}\n${item.details || ''}`
  const match = text.match(/\b(\d+(?:[,.]\d+)?)\s+(?:video|vini|unit[aà]|licenze|contenuti|traduzioni)\b/i)
  if (!match) return null

  const qty = Number(match[1].replace(',', '.'))
  if (!Number.isFinite(qty) || qty <= 1) return null

  const unitPrice = lineNet / qty
  return `${formatQuantity(qty)} x ${formatMoney(unitPrice, currency)}`
}

function isQrWasteLine(item: QuoteLineItem) {
  if (item.id === 'speaqi-qr-waste-sheets') return true
  const d = String(item.description || '').toLowerCase()
  return d.includes('schede tecniche qr') && d.includes('rifiuti')
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
  const loadQuote = async () => {
    const { data, error } = await supabase.rpc('get_public_quote', { p_public_token: token })
    return error ? null : ((Array.isArray(data) ? data[0] : null) as Quote | null)
  }
  let loaded = await loadQuote()

  if (!loaded) {
    return <MissingQuote message="Il link non esiste oppure il preventivo è stato annullato." />
  }

  // Ritorno da Stripe prima che arrivi il webhook: la sessione si verifica qui,
  // cosi' il cliente vede subito l'abbonamento attivo. Idempotente, non lancia.
  const sessionId = String(params.session_id || '').trim()
  if (
    loaded.billing_interval === 'year' &&
    params.checkout === 'success' &&
    sessionId &&
    loaded.payment_state !== 'paid'
  ) {
    try {
      if (await confirmSubscriptionCheckout(createServiceRoleClient(), sessionId, token)) {
        loaded = (await loadQuote()) || loaded
      }
    } catch {
      // senza service role la conferma resta al webhook
    }
  }
  const quote: Quote = loaded

  const items = safeItems(quote.items)
  const lockedChoices = quote.status === 'accepted' || quote.status === 'paid' || Boolean(quote.contract_signer_email)
  // Stripe solo per l'abbonamento annuale, e solo dopo la firma. Gli altri
  // preventivi restano a bonifico come prima.
  const isSubscription = quote.billing_interval === 'year'
  const hasSignature = Boolean(quote.has_signature)
  const isPaid = quote.payment_state === 'paid' || quote.status === 'paid'
  const canUseStripe = isSubscription && hasSignature && !isPaid
  const hasBankTransfer = !isSubscription
  const renewalDate = formatDate(quote.current_period_end)
  const validUntil = formatDate(quote.valid_until)
  const checkoutStatus = params.checkout
  const acceptanceToken = String(params.accept || '').trim()
  const bankBody = resolvePublicBankInstructions(quote.bank_transfer_instructions)
  const initialNetTotal = initialListNetTotal(items)
  const hasInitialListTotal = initialNetTotal > Number(quote.subtotal_amount || 0) + 0.005
  const taxRate = Number(quote.tax_rate || 0)
  const totalNet = Number(quote.subtotal_amount || 0)
  const hasCustomPaymentTerms = Boolean(String(quote.payment_terms_note || '').trim())
  const paymentTermsMode = quote.payment_terms_mode === 'manual' ? 'manual' : 'percent'
  const depositPercent = Number(quote.deposit_percent || 0)
  const isManualPaymentTerms = paymentTermsMode === 'manual' || hasCustomPaymentTerms
  const depositNet =
    isManualPaymentTerms
      ? Number(quote.deposit_manual_amount || 0)
      : (totalNet * depositPercent) / 100
  const depositSummaryLabel =
    isManualPaymentTerms ? 'Acconto concordato' : `Acconto ${depositPercent}%`
  const balanceSummaryLabel =
    isManualPaymentTerms ? 'Saldo concordato' : 'Saldo alla consegna'

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
            {isSubscription && isPaid
              ? 'Pagamento ricevuto: l’abbonamento è attivo. Grazie!'
              : 'Pagamento avviato correttamente. Riceverai conferma dal team Speaqi.'}
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
            <h1 className="public-quote-customer-title">{quote.customer_company || quote.customer_name}</h1>
            <p className="public-quote-customer">
              {quote.customer_company && quote.customer_name
                ? quote.customer_name
                : quote.customer_company || quote.customer_name}
            </p>
            <p className="public-quote-offer-title">{quote.title}</p>
          </div>
        </div>

        <div className="public-quote-grid">
          <section className="public-quote-card public-quote-items">
            <h2>Dettaglio offerta</h2>
            <div className="public-quote-item-list">
              {items.map((item) => {
                if (item.choice_group_id) {
                  const groupItems = items.filter((candidate) => candidate.choice_group_id === item.choice_group_id)
                  if (groupItems[0]?.id !== item.id) return null
                  return (
                    <QuoteChoiceGroup
                      key={item.choice_group_id}
                      token={token}
                      items={groupItems}
                      currency={quote.currency}
                      locked={lockedChoices}
                    />
                  )
                }
                const qty = Number(item.quantity || 0)
                const unit = Number(item.unit_price || 0)
                const listUnit = item.list_unit_price != null ? Number(item.list_unit_price) : null
                const lineNet = qty * unit
                const lineList =
                  listUnit != null && Number.isFinite(listUnit) && listUnit > 0 ? qty * listUnit : null
                const showListPrice = lineList != null && lineList > lineNet + 0.005
                const unitBreakdownLabel = lineUnitBreakdownLabel(item, quote.currency)
                const isFreeQrLine = isQrWasteLine(item) && lineNet <= 0

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
                      {unitBreakdownLabel && (
                        <span className="public-quote-price-unit-breakdown">{unitBreakdownLabel}</span>
                      )}
                      {isFreeQrLine ? (
                        <div className="public-quote-price-active">
                          <strong>Gratis</strong>
                        </div>
                      ) : (
                        <div className="public-quote-price-active">
                          <strong>{formatMoney(lineNet, quote.currency)}</strong>
                          <span className="public-quote-price-tax">+ IVA</span>
                        </div>
                      )}
                    </div>
                  </article>
                )
              })}
            </div>
          </section>

          {isSubscription ? (
            <aside className="public-quote-card public-quote-side">
              <h2>Abbonamento annuale</h2>
              <div className="public-quote-price-summary">
                {hasInitialListTotal && (
                  <div className="public-quote-list-total">
                    <span>Prezzo di listino</span>
                    <div>
                      <strong>{formatMoney(initialNetTotal, quote.currency)}</strong>
                      <small>+ IVA / anno</small>
                    </div>
                  </div>
                )}
                <div className="public-quote-final-total">
                  <span>Prezzo per te</span>
                  <div>
                    <strong>{formatMoney(totalNet, quote.currency)}</strong>
                    <small>+ IVA {taxRate}% / anno</small>
                  </div>
                </div>
                <div className="public-quote-due-now">
                  <span>Totale annuo</span>
                  <strong>{formatMoney(quote.total_amount, quote.currency)}</strong>
                  <small>IVA inclusa · rinnovo automatico · solo carta</small>
                </div>
              </div>

              {isPaid ? (
                <div className="public-quote-subscription-active">
                  <strong>Abbonamento attivo</strong>
                  {renewalDate && <span>Prossimo rinnovo: {renewalDate}</span>}
                  {quote.cancel_at_period_end && <span>Disdetta registrata: non si rinnoverà.</span>}
                </div>
              ) : hasSignature ? (
                <QuotePaymentActions
                  token={quote.public_token}
                  canUseStripe={canUseStripe}
                  hasBankTransfer={false}
                  depositLabel={formatMoney(quote.total_amount, quote.currency)}
                  totalLabel={formatMoney(quote.total_amount, quote.currency)}
                  subscriptionLabel={`${formatMoney(quote.total_amount, quote.currency)} / anno`}
                />
              ) : (
                <p className="public-quote-muted">Firma il contratto qui sotto per procedere al pagamento con carta.</p>
              )}

              <p className="public-quote-muted">
                Il pagamento è gestito da Stripe. Ogni anno la carta viene addebitata automaticamente allo stesso prezzo;
                puoi disdire in qualsiasi momento prima del rinnovo scrivendo a info@speaqi.com.
              </p>
            </aside>
          ) : (
            <aside className="public-quote-card public-quote-side">
              <h2>Pagamento</h2>
              <div className="public-quote-price-summary">
                {hasInitialListTotal && (
                  <div className="public-quote-list-total">
                    <span>Prezzo iniziale</span>
                    <div>
                      <strong>{formatMoney(initialNetTotal, quote.currency)}</strong>
                      <small>+ IVA</small>
                    </div>
                  </div>
                )}
                <div className="public-quote-final-total">
                  <span>Prezzo totale</span>
                  <div>
                    <strong>{formatMoney(totalNet, quote.currency)}</strong>
                    <small>+ IVA {taxRate}%</small>
                  </div>
                </div>
                {!isManualPaymentTerms && (
                  <div className="public-quote-due-now">
                    <span>{depositSummaryLabel}</span>
                    <div>
                      <strong>{formatMoney(depositNet, quote.currency)}</strong>
                      <small>+ IVA {taxRate}%</small>
                    </div>
                  </div>
                )}
                {!isManualPaymentTerms && (
                  <div className="public-quote-due-now">
                    <span>Da pagare ora</span>
                    <strong>{formatMoney(quote.deposit_amount, quote.currency)}</strong>
                    <small>IVA inclusa</small>
                  </div>
                )}
              </div>

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
              {!isManualPaymentTerms && (
                <div className="public-quote-money-row main">
                  <span>{depositSummaryLabel}</span>
                  <strong>{formatMoney(quote.deposit_amount, quote.currency)}</strong>
                </div>
              )}
              <div className="public-quote-money-row">
                <span>{balanceSummaryLabel}</span>
                <strong>{formatMoney(quote.balance_amount, quote.currency)}</strong>
              </div>

              {quote.payment_terms_note && (
                <div className="public-quote-payment-terms">
                  <div className="public-quote-payment-terms-title">Condizioni di pagamento</div>
                  <div className="public-quote-payment-terms-body">{quote.payment_terms_note}</div>
                </div>
              )}

              <QuotePaymentActions
                token={quote.public_token}
                canUseStripe={canUseStripe}
                hasBankTransfer={hasBankTransfer}
                depositLabel={formatMoney(quote.deposit_amount, quote.currency)}
                totalLabel={formatMoney(quote.total_amount, quote.currency)}
              />

              {validUntil && (
                <div className="public-quote-urgency">
                  <div className="public-quote-urgency-badge">⏳ Scadenza offerta</div>
                  <div className="public-quote-urgency-date">{validUntil}</div>
                </div>
              )}
            </aside>
          )}
        </div>

        <div className="public-quote-grid lower">
          <section className="public-quote-card">
            <h2>Contratto</h2>
            {isSubscription && hasSignature ? (
              <div>
                <div className="public-quote-contract-badge">Contratto firmato</div>
                <p className="public-quote-contract-email-note">
                  Firmato da <strong>{quote.contract_signer_name || quote.contract_signer_email}</strong>
                  {formatDate(quote.contract_signed_at) ? ` il ${formatDate(quote.contract_signed_at)}` : ''}
                  {quote.contract_signer_email ? ` · conferma inviata a ${quote.contract_signer_email}` : ''}
                </p>
              </div>
            ) : isSubscription && acceptanceToken ? (
              <QuoteSignatureForm
                token={quote.public_token}
                acceptanceToken={acceptanceToken}
                defaultSignerName={quote.customer_name}
                isSubscription
              />
            ) : quote.contract_signer_email ? (
              <QuoteContractAcceptance
                token={quote.public_token}
                acceptanceToken=""
                contractSignerEmail={quote.contract_signer_email}
                acceptedAtLabel={formatDate(quote.contract_accepted_at)}
              />
            ) : acceptanceToken ? (
              <QuoteContractAcceptance
                token={quote.public_token}
                acceptanceToken={acceptanceToken}
                contractSignerEmail={quote.contract_signer_email || null}
                acceptedAtLabel={formatDate(quote.contract_accepted_at)}
              />
            ) : (
              <>
                <p className="public-quote-contract-summary">
                  Questo preventivo è in sola visione. Per accettarlo usa il link personale ricevuto via email.
                </p>
                <p className="public-quote-muted">
                  Se non hai ricevuto l’email, chiedi al team Speaqi di inviarti il link di accettazione.
                </p>
              </>
            )}
            <div style={{ marginTop: 16 }}>
              <div className="public-quote-money-row">
                <span>Indirizzo sede</span>
                <strong>{quote.customer_address || 'Non compilato'}</strong>
              </div>
              <div className="public-quote-money-row">
                <span>CAP</span>
                <strong>{quote.customer_zip || 'Non compilato'}</strong>
              </div>
              <div className="public-quote-money-row">
                <span>Città</span>
                <strong>{quote.customer_city || 'Non compilata'}</strong>
              </div>
              <div className="public-quote-money-row">
                <span>Partita IVA / CF</span>
                <strong>{quote.customer_tax_id || 'Non compilata'}</strong>
              </div>
              <div className="public-quote-money-row">
                <span>PEC</span>
                <strong>{quote.customer_pec || 'Non compilata'}</strong>
              </div>
              <div className="public-quote-money-row">
                <span>Codice SDI</span>
                <strong>{quote.customer_sdi || 'Non compilato'}</strong>
              </div>
            </div>
          </section>

          {isSubscription ? (
            quote.public_note ? (
              <section className="public-quote-card">
                <h2>Note</h2>
                <p className="public-quote-note">{quote.public_note}</p>
              </section>
            ) : null
          ) : (
            <section className="public-quote-card">
              <h2>Bonifico</h2>
              {bankBody ? (
                <div className="public-quote-bank-body">{bankBody}</div>
              ) : (
                <p className="public-quote-muted">Coordinate bonifico non specificate.</p>
              )}
              {quote.public_note && <p className="public-quote-note">{quote.public_note}</p>}
            </section>
          )}
        </div>

        <p className="public-quote-legal-footer">
          Speaqi di TheBestItaly · P.IVA: 10831191217 · C.F.: 95125440636
          <br />
          <a href="mailto:info@speaqi.com" className="public-quote-contact-link">
            Hai domande? Contatta il team Speaqi
          </a>
        </p>
      </section>
    </main>
  )
}
