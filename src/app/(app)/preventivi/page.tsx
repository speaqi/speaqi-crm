'use client'

import Link from 'next/link'
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { DEFAULT_BANK_TRANSFER_INSTRUCTIONS, DEFAULT_CONTRACT_TERMS } from '@/lib/quote-defaults'
import type { CRMContact, Quote, QuoteInput, QuoteLineItem, QuoteStatus } from '@/types'
import { useCRMContext } from '../layout'

type QuoteDraft = Omit<QuoteInput, 'title' | 'customer_name' | 'items'> & {
  title: string
  customer_name: string
  items: QuoteLineItem[]
}

const OFFER_FEATURES = [
  'Video multilingua fino a 1 min',
  'Traduzione fino a 7 lingue',
  'QR dinamico',
  'Accesso piano Premium incluso per 1 anno',
  'Analytics avanzate',
  'Supporto dedicato',
  'Video forniti dal cliente',
].join('\n')

const STATUS_LABELS: Record<QuoteStatus, string> = {
  draft: 'Bozza',
  sent: 'Inviato',
  accepted: 'Accettato',
  paid: 'Pagato',
  cancelled: 'Annullato',
}

function makeLineId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `line-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function blankDraft(): QuoteDraft {
  return {
    contact_id: '',
    status: 'sent',
    title: 'Offerta Speaqi',
    customer_name: '',
    customer_email: '',
    customer_company: '',
    customer_tax_id: '',
    customer_address: '',
    items: [
      {
        id: makeLineId(),
        description: 'Pacchetto video multilingua',
        details: OFFER_FEATURES,
        quantity: 1,
        unit_price: 499.99,
      },
    ],
    discount_amount: 0,
    tax_rate: 22,
    deposit_percent: 30,
    payment_method: 'both',
    bank_transfer_instructions: DEFAULT_BANK_TRANSFER_INSTRUCTIONS,
    contract_terms: DEFAULT_CONTRACT_TERMS,
    valid_until: '',
    public_note: 'Acconto 30%. Saldo alla consegna.',
    internal_note: '',
  }
}

function formatMoney(value: number | string | null | undefined, currency = 'EUR') {
  return new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency,
  }).format(Number(value || 0))
}

function quoteUrl(origin: string, token: string) {
  return `${origin.replace(/\/$/, '')}/preventivo?id=${encodeURIComponent(token)}`
}

function calculateDraftTotals(draft: QuoteDraft) {
  const subtotal = draft.items.reduce(
    (total, item) => total + Math.max(0, Number(item.quantity || 0)) * Math.max(0, Number(item.unit_price || 0)),
    0
  )
  const discount = Math.min(Math.max(0, Number(draft.discount_amount || 0)), subtotal)
  const taxable = Math.max(0, subtotal - discount)
  const tax = taxable * (Math.max(0, Number(draft.tax_rate || 0)) / 100)
  const total = taxable + tax
  const deposit = total * (Math.max(0, Math.min(100, Number(draft.deposit_percent || 0))) / 100)
  return {
    subtotal,
    discount,
    tax,
    total,
    deposit,
    balance: Math.max(0, total - deposit),
  }
}

function contactLabel(contact: CRMContact) {
  return [contact.company, contact.name].filter(Boolean).join(' · ') || contact.name
}

function contactMatchesSearch(contact: CRMContact, query: string) {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const blob = [contact.company, contact.name, contact.email].filter(Boolean).join(' ').toLowerCase()
  return blob.includes(q)
}

export default function PreventiviPage() {
  const { contacts, showToast } = useCRMContext()
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [draft, setDraft] = useState<QuoteDraft>(() => blankDraft())
  const [contactMenuOpen, setContactMenuOpen] = useState(false)
  const [contactQuery, setContactQuery] = useState('')
  const contactComboRef = useRef<HTMLDivElement>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [origin, setOrigin] = useState('https://crm.speaqi.com')

  useEffect(() => {
    setOrigin(window.location.origin)
  }, [])

  useEffect(() => {
    let mounted = true
    setLoading(true)
    apiFetch<{ quotes: Quote[] }>('/api/quotes')
      .then((response) => {
        if (!mounted) return
        setQuotes(response.quotes || [])
        setError(null)
      })
      .catch((loadError) => {
        if (!mounted) return
        setError(loadError instanceof Error ? loadError.message : 'Impossibile caricare i preventivi')
      })
      .finally(() => {
        if (mounted) setLoading(false)
      })

    return () => {
      mounted = false
    }
  }, [])

  const activeQuotes = useMemo(
    () => quotes.filter((quote) => quote.status !== 'cancelled'),
    [quotes]
  )
  const totals = useMemo(() => calculateDraftTotals(draft), [draft])
  const filteredContacts = useMemo(() => {
    const list = contacts.filter((c) => contactMatchesSearch(c, contactQuery))
    return list.slice(0, 100)
  }, [contacts, contactQuery])

  useEffect(() => {
    function onDocMouseDown(event: MouseEvent) {
      if (!contactComboRef.current?.contains(event.target as Node)) {
        setContactMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [])

  function patchDraft(partial: Partial<QuoteDraft>) {
    setDraft((previous) => ({ ...previous, ...partial }))
  }

  function applyPreset(kind: 'vini' | 'bnb') {
    const isVini = kind === 'vini'
    patchDraft({
      title: isVini ? '13 Vini' : '3 B&B',
      items: [
        {
          id: makeLineId(),
          description: isVini ? '13 Vini' : '3 B&B',
          details: OFFER_FEATURES,
          quantity: 1,
          unit_price: isVini ? 1999.99 : 499.99,
        },
      ],
      deposit_percent: 30,
      public_note: 'Acconto 30%. Saldo alla consegna.',
    })
  }

  function handleContactChange(contactId: string) {
    const contact = contacts.find((item) => item.id === contactId) || null
    patchDraft({
      contact_id: contactId,
      customer_name: contact?.name || '',
      customer_email: contact?.email || '',
      customer_company: contact?.company || '',
    })
  }

  function pickCrmContact(contactId: string) {
    if (!contactId) {
      patchDraft({ contact_id: '' })
      setContactQuery('')
    } else {
      handleContactChange(contactId)
      const contact = contacts.find((item) => item.id === contactId)
      setContactQuery(contact ? contactLabel(contact) : '')
    }
    setContactMenuOpen(false)
  }

  function onContactSearchInput(value: string) {
    setContactQuery(value)
    setContactMenuOpen(true)
    if (draft.contact_id) {
      const selected = contacts.find((item) => item.id === draft.contact_id)
      if (selected && contactLabel(selected) !== value) {
        patchDraft({ contact_id: '' })
      }
    }
  }

  function updateItem(id: string, partial: Partial<QuoteLineItem>) {
    patchDraft({
      items: draft.items.map((item) => (item.id === id ? { ...item, ...partial } : item)),
    })
  }

  function addItem() {
    patchDraft({
      items: [
        ...draft.items,
        {
          id: makeLineId(),
          description: '',
          details: '',
          quantity: 1,
          unit_price: 0,
        },
      ],
    })
  }

  function removeItem(id: string) {
    patchDraft({
      items: draft.items.length > 1 ? draft.items.filter((item) => item.id !== id) : draft.items,
    })
  }

  function editQuote(quote: Quote) {
    setEditingId(quote.id)
    const linked = quote.contact_id ? contacts.find((item) => item.id === quote.contact_id) : null
    setContactQuery(linked ? contactLabel(linked) : '')
    setContactMenuOpen(false)
    setDraft({
      contact_id: quote.contact_id || '',
      status: quote.status,
      title: quote.title,
      customer_name: quote.customer_name,
      customer_email: quote.customer_email || '',
      customer_company: quote.customer_company || '',
      customer_tax_id: quote.customer_tax_id || '',
      customer_address: quote.customer_address || '',
      items: quote.items?.length ? quote.items : blankDraft().items,
      discount_amount: quote.discount_amount,
      tax_rate: quote.tax_rate,
      deposit_percent: quote.deposit_percent,
      payment_method: quote.payment_method,
      bank_transfer_instructions: quote.bank_transfer_instructions || '',
      contract_terms: quote.contract_terms || '',
      valid_until: quote.valid_until || '',
      public_note: quote.public_note || '',
      internal_note: quote.internal_note || '',
    })
  }

  function resetForm() {
    setEditingId(null)
    setContactQuery('')
    setContactMenuOpen(false)
    setDraft(blankDraft())
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)

    try {
      const endpoint = editingId ? `/api/quotes/${editingId}` : '/api/quotes'
      const response = await apiFetch<{ quote: Quote }>(endpoint, {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      })

      setQuotes((previous) => {
        const next = [response.quote, ...previous.filter((quote) => quote.id !== response.quote.id)]
        return next.sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())
      })
      showToast(editingId ? 'Preventivo aggiornato' : 'Preventivo generato')
      resetForm()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Impossibile salvare il preventivo')
    } finally {
      setSaving(false)
    }
  }

  async function updateStatus(quote: Quote, status: QuoteStatus) {
    try {
      const response = await apiFetch<{ quote: Quote }>(`/api/quotes/${quote.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      setQuotes((previous) => previous.map((item) => (item.id === quote.id ? response.quote : item)))
      showToast('Stato preventivo aggiornato')
    } catch (statusError) {
      showToast(statusError instanceof Error ? statusError.message : 'Errore aggiornando lo stato')
    }
  }

  async function cancelQuote(quote: Quote) {
    try {
      await apiFetch<{ success: boolean }>(`/api/quotes/${quote.id}`, { method: 'DELETE' })
      setQuotes((previous) =>
        previous.map((item) => (item.id === quote.id ? { ...item, status: 'cancelled' } : item))
      )
      showToast('Preventivo annullato')
    } catch (deleteError) {
      showToast(deleteError instanceof Error ? deleteError.message : 'Errore annullando il preventivo')
    }
  }

  async function copyLink(quote: Quote) {
    const url = quoteUrl(origin, quote.public_token)
    await navigator.clipboard.writeText(url)
    showToast('Link preventivo copiato')
  }

  return (
    <div className="quotes-page">
      <div className="quotes-hero">
        <div>
          <h1>Preventivi online</h1>
          <p>
            Crea offerte con link pubblico, contratto già accettato, acconto 30% e saldo a consegna.
          </p>
        </div>
        <div className="quotes-hero-stats">
          <div>
            <strong>{activeQuotes.length}</strong>
            <span>attivi</span>
          </div>
          <div>
            <strong>{formatMoney(activeQuotes.reduce((sum, quote) => sum + Number(quote.total_amount || 0), 0))}</strong>
            <span>totale offerte</span>
          </div>
        </div>
      </div>

      {error && <div className="inline-error quotes-inline-error">{error}</div>}

      <div className="quotes-layout">
        <form className="quotes-builder" onSubmit={handleSubmit}>
          <div className="quotes-panel-head">
            <div>
              <h2>{editingId ? 'Modifica preventivo' : 'Nuovo preventivo'}</h2>
              <p>Il link cliente resta fuori dall’area CRM.</p>
            </div>
            {editingId && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={resetForm}>
                Annulla modifica
              </button>
            )}
          </div>

          <div className="quotes-preset-row">
            <button type="button" className="quote-preset" onClick={() => applyPreset('vini')}>
              <strong>13 Vini</strong>
              <span>{formatMoney(1999.99)} + IVA</span>
            </button>
            <button type="button" className="quote-preset" onClick={() => applyPreset('bnb')}>
              <strong>3 B&B</strong>
              <span>{formatMoney(499.99)} + IVA</span>
            </button>
          </div>

          <div className="quotes-form-grid">
            <label className="fg quotes-contact-field">
              <span className="fl">Contatto CRM</span>
              <div
                className="quotes-contact-combobox"
                ref={contactComboRef}
              >
                <input
                  type="search"
                  className="fi quotes-contact-search"
                  autoComplete="off"
                  placeholder="Cerca azienda, nome o email…"
                  value={contactQuery}
                  onChange={(event) => onContactSearchInput(event.target.value)}
                  onFocus={() => setContactMenuOpen(true)}
                  aria-expanded={contactMenuOpen}
                  aria-autocomplete="list"
                  aria-controls="quotes-contact-listbox"
                />
                {contactMenuOpen && (
                  <ul className="quotes-contact-dropdown" id="quotes-contact-listbox" role="listbox">
                    <li>
                      <button
                        type="button"
                        className={`quotes-contact-option${!draft.contact_id ? ' selected' : ''}`}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => pickCrmContact('')}
                      >
                        {!draft.contact_id ? '✓ ' : ''}
                        Preventivo manuale
                      </button>
                    </li>
                    {filteredContacts.length === 0 ? (
                      <li className="quotes-contact-empty">Nessun contatto corrisponde.</li>
                    ) : (
                      filteredContacts.map((contact) => {
                        const label = contactLabel(contact)
                        const selected = draft.contact_id === contact.id
                        return (
                          <li key={contact.id}>
                            <button
                              type="button"
                              className={`quotes-contact-option${selected ? ' selected' : ''}`}
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => pickCrmContact(contact.id)}
                            >
                              {selected ? '✓ ' : ''}
                              {label}
                            </button>
                          </li>
                        )
                      })
                    )}
                  </ul>
                )}
              </div>
            </label>
            <label className="fg">
              <span className="fl">Titolo offerta</span>
              <input
                className="fi"
                value={draft.title}
                onChange={(event) => patchDraft({ title: event.target.value })}
                required
              />
            </label>
            <label className="fg">
              <span className="fl">Cliente</span>
              <input
                className="fi"
                value={draft.customer_name}
                onChange={(event) => patchDraft({ customer_name: event.target.value })}
                required
              />
            </label>
            <label className="fg">
              <span className="fl">Email</span>
              <input
                className="fi"
                type="email"
                value={draft.customer_email || ''}
                onChange={(event) => patchDraft({ customer_email: event.target.value })}
              />
            </label>
            <label className="fg">
              <span className="fl">Azienda</span>
              <input
                className="fi"
                value={draft.customer_company || ''}
                onChange={(event) => patchDraft({ customer_company: event.target.value })}
              />
            </label>
            <label className="fg">
              <span className="fl">P. IVA / CF</span>
              <input
                className="fi"
                value={draft.customer_tax_id || ''}
                onChange={(event) => patchDraft({ customer_tax_id: event.target.value })}
              />
            </label>
          </div>

          <div className="quote-lines">
            <div className="quotes-section-title">
              <span>Righe offerta</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={addItem}>
                + Riga
              </button>
            </div>
            {draft.items.map((item) => (
              <div className="quote-line" key={item.id}>
                <div className="quote-line-main">
                  <input
                    className="fi"
                    placeholder="Descrizione"
                    value={item.description}
                    onChange={(event) => updateItem(item.id || '', { description: event.target.value })}
                    required
                  />
                  <textarea
                    className="fi"
                    rows={3}
                    placeholder="Dettagli inclusi"
                    value={item.details || ''}
                    onChange={(event) => updateItem(item.id || '', { details: event.target.value })}
                  />
                </div>
                <div className="quote-line-numbers">
                  <input
                    className="fi"
                    type="number"
                    min="0"
                    step="0.01"
                    value={item.quantity}
                    onChange={(event) => updateItem(item.id || '', { quantity: Number(event.target.value) })}
                    aria-label="Quantità"
                  />
                  <input
                    className="fi"
                    type="number"
                    min="0"
                    step="0.01"
                    value={item.unit_price}
                    onChange={(event) => updateItem(item.id || '', { unit_price: Number(event.target.value) })}
                    aria-label="Prezzo unitario"
                  />
                  <button type="button" className="icon-btn quote-remove" onClick={() => removeItem(item.id || '')}>
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="quotes-form-grid quotes-money-grid">
            <label className="fg">
              <span className="fl">Sconto</span>
              <input
                className="fi"
                type="number"
                min="0"
                step="0.01"
                value={draft.discount_amount || 0}
                onChange={(event) => patchDraft({ discount_amount: Number(event.target.value) })}
              />
            </label>
            <label className="fg">
              <span className="fl">IVA %</span>
              <input
                className="fi"
                type="number"
                min="0"
                step="0.01"
                value={draft.tax_rate || 0}
                onChange={(event) => patchDraft({ tax_rate: Number(event.target.value) })}
              />
            </label>
            <label className="fg">
              <span className="fl">Acconto %</span>
              <input
                className="fi"
                type="number"
                min="0"
                max="100"
                step="1"
                value={draft.deposit_percent || 0}
                onChange={(event) => patchDraft({ deposit_percent: Number(event.target.value) })}
              />
            </label>
            <label className="fg">
              <span className="fl">Pagamento</span>
              <select
                className="fi"
                value={draft.payment_method || 'bank_transfer'}
                onChange={(event) => patchDraft({ payment_method: event.target.value as QuoteDraft['payment_method'] })}
              >
                <option value="bank_transfer">Bonifico</option>
                <option value="stripe">Stripe</option>
                <option value="both">Stripe + bonifico</option>
              </select>
            </label>
          </div>

          <label className="fg">
            <span className="fl">Coordinate / istruzioni bonifico</span>
            <textarea
              className="fi"
              rows={2}
              value={draft.bank_transfer_instructions || ''}
              onChange={(event) => patchDraft({ bank_transfer_instructions: event.target.value })}
            />
          </label>
          <label className="fg">
            <span className="fl">Nota pubblica</span>
            <textarea
              className="fi"
              rows={2}
              value={draft.public_note || ''}
              onChange={(event) => patchDraft({ public_note: event.target.value })}
            />
          </label>

          <div className="quotes-summary-strip">
            <span>Subtotale {formatMoney(totals.subtotal)}</span>
            <span>IVA {formatMoney(totals.tax)}</span>
            <strong>Totale {formatMoney(totals.total)}</strong>
            <strong>Acconto {formatMoney(totals.deposit)}</strong>
          </div>

          <button className="btn btn-primary quotes-submit" disabled={saving} type="submit">
            {saving ? 'Salvataggio…' : editingId ? 'Aggiorna preventivo' : 'Genera preventivo'}
          </button>
        </form>

        <section className="quotes-list-panel">
          <div className="quotes-panel-head">
            <div>
              <h2>Offerte generate</h2>
              <p>{loading ? 'Caricamento…' : `${activeQuotes.length} preventivi visibili`}</p>
            </div>
          </div>

          <div className="quotes-list">
            {!loading && activeQuotes.length === 0 && (
              <div className="quotes-empty">Nessun preventivo generato.</div>
            )}
            {activeQuotes.map((quote) => {
              const url = quoteUrl(origin, quote.public_token)
              return (
                <article key={quote.id} className="quote-card">
                  <div className="quote-card-top">
                    <div>
                      <div className="quote-number">{quote.quote_number}</div>
                      <h3>{quote.title}</h3>
                      <p>{quote.customer_company || quote.customer_name}</p>
                    </div>
                    <strong>{formatMoney(quote.total_amount, quote.currency)}</strong>
                  </div>

                  <div className="quote-card-meta">
                    <span>Acconto {formatMoney(quote.deposit_amount, quote.currency)}</span>
                    <span>Saldo {formatMoney(quote.balance_amount, quote.currency)}</span>
                    <span>{quote.payment_method === 'both' ? 'Stripe + bonifico' : quote.payment_method === 'stripe' ? 'Stripe' : 'Bonifico'}</span>
                  </div>

                  <div className="quote-card-url">{url}</div>

                  <div className="quote-card-actions">
                    <select
                      className="fi quote-status-select"
                      value={quote.status}
                      onChange={(event) => updateStatus(quote, event.target.value as QuoteStatus)}
                    >
                      {Object.entries(STATUS_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => editQuote(quote)}>
                      Modifica
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => copyLink(quote)}>
                      Copia link
                    </button>
                    <Link className="btn btn-primary btn-sm" href={url} target="_blank">
                      Apri
                    </Link>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => cancelQuote(quote)}>
                      Annulla
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
        </section>
      </div>
    </div>
  )
}
