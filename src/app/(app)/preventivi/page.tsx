'use client'

import Link from 'next/link'
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { DEFAULT_BANK_TRANSFER_INSTRUCTIONS, DEFAULT_CONTRACT_TERMS } from '@/lib/quote-defaults'
import {
  SPEAQI_PACKAGES,
  quoteLineFromPackage,
  type SpeaqiPackageKey,
} from '@/lib/speaqi-quote-packages'
import type {
  CRMContact,
  Quote,
  QuoteInput,
  QuoteLineItem,
  QuotePaymentTermsMode,
  QuoteStatus,
} from '@/types'
import { useCRMContext } from '../layout'

type QuoteDraft = Omit<QuoteInput, 'title' | 'customer_name' | 'items'> & {
  title: string
  customer_name: string
  items: QuoteLineItem[]
}

const PACKAGE_KEYS = Object.keys(SPEAQI_PACKAGES) as SpeaqiPackageKey[]

const STATUS_LABELS: Record<QuoteStatus, string> = {
  draft: 'Bozza',
  sent: 'Inviato',
  accepted: 'Accettato',
  paid: 'Pagato',
  cancelled: 'Annullato',
}

const DEFAULT_QUOTE_TITLE = 'Offerta Speaqi'
const DEFAULT_PUBLIC_NOTE = 'Acconto 30%. Saldo alla consegna.'
const PRO_PLAN_LINE_ID = 'speaqi-pro-plan-option'
const QR_WASTE_LINE_ID = 'speaqi-qr-waste-sheets'
const PRO_PLAN_DETAILS =
  'Nella presente offerta: primo anno incluso a €0. Dal secondo anno il servizio è facoltativo: il Cliente può scegliere se rinnovare o meno il Piano PRO al prezzo di listino (€299/anno + IVA).'

function makeProPlanLine(): QuoteLineItem {
  return {
    id: PRO_PLAN_LINE_ID,
    description: 'Piano PRO Speaqi',
    details: PRO_PLAN_DETAILS,
    quantity: 1,
    unit_price: 0,
  }
}

function makeQrWasteLine(bottleCount: number): QuoteLineItem {
  const quantity = Math.max(1, Math.round(Number(bottleCount || 1)))
  return {
    id: QR_WASTE_LINE_ID,
    description: 'Schede tecniche QR rifiuti per bottiglie',
    details:
      'Schede tecniche con QR code per informazioni ambientali e smaltimento rifiuti, da applicare sulle bottiglie. Incluse gratuitamente nel progetto.',
    quantity,
    unit_price: 0,
  }
}

function isProPlanLine(item: QuoteLineItem) {
  if (item.id === PRO_PLAN_LINE_ID) return true
  const d = String(item.description || '')
  return d.includes('Piano PRO') && d.includes('Speaqi')
}

function isQrWasteLine(item: QuoteLineItem) {
  if (item.id === QR_WASTE_LINE_ID) return true
  const d = String(item.description || '').toLowerCase()
  return d.includes('schede tecniche qr') && d.includes('rifiuti')
}

function normalizeItemsProIds(items: QuoteLineItem[]): QuoteLineItem[] {
  return items.map((item) => {
    if (isProPlanLine(item)) return { ...item, id: PRO_PLAN_LINE_ID, details: PRO_PLAN_DETAILS }
    if (isQrWasteLine(item)) return { ...item, id: QR_WASTE_LINE_ID }
    return item
  })
}

function makeLineId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `line-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function blankDraft(): QuoteDraft {
  return {
    contact_id: '',
    status: 'sent',
    title: DEFAULT_QUOTE_TITLE,
    customer_name: '',
    customer_email: '',
    customer_company: '',
    customer_tax_id: '',
    customer_pec: '',
    customer_sdi: '',
    customer_address: '',
    customer_zip: '',
    customer_city: '',
    items: [],
    discount_amount: 0,
    tax_rate: 22,
    payment_terms_mode: 'percent',
    deposit_percent: 30,
    deposit_manual_amount: null,
    payment_method: 'both',
    payment_terms_note: '',
    bank_transfer_instructions: DEFAULT_BANK_TRANSFER_INSTRUCTIONS,
    contract_terms: DEFAULT_CONTRACT_TERMS,
    valid_until: '',
    public_note: DEFAULT_PUBLIC_NOTE,
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
  const paymentTermsMode = draft.payment_terms_mode === 'manual' ? 'manual' : 'percent'
  const depositNet =
    paymentTermsMode === 'manual'
      ? Math.min(Math.max(0, Number(draft.deposit_manual_amount || 0)), taxable)
      : taxable * (Math.max(0, Math.min(100, Number(draft.deposit_percent || 0))) / 100)
  const depositPercent = taxable > 0 ? (depositNet / taxable) * 100 : 0
  const deposit = depositNet + depositNet * (Math.max(0, Number(draft.tax_rate || 0)) / 100)
  return {
    subtotal,
    discount,
    tax,
    total,
    depositNet,
    depositPercent,
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
  const blob = [
    contact.company,
    contact.name,
    contact.email,
    contact.billing_tax_id,
    contact.billing_pec,
    contact.billing_sdi,
    contact.billing_address,
    contact.billing_zip,
    contact.billing_city,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
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
  const [sendingQuoteId, setSendingQuoteId] = useState<string | null>(null)
  const [qrBottleCount, setQrBottleCount] = useState(1)
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

  function setPaymentTermsMode(mode: QuotePaymentTermsMode) {
    setDraft((previous) => {
      const currentTotals = calculateDraftTotals(previous)
      return {
        ...previous,
        payment_terms_mode: mode,
        deposit_manual_amount:
          mode === 'manual'
            ? previous.deposit_manual_amount != null
              ? previous.deposit_manual_amount
              : Number(currentTotals.depositNet.toFixed(2))
            : null,
      }
    })
  }

  function applyPreset(key: SpeaqiPackageKey) {
    const p = SPEAQI_PACKAGES[key]
    setDraft((previous) => {
      const regularItems = previous.items.filter((item) => !isProPlanLine(item))
      const proItems = previous.items.filter(isProPlanLine)
      const shouldUsePackageTitle =
        regularItems.length === 0 && previous.title.trim() === DEFAULT_QUOTE_TITLE

      return {
        ...previous,
        title: shouldUsePackageTitle ? p.quoteTitle : previous.title,
        items: [...regularItems, quoteLineFromPackage(key, makeLineId()), ...proItems],
        deposit_percent: previous.deposit_percent || 30,
        public_note: previous.public_note || DEFAULT_PUBLIC_NOTE,
      }
    })
  }

  function handleContactChange(contactId: string) {
    const contact = contacts.find((item) => item.id === contactId) || null
    patchDraft({
      contact_id: contactId,
      customer_name: contact?.name || '',
      customer_email: contact?.email || '',
      customer_company: contact?.company || '',
      customer_tax_id: contact?.billing_tax_id || '',
      customer_pec: contact?.billing_pec || '',
      customer_sdi: contact?.billing_sdi || '',
      customer_address: contact?.billing_address || '',
      customer_zip: contact?.billing_zip || '',
      customer_city: contact?.billing_city || '',
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
      items: draft.items.filter((item) => item.id !== id),
    })
  }

  function moveItem(id: string, direction: 'up' | 'down') {
    setDraft((previous) => {
      const index = previous.items.findIndex((item) => item.id === id)
      if (index < 0) return previous

      const targetIndex = direction === 'up' ? index - 1 : index + 1
      if (targetIndex < 0 || targetIndex >= previous.items.length) return previous

      const items = [...previous.items]
      const [moved] = items.splice(index, 1)
      items.splice(targetIndex, 0, moved)

      return {
        ...previous,
        items,
      }
    })
  }

  function setIncludeProPlan(include: boolean) {
    const has = draft.items.some(isProPlanLine)
    if (include && !has) {
      patchDraft({ items: [...draft.items, makeProPlanLine()] })
      return
    }
    if (!include && has) {
      patchDraft({ items: draft.items.filter((item) => !isProPlanLine(item)) })
    }
  }

  function setQrWasteSheets(count: number) {
    const quantity = Math.max(1, Math.round(Number(count || 1)))
    setQrBottleCount(quantity)
    setDraft((previous) => {
      const has = previous.items.some(isQrWasteLine)
      const nextLine = makeQrWasteLine(quantity)
      return {
        ...previous,
        items: has
          ? previous.items.map((item) => (isQrWasteLine(item) ? nextLine : item))
          : [...previous.items, nextLine],
      }
    })
  }

  function removeQrWasteSheets() {
    setDraft((previous) => ({
      ...previous,
      items: previous.items.filter((item) => !isQrWasteLine(item)),
    }))
  }

  function editQuote(quote: Quote) {
    setEditingId(quote.id)
    const linked = quote.contact_id ? contacts.find((item) => item.id === quote.contact_id) : null
    const normalizedItems = quote.items?.length ? normalizeItemsProIds(quote.items) : blankDraft().items
    const qrLine = normalizedItems.find(isQrWasteLine)
    setContactQuery(linked ? contactLabel(linked) : '')
    setContactMenuOpen(false)
    setQrBottleCount(Math.max(1, Math.round(Number(qrLine?.quantity || 1))))
    setDraft({
      contact_id: quote.contact_id || '',
      status: quote.status,
      title: quote.title,
      customer_name: quote.customer_name,
      customer_email: quote.customer_email || '',
      customer_company: quote.customer_company || '',
      customer_tax_id: quote.customer_tax_id || '',
      customer_pec: quote.customer_pec || '',
      customer_sdi: quote.customer_sdi || '',
      customer_address: quote.customer_address || '',
      customer_zip: quote.customer_zip || '',
      customer_city: quote.customer_city || '',
      items: normalizedItems,
      discount_amount: quote.discount_amount,
      tax_rate: quote.tax_rate,
      payment_terms_mode: quote.payment_terms_mode || 'percent',
      deposit_percent: quote.deposit_percent,
      deposit_manual_amount: quote.deposit_manual_amount ?? null,
      payment_method: quote.payment_method,
      payment_terms_note: quote.payment_terms_note || '',
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
    setQrBottleCount(1)
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
    showToast('Link di visione copiato')
  }

  async function sendAcceptanceEmail(quote: Quote) {
    const recipient = String(quote.customer_email || '').trim()
    if (!recipient) {
      showToast('Imposta un’email cliente prima di inviare')
      return
    }

    setSendingQuoteId(quote.id)
    try {
      const response = await apiFetch<{
        success: boolean
        sent_at: string
        quote_acceptance_email: string
      }>(`/api/quotes/${quote.id}/send-acceptance-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: recipient }),
      })

      setQuotes((previous) =>
        previous.map((item) =>
          item.id === quote.id
            ? {
                ...item,
                status: item.status === 'draft' ? 'sent' : item.status,
                sent_at: response.sent_at,
                customer_email: response.quote_acceptance_email,
                quote_acceptance_email: response.quote_acceptance_email,
                quote_acceptance_sent_at: response.sent_at,
              }
            : item
        )
      )
      showToast(`Email preventivo inviata a ${response.quote_acceptance_email}`)
    } catch (sendError) {
      showToast(sendError instanceof Error ? sendError.message : 'Errore invio preventivo')
    } finally {
      setSendingQuoteId(null)
    }
  }

  return (
    <div className="quotes-page">
      <div className="quotes-hero">
        <div>
          <h1>Preventivi</h1>
          <p>
            Crea offerte con link pubblico, accettazione contratto con conferma email, acconto 30% e saldo a consegna.
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
            {PACKAGE_KEYS.map((key) => {
              const p = SPEAQI_PACKAGES[key]
              return (
                <button key={key} type="button" className="quote-preset" onClick={() => applyPreset(key)}>
                  <span className="quote-preset-name">{p.label}</span>
                  <span className="quote-preset-sub">{p.subtitle}</span>
                  <span className="quote-preset-tagline">{p.tagline}</span>
                  <span className="quote-preset-prices">
                    <span className="quote-preset-was">{formatMoney(p.list_unit_price)}</span>
                    <span className="quote-preset-now">{formatMoney(p.unit_price)} + IVA</span>
                  </span>
                </button>
              )
            })}
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
              <span className="fl">Indirizzo sede</span>
              <input
                className="fi"
                value={draft.customer_address || ''}
                onChange={(event) => patchDraft({ customer_address: event.target.value })}
                placeholder="Via, numero civico"
              />
            </label>
            <label className="fg">
              <span className="fl">CAP</span>
              <input
                className="fi"
                value={draft.customer_zip || ''}
                onChange={(event) => patchDraft({ customer_zip: event.target.value })}
                placeholder="Es. 20100"
              />
            </label>
            <label className="fg">
              <span className="fl">Città</span>
              <input
                className="fi"
                value={draft.customer_city || ''}
                onChange={(event) => patchDraft({ customer_city: event.target.value })}
                placeholder="Es. Milano"
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
            <label className="fg">
              <span className="fl">PEC</span>
              <input
                className="fi"
                type="email"
                value={draft.customer_pec || ''}
                onChange={(event) => patchDraft({ customer_pec: event.target.value })}
              />
            </label>
            <label className="fg">
              <span className="fl">Codice SDI</span>
              <input
                className="fi"
                value={draft.customer_sdi || ''}
                onChange={(event) => patchDraft({ customer_sdi: event.target.value })}
                placeholder="Es. ABCD123"
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
            {draft.items.map((item, index) => (
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
                  <div className="quote-line-order">
                    <button
                      type="button"
                      className="icon-btn quote-move"
                      onClick={() => moveItem(item.id || '', 'up')}
                      disabled={index === 0}
                      aria-label="Sposta riga in alto"
                      title="Sposta in alto"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="icon-btn quote-move"
                      onClick={() => moveItem(item.id || '', 'down')}
                      disabled={index === draft.items.length - 1}
                      aria-label="Sposta riga in basso"
                      title="Sposta in basso"
                    >
                      ↓
                    </button>
                  </div>
                  <input
                    className="fi"
                    type="number"
                    min="0"
                    step="0.01"
                    value={item.quantity}
                    onChange={(event) => updateItem(item.id || '', { quantity: Number(event.target.value) })}
                    aria-label="Quantità"
                    title="Quantità"
                  />
                  <input
                    className="fi"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Listino"
                    value={item.list_unit_price != null && item.list_unit_price > 0 ? item.list_unit_price : ''}
                    onChange={(event) => {
                      const v = event.target.value
                      updateItem(item.id || '', {
                        list_unit_price: v === '' ? null : Math.max(0, Number(v)),
                      })
                    }}
                    aria-label="Prezzo di listino unitario (opzionale)"
                    title="Listino unitario (opzionale, prima dello sconto)"
                  />
                  <input
                    className="fi"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Prezzo"
                    value={item.unit_price}
                    onChange={(event) => updateItem(item.id || '', { unit_price: Number(event.target.value) })}
                    aria-label="Prezzo unitario in offerta"
                    title="Prezzo unitario (offerta)"
                  />
                  <button type="button" className="icon-btn quote-remove" onClick={() => removeItem(item.id || '')}>
                    ×
                  </button>
                </div>
              </div>
            ))}
            <label className="quotes-pro-opt">
              <input
                type="checkbox"
                checked={draft.items.some(isProPlanLine)}
                onChange={(event) => setIncludeProPlan(event.target.checked)}
              />
              <span>
                Includi Piano PRO (1° anno a €0, secondo anno facoltativo a €299/anno + IVA)
              </span>
            </label>

            <div className="quotes-extra-card">
              <div>
                <strong>Schede tecniche QR rifiuti</strong>
                <span>QR code tecnici per le schede da applicare sulle bottiglie. Sempre gratis.</span>
              </div>
              <div className="quotes-extra-controls">
                <label className="fg">
                  <span className="fl">Bottiglie</span>
                  <input
                    className="fi"
                    type="number"
                    min="1"
                    step="1"
                    value={qrBottleCount}
                    onChange={(event) => setQrBottleCount(Math.max(1, Math.round(Number(event.target.value || 1))))}
                  />
                </label>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setQrWasteSheets(qrBottleCount)}
                >
                  {draft.items.some(isQrWasteLine) ? 'Aggiorna gratis' : 'Aggiungi gratis'}
                </button>
                {draft.items.some(isQrWasteLine) && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={removeQrWasteSheets}>
                    Rimuovi
                  </button>
                )}
              </div>
            </div>
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
              <span className="fl">Condizioni pagamento</span>
              <select
                className="fi"
                value={draft.payment_terms_mode || 'percent'}
                onChange={(event) => setPaymentTermsMode(event.target.value as QuotePaymentTermsMode)}
              >
                <option value="percent">Acconto %</option>
                <option value="manual">Acconto manuale</option>
              </select>
            </label>
            <label className="fg">
              <span className="fl">
                {draft.payment_terms_mode === 'manual' ? 'Acconto imponibile' : 'Acconto %'}
              </span>
              {draft.payment_terms_mode === 'manual' ? (
                <input
                  className="fi"
                  type="number"
                  min="0"
                  step="0.01"
                  value={draft.deposit_manual_amount ?? 0}
                  onChange={(event) => patchDraft({ deposit_manual_amount: Number(event.target.value) })}
                />
              ) : (
                <input
                  className="fi"
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  value={draft.deposit_percent || 0}
                  onChange={(event) => patchDraft({ deposit_percent: Number(event.target.value) })}
                />
              )}
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
            <span className="fl">Condizioni di pagamento</span>
            <textarea
              className="fi"
              rows={4}
              value={draft.payment_terms_note || ''}
              onChange={(event) => patchDraft({ payment_terms_note: event.target.value })}
              placeholder={
                'Es.\n- Acconto: € 375 + IVA all’accettazione del progetto\n- Saldo: € 2.850 + IVA alla consegna dei materiali definitivi'
              }
            />
          </label>
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
            <strong>
              Acconto{' '}
              {draft.payment_terms_mode === 'manual'
                ? formatMoney(totals.deposit)
                : `${Math.round(totals.depositPercent)}% · ${formatMoney(totals.deposit)}`}
            </strong>
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
                  <div className="quote-card-email-state">
                    {quote.contract_signer_email ? (
                      <span className="quote-card-email-state-ok">Accettato da {quote.contract_signer_email}</span>
                    ) : quote.quote_acceptance_sent_at && quote.quote_acceptance_email ? (
                      <span>Link accettazione inviato a {quote.quote_acceptance_email}</span>
                    ) : (
                      <span>Non ancora inviato per accettazione</span>
                    )}
                  </div>

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
                      Copia visione
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => sendAcceptanceEmail(quote)}
                      disabled={sendingQuoteId === quote.id || Boolean(quote.contract_signer_email)}
                    >
                      {sendingQuoteId === quote.id ? 'Invio…' : 'Invia email'}
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
