'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useCRMContext } from '@/components/layout/CRMContext'
import { apiFetch } from '@/lib/api'
import { createClient } from '@/lib/supabase'
import { computeFeTotals, NATURE_ESENTI, REGIMI_FISCALI, type FeCustomer, type FeLine } from '@/lib/fatturapa'

// Fatture elettroniche: bozza dal preventivo pagato, controllo, invio allo SDI con Aruba.

type Invoice = {
  id: string
  quote_id: string | null
  source: 'quote' | 'stripe_renewal' | 'manual'
  status: string
  numero: string | null
  number: number | null
  year: number | null
  issue_date: string
  customer: FeCustomer
  lines: FeLine[]
  payment_method: 'MP05' | 'MP08'
  causale: string | null
  imponibile: number
  imposta: number
  totale: number
  warnings: string[]
  problems: string[]
  aruba_env: string | null
  aruba_filename: string | null
  sdi_status: string | null
  sdi_detail: string | null
  last_error: string | null
  sent_at: string | null
}

type QuoteToInvoice = {
  id: string
  quote_number: string
  title: string | null
  customer_name: string | null
  customer_company: string | null
  total_amount: number
  status: string
  payment_state: string | null
  paid_at: string | null
  accepted_at: string | null
}

type Settings = {
  denominazione: string
  partita_iva: string
  codice_fiscale: string | null
  regime_fiscale: string
  indirizzo: string
  cap: string
  comune: string
  provincia: string | null
  iban: string | null
  natura_esente: string | null
  bollo_virtuale: boolean
  causale_extra: string | null
  numero_formato: string
}

type ListResponse = {
  invoices: Invoice[]
  to_invoice: QuoteToInvoice[]
  aruba: { configured: boolean; env: 'demo' | 'production' }
  settings_saved: boolean
}

const STATUS_LABEL: Record<string, { label: string; tone: string }> = {
  draft: { label: 'Bozza', tone: 'is-draft' },
  sending: { label: 'In invio', tone: 'is-wait' },
  sent: { label: 'Inviata, in attesa SDI', tone: 'is-wait' },
  delivered: { label: 'Consegnata', tone: 'is-ok' },
  accepted: { label: 'Accettata', tone: 'is-ok' },
  not_delivered: { label: 'Nel cassetto fiscale', tone: 'is-ok' },
  refused: { label: 'Rifiutata dal cliente', tone: 'is-bad' },
  rejected: { label: 'Scartata dallo SDI', tone: 'is-bad' },
  error: { label: 'Errore di invio', tone: 'is-bad' },
}
const EDITABLE = ['draft', 'error', 'rejected']

const euro = (value: number) =>
  `${Number(value || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
const day = (value: string | null) => {
  if (!value) return ''
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' })
}

async function authedFetch(input: string, init: RequestInit = {}) {
  const {
    data: { session },
  } = await createClient().auth.getSession()
  const headers = new Headers(init.headers)
  if (session?.access_token) headers.set('Authorization', `Bearer ${session.access_token}`)
  return fetch(input, { ...init, headers, cache: 'no-store' })
}

export default function FatturePage() {
  const { showToast } = useCRMContext()
  const [tab, setTab] = useState<'fatture' | 'dati'>('fatture')
  const [data, setData] = useState<ListResponse | null>(null)
  const [loadError, setLoadError] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const response = await apiFetch<ListResponse>('/api/invoices')
      setData(response)
      setLoadError('')
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Impossibile caricare le fatture')
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (data && !data.settings_saved) setTab('dati')
  }, [data])

  // Arrivando da «Genera fattura» nel preventivo (?invoice=<id>) la bozza si apre da sola.
  useEffect(() => {
    const invoiceId = new URLSearchParams(window.location.search).get('invoice')
    if (!invoiceId || !data?.invoices.some((invoice) => invoice.id === invoiceId)) return
    setOpenId(invoiceId)
    window.history.replaceState(null, '', '/fatture')
  }, [data])

  async function prepare(quote: QuoteToInvoice) {
    setBusy(quote.id)
    try {
      const response = await apiFetch<{ invoice: Invoice }>('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quote_id: quote.id }),
      })
      await load()
      setOpenId(response.invoice.id)
      showToast('Bozza pronta: controllala e inviala')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Impossibile preparare la fattura')
    } finally {
      setBusy(null)
    }
  }

  const invoices = data?.invoices || []
  const totals = useMemo(() => {
    const year = new Date().getFullYear()
    const issued = invoices.filter((inv) => inv.number != null && inv.year === year && !['rejected'].includes(inv.status))
    return {
      year,
      issued: issued.reduce((sum, inv) => sum + inv.totale, 0),
      count: issued.length,
      drafts: invoices.filter((inv) => EDITABLE.includes(inv.status)).length,
    }
  }, [invoices])

  return (
    <div className="page-container fe-page">
      <div className="page-header">
        <h1>Fatture</h1>
        <p className="page-subtitle">Fatture elettroniche dai preventivi pagati, inviate allo SDI con Aruba. Ogni invio lo confermi tu.</p>
      </div>

      {data ? (
        !data.aruba.configured ? (
          <div className="fe-banner is-bad">Aruba non è collegato: servono ARUBA_FE_USERNAME e ARUBA_FE_PASSWORD su Railway. Intanto puoi preparare le bozze e scaricare l’XML.</div>
        ) : data.aruba.env === 'demo' ? (
          <div className="fe-banner is-wait">Ambiente di prova Aruba: le fatture inviate da qui non arrivano allo SDI. Per quelle vere serve ARUBA_FE_ENV=production.</div>
        ) : null
      ) : null}

      <div className="rc-view-toggle" role="group" aria-label="Sezione">
        <button type="button" aria-pressed={tab === 'fatture'} onClick={() => setTab('fatture')}>
          Fatture{totals.drafts ? ` (${totals.drafts} da inviare)` : ''}
        </button>
        <button type="button" aria-pressed={tab === 'dati'} onClick={() => setTab('dati')}>
          Dati fiscali{data && !data.settings_saved ? ' (da compilare)' : ''}
        </button>
      </div>

      {loadError ? <div className="inline-error">{loadError}</div> : null}
      {!data && !loadError ? <div className="rc-empty">Caricamento…</div> : null}

      {data && tab === 'dati' ? <SettingsForm onSaved={load} /> : null}

      {data && tab === 'fatture' ? (
        <>
          <div className="rc-totals">
            <div className="rc-total is-collected">
              <span>Fatturato {totals.year}</span>
              <strong>{euro(totals.issued)}</strong>
              <small>{totals.count === 1 ? '1 fattura emessa' : `${totals.count} fatture emesse`}</small>
            </div>
            <div className="rc-total is-pending">
              <span>Da fatturare</span>
              <strong>{data.to_invoice.length}</strong>
              <small>preventivi pagati o accettati senza fattura</small>
            </div>
            <div className="rc-total is-prospective">
              <span>Bozze</span>
              <strong>{totals.drafts}</strong>
              <small>da controllare e inviare</small>
            </div>
          </div>

          {data.to_invoice.length ? (
            <section className="fe-section">
              <h2>Da fatturare</h2>
              <p className="page-subtitle">Un lavoro fatto fuori dal CRM si registra come preventivo in Preventivi, si segna pagato e compare qui.</p>
              <ul className="rc-list">
                {data.to_invoice.map((quote) => (
                  <li key={quote.id} className="rc-row">
                    <div className="rc-main">
                      <div className="rc-name">{quote.customer_company || quote.customer_name || 'Cliente'}</div>
                      <div className="rc-meta">
                        {quote.quote_number}
                        {quote.title ? ` · ${quote.title}` : ''} · {quote.status === 'paid' || quote.payment_state === 'paid' ? `pagato ${day(quote.paid_at)}` : `accettato ${day(quote.accepted_at)}`}
                      </div>
                    </div>
                    <div className="rc-amount">{euro(quote.total_amount)}</div>
                    <div className="rc-actions">
                      <button type="button" className="btn btn-primary btn-sm" disabled={busy === quote.id} onClick={() => prepare(quote)}>
                        {busy === quote.id ? 'Preparo…' : 'Prepara fattura'}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="fe-section">
            <h2>Fatture</h2>
            {invoices.length ? (
              <ul className="rc-list">
                {invoices.map((invoice) => (
                  <InvoiceRow
                    key={invoice.id}
                    invoice={invoice}
                    open={openId === invoice.id}
                    onToggle={() => setOpenId((current) => (current === invoice.id ? null : invoice.id))}
                    onChanged={load}
                  />
                ))}
              </ul>
            ) : (
              <div className="rc-empty">Nessuna fattura ancora. Le bozze nascono da sole quando un cliente paga con carta, oppure da “Prepara fattura”.</div>
            )}
          </section>
        </>
      ) : null}
    </div>
  )
}

function InvoiceRow({ invoice, open, onToggle, onChanged }: { invoice: Invoice; open: boolean; onToggle: () => void; onChanged: () => Promise<void> }) {
  const status = STATUS_LABEL[invoice.status] || { label: invoice.status, tone: 'is-draft' }
  return (
    <li className={`fe-item${open ? ' is-open' : ''}`}>
      <button type="button" className="fe-head" onClick={onToggle} aria-expanded={open}>
        <span className="fe-num">{invoice.numero ? `N. ${invoice.numero}` : 'Bozza'}</span>
        <span className="fe-who">
          <strong>{invoice.customer?.denominazione || 'Cliente'}</strong>
          <small>
            {day(invoice.issue_date)}
            {invoice.source === 'stripe_renewal' ? ' · rinnovo' : ''}
            {invoice.aruba_env === 'demo' && invoice.sent_at ? ' · prova Aruba' : ''}
          </small>
        </span>
        <span className={`fe-chip ${status.tone}`}>{status.label}</span>
        <span className="fe-total">{euro(invoice.totale)}</span>
      </button>
      {open ? EDITABLE.includes(invoice.status) ? <InvoiceEditor invoice={invoice} onChanged={onChanged} /> : <InvoiceDetail invoice={invoice} /> : null}
    </li>
  )
}

async function downloadXml(invoice: Invoice, showToast: (text: string) => void) {
  const response = await authedFetch(`/api/invoices/${invoice.id}/xml`)
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    showToast(payload?.error || 'XML non disponibile')
    return
  }
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = invoice.numero ? `fattura-${invoice.numero.replace(/[^A-Za-z0-9-]/g, '-')}.xml` : 'fattura-bozza.xml'
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

function InvoiceDetail({ invoice }: { invoice: Invoice }) {
  const { showToast } = useCRMContext()
  return (
    <div className="fe-body">
      <dl className="fe-kv">
        <dt>Stato SDI</dt>
        <dd>{invoice.sdi_status || '—'}{invoice.sdi_detail ? ` · ${invoice.sdi_detail}` : ''}</dd>
        <dt>Inviata</dt>
        <dd>{day(invoice.sent_at)}{invoice.aruba_env === 'demo' ? ' (ambiente di prova)' : ''}</dd>
        <dt>File Aruba</dt>
        <dd className="fe-mono">{invoice.aruba_filename || '—'}</dd>
        <dt>Imponibile</dt>
        <dd>{euro(invoice.imponibile)} + IVA {euro(invoice.imposta)}</dd>
      </dl>
      <ul className="fe-lines-ro">
        {invoice.lines.map((line, index) => (
          <li key={index}>
            <span>{line.description}</span>
            <span>
              {line.quantity} × {euro(line.unitPrice)} · IVA {line.vatRate}%
            </span>
          </li>
        ))}
      </ul>
      <div className="fe-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => downloadXml(invoice, showToast)}>
          Scarica XML
        </button>
      </div>
    </div>
  )
}

const emptyLine = (vatRate: number): FeLine => ({ description: '', quantity: 1, unitPrice: 0, vatRate })

function InvoiceEditor({ invoice, onChanged }: { invoice: Invoice; onChanged: () => Promise<void> }) {
  const { showToast } = useCRMContext()
  const [issueDate, setIssueDate] = useState(invoice.issue_date.slice(0, 10))
  const [customer, setCustomer] = useState<FeCustomer>({ ...invoice.customer })
  const [lines, setLines] = useState<FeLine[]>(invoice.lines.map((line) => ({ ...line })))
  const [payment, setPayment] = useState(invoice.payment_method)
  const [causale, setCausale] = useState(invoice.causale || '')
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState<false | 'aruba' | 'manual'>(false)
  const [sending, setSending] = useState(false)
  const [problems, setProblems] = useState<string[]>(invoice.problems)
  const [dirty, setDirty] = useState(false)

  const live = useMemo(() => computeFeTotals(lines.map((line) => ({ ...line, unitPrice: Number(line.unitPrice) || 0, quantity: Number(line.quantity) || 0 }))), [lines])
  const touch = () => setDirty(true)
  const setField = (key: keyof FeCustomer, value: string) => {
    setCustomer((current) => ({ ...current, [key]: value }))
    touch()
  }
  const setLine = (index: number, patch: Partial<FeLine>) => {
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)))
    touch()
  }

  async function save(quiet = false) {
    setSaving(true)
    try {
      const response = await apiFetch<{ invoice: Invoice }>(`/api/invoices/${invoice.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issue_date: issueDate, customer, lines, payment_method: payment, causale }),
      })
      setDirty(false)
      await onChanged()
      if (!quiet) showToast('Fattura salvata')
      return response.invoice
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Salvataggio non riuscito')
      return null
    } finally {
      setSaving(false)
    }
  }

  async function send(manual = false) {
    setSending(true)
    try {
      if (dirty && !(await save(true))) return
      const response = await authedFetch(`/api/invoices/${invoice.id}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manual }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        if (payload?.problems?.length) setProblems(payload.problems)
        showToast(payload?.error || 'Invio non riuscito')
      } else if (manual) {
        // Numerata e pronta: l'XML si scarica subito, da caricare a mano sul pannello Aruba.
        await downloadXml(payload.invoice, showToast)
        showToast(`Fattura ${payload.invoice.numero} pronta: carica l’XML sul pannello Aruba`)
      } else {
        showToast(`Fattura ${payload.invoice.numero} inviata ad Aruba`)
      }
      setConfirming(false)
      await onChanged()
    } finally {
      setSending(false)
    }
  }

  async function remove() {
    try {
      await apiFetch(`/api/invoices/${invoice.id}`, { method: 'DELETE' })
      showToast('Bozza cancellata')
      await onChanged()
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Impossibile cancellare')
    }
  }

  const defaultRate = lines[0]?.vatRate ?? 22

  return (
    <div className="fe-body">
      {invoice.last_error ? <div className="fe-banner is-bad">{invoice.last_error}</div> : null}
      {invoice.status === 'rejected' ? (
        <div className="fe-banner is-bad">
          Lo SDI ha scartato la fattura{invoice.sdi_detail ? `: ${invoice.sdi_detail}` : ''}. Correggi e reinvia: numero e data restano gli stessi.
        </div>
      ) : null}
      {invoice.warnings.length ? (
        <div className="fe-banner is-wait">
          {invoice.warnings.map((warning) => (
            <div key={warning}>{warning}</div>
          ))}
        </div>
      ) : null}

      <div className="fe-grid">
        <label className="fe-field">
          <span className="fl">Data</span>
          <input id={`fe-date-${invoice.id}`} className="fi" type="date" value={issueDate} onChange={(e) => { setIssueDate(e.target.value); touch() }} />
        </label>
        <label className="fe-field">
          <span className="fl">Pagamento</span>
          <select id={`fe-pay-${invoice.id}`} className="fi" value={payment} onChange={(e) => { setPayment(e.target.value as 'MP05' | 'MP08'); touch() }}>
            <option value="MP08">Carta (Stripe)</option>
            <option value="MP05">Bonifico</option>
          </select>
        </label>
        <label className="fe-field fe-wide">
          <span className="fl">Causale</span>
          <input id={`fe-causale-${invoice.id}`} className="fi" value={causale} maxLength={600} onChange={(e) => { setCausale(e.target.value); touch() }} />
        </label>
      </div>

      <h3 className="fe-sub">Cliente</h3>
      <div className="fe-grid">
        <label className="fe-field fe-wide">
          <span className="fl">Ragione sociale o nome</span>
          <input className="fi" value={customer.denominazione || ''} onChange={(e) => setField('denominazione', e.target.value)} />
        </label>
        <label className="fe-field">
          <span className="fl">Partita IVA</span>
          <input className="fi" value={customer.partitaIva || ''} onChange={(e) => setField('partitaIva', e.target.value)} />
        </label>
        <label className="fe-field">
          <span className="fl">Codice fiscale</span>
          <input className="fi" value={customer.codiceFiscale || ''} onChange={(e) => setField('codiceFiscale', e.target.value)} />
        </label>
        <label className="fe-field">
          <span className="fl">Codice destinatario</span>
          <input className="fi" maxLength={7} placeholder="7 caratteri" value={customer.codiceDestinatario || ''} onChange={(e) => setField('codiceDestinatario', e.target.value)} />
        </label>
        <label className="fe-field">
          <span className="fl">PEC</span>
          <input className="fi" value={customer.pec || ''} onChange={(e) => setField('pec', e.target.value)} />
        </label>
        <label className="fe-field fe-wide">
          <span className="fl">Indirizzo</span>
          <input className="fi" value={customer.indirizzo || ''} onChange={(e) => setField('indirizzo', e.target.value)} />
        </label>
        <label className="fe-field">
          <span className="fl">CAP</span>
          <input className="fi" inputMode="numeric" maxLength={5} value={customer.cap || ''} onChange={(e) => setField('cap', e.target.value)} />
        </label>
        <label className="fe-field">
          <span className="fl">Comune</span>
          <input className="fi" value={customer.comune || ''} onChange={(e) => setField('comune', e.target.value)} />
        </label>
        <label className="fe-field">
          <span className="fl">Provincia</span>
          <input className="fi" maxLength={2} placeholder="NA" value={customer.provincia || ''} onChange={(e) => setField('provincia', e.target.value.toUpperCase())} />
        </label>
      </div>

      <h3 className="fe-sub">Righe</h3>
      <div className="fe-lines">
        <div className="fe-line fe-line-head" aria-hidden="true">
          <span>Descrizione</span>
          <span>Q.tà</span>
          <span>Prezzo netto</span>
          <span>IVA %</span>
          <span />
        </div>
        {lines.map((line, index) => (
          <div className="fe-line" key={index}>
            <input className="fi" aria-label={`Descrizione riga ${index + 1}`} value={line.description} onChange={(e) => setLine(index, { description: e.target.value })} />
            <input className="fi" aria-label="Quantità" inputMode="decimal" value={String(line.quantity)} onChange={(e) => setLine(index, { quantity: Number(e.target.value.replace(',', '.')) || 0 })} />
            <input className="fi" aria-label="Prezzo netto" inputMode="decimal" value={String(line.unitPrice)} onChange={(e) => setLine(index, { unitPrice: Number(e.target.value.replace(',', '.')) || 0 })} />
            <input className="fi" aria-label="Aliquota IVA" inputMode="decimal" value={String(line.vatRate)} onChange={(e) => setLine(index, { vatRate: Number(e.target.value.replace(',', '.')) || 0 })} />
            <button type="button" className="btn-mini" aria-label="Togli la riga" disabled={lines.length === 1} onClick={() => { setLines((current) => current.filter((_, i) => i !== index)); touch() }}>
              ✕
            </button>
          </div>
        ))}
        <button type="button" className="btn-mini fe-add" onClick={() => { setLines((current) => [...current, emptyLine(defaultRate)]); touch() }}>
          + Aggiungi riga
        </button>
      </div>
      <div className="fe-sum">
        <span>Imponibile {euro(live.imponibileCents / 100)}</span>
        <span>IVA {euro(live.impostaCents / 100)}</span>
        <strong>Totale {euro(live.totaleCents / 100)}</strong>
      </div>

      {problems.length && !dirty ? (
        <div className="fe-banner is-bad">
          <strong>Prima dell’invio:</strong>
          <ul>
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="fe-actions">
        {invoice.status === 'draft' && invoice.number == null ? (
          <button type="button" className="btn btn-ghost btn-sm fe-danger" onClick={remove}>
            Cancella bozza
          </button>
        ) : null}
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => downloadXml(invoice, showToast)}>
          Scarica XML
        </button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={saving || !dirty} onClick={() => save()}>
          {saving ? 'Salvo…' : dirty ? 'Salva' : 'Salvata'}
        </button>
        {confirming === 'manual' ? (
          <span className="fe-confirm">
            Dare il numero alla fattura da {euro(live.totaleCents / 100)} per {customer.denominazione || 'cliente'} e scaricare l’XML? Non parte niente: lo carichi tu sul pannello Aruba. Dopo non si modifica.
            <button type="button" className="btn btn-primary btn-sm" disabled={sending} onClick={() => send(true)}>
              {sending ? 'Preparo…' : 'Sì, numera e scarica'}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={sending} onClick={() => setConfirming(false)}>
              Annulla
            </button>
          </span>
        ) : confirming ? (
          <span className="fe-confirm">
            Inviare a {customer.denominazione || 'cliente'} la fattura da {euro(live.totaleCents / 100)}? Dopo l’invio non si modifica.
            <button type="button" className="btn btn-primary btn-sm" disabled={sending} onClick={() => send()}>
              {sending ? 'Invio…' : 'Sì, invia allo SDI'}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={sending} onClick={() => setConfirming(false)}>
              Annulla
            </button>
          </span>
        ) : (
          <>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={saving}
              onClick={() => setConfirming('manual')}
              title="Assegna il numero e scarica l’XML definitivo, senza inviarlo: lo carichi tu sul pannello Aruba"
            >
              Numera e scarica XML
            </button>
            <button type="button" className="btn btn-primary btn-sm" disabled={saving} onClick={() => setConfirming('aruba')}>
              {invoice.status === 'draft' ? 'Invia allo SDI' : 'Reinvia allo SDI'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function SettingsForm({ onSaved }: { onSaved: () => Promise<void> }) {
  const { showToast } = useCRMContext()
  const [form, setForm] = useState<Settings | null>(null)
  const [year, setYear] = useState(new Date().getFullYear())
  const [lastNumber, setLastNumber] = useState('')
  const [saved, setSaved] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    apiFetch<{ settings: Settings; saved: boolean; year: number; last_number: number }>('/api/invoices/settings')
      .then((response) => {
        setForm(response.settings)
        setSaved(response.saved)
        setYear(response.year)
        setLastNumber(String(response.last_number))
      })
      .catch((error) => showToast(error instanceof Error ? error.message : 'Impossibile caricare i dati fiscali'))
  }, [showToast])

  if (!form) return <div className="rc-empty">Caricamento…</div>
  const set = (key: keyof Settings, value: string | boolean | null) => setForm((current) => (current ? { ...current, [key]: value } : current))

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    try {
      const response = await apiFetch<{ settings: Settings; last_number: number }>('/api/invoices/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, last_number: lastNumber === '' ? null : Number(lastNumber) }),
      })
      setForm(response.settings)
      setLastNumber(String(response.last_number))
      setSaved(true)
      showToast('Dati fiscali salvati')
      await onSaved()
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Salvataggio non riuscito')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="fe-settings" onSubmit={submit}>
      {!saved ? <div className="fe-banner is-wait">Controlla e completa i dati di chi emette le fatture: finché non li salvi, non si invia niente.</div> : null}
      <div className="fe-grid">
        <label className="fe-field fe-wide">
          <span className="fl">Denominazione</span>
          <input id="fe-s-den" className="fi" value={form.denominazione} onChange={(e) => set('denominazione', e.target.value)} />
        </label>
        <label className="fe-field">
          <span className="fl">Partita IVA</span>
          <input id="fe-s-piva" className="fi" value={form.partita_iva} onChange={(e) => set('partita_iva', e.target.value)} />
        </label>
        <label className="fe-field">
          <span className="fl">Codice fiscale</span>
          <input id="fe-s-cf" className="fi" value={form.codice_fiscale || ''} onChange={(e) => set('codice_fiscale', e.target.value)} />
        </label>
        <label className="fe-field">
          <span className="fl">Regime fiscale</span>
          <select id="fe-s-regime" className="fi" value={form.regime_fiscale} onChange={(e) => set('regime_fiscale', e.target.value)}>
            {REGIMI_FISCALI.map((regime) => (
              <option key={regime.code} value={regime.code}>
                {regime.code} · {regime.label}
              </option>
            ))}
          </select>
        </label>
        <label className="fe-field">
          <span className="fl">IBAN (per i bonifici)</span>
          <input id="fe-s-iban" className="fi" value={form.iban || ''} onChange={(e) => set('iban', e.target.value)} />
        </label>
        <label className="fe-field fe-wide">
          <span className="fl">Indirizzo della sede</span>
          <input id="fe-s-ind" className="fi" value={form.indirizzo} onChange={(e) => set('indirizzo', e.target.value)} />
        </label>
        <label className="fe-field">
          <span className="fl">CAP</span>
          <input id="fe-s-cap" className="fi" inputMode="numeric" maxLength={5} value={form.cap} onChange={(e) => set('cap', e.target.value)} />
        </label>
        <label className="fe-field">
          <span className="fl">Comune</span>
          <input id="fe-s-com" className="fi" value={form.comune} onChange={(e) => set('comune', e.target.value)} />
        </label>
        <label className="fe-field">
          <span className="fl">Provincia</span>
          <input id="fe-s-prov" className="fi" maxLength={2} value={form.provincia || ''} onChange={(e) => set('provincia', e.target.value.toUpperCase())} />
        </label>
      </div>

      <h3 className="fe-sub">Numerazione</h3>
      <div className="fe-grid">
        <label className="fe-field">
          <span className="fl">Ultimo numero emesso nel {year}</span>
          <input id="fe-s-last" className="fi" inputMode="numeric" value={lastNumber} onChange={(e) => setLastNumber(e.target.value.replace(/\D/g, ''))} />
          <small className="fe-hint">Quello dell’ultima fattura fatta sul pannello Aruba: il CRM continua da {Number(lastNumber || 0) + 1}.</small>
        </label>
        <label className="fe-field">
          <span className="fl">Formato del numero</span>
          <input id="fe-s-fmt" className="fi" value={form.numero_formato} onChange={(e) => set('numero_formato', e.target.value)} />
          <small className="fe-hint">{'{n}'} numero, {'{yyyy}'} anno. Es. {'{n}/{yyyy}'} diventa 12/{year}.</small>
        </label>
      </div>

      <h3 className="fe-sub">Fatture senza IVA</h3>
      <div className="fe-grid">
        <label className="fe-field">
          <span className="fl">Natura dell’operazione</span>
          <select id="fe-s-nat" className="fi" value={form.natura_esente || ''} onChange={(e) => set('natura_esente', e.target.value || null)}>
            <option value="">Nessuna: fatturo sempre con IVA</option>
            {NATURE_ESENTI.map((natura) => (
              <option key={natura.code} value={natura.code}>
                {natura.label}
              </option>
            ))}
          </select>
        </label>
        <label className="fe-field fe-check">
          <input id="fe-s-bollo" type="checkbox" checked={form.bollo_virtuale} onChange={(e) => set('bollo_virtuale', e.target.checked)} />
          <span>Bollo virtuale da 2 € sopra 77,47 € senza IVA</span>
        </label>
        <label className="fe-field fe-wide">
          <span className="fl">Dicitura in fondo alla causale</span>
          <input id="fe-s-caus" className="fi" placeholder="Es. la dicitura del regime forfettario" value={form.causale_extra || ''} onChange={(e) => set('causale_extra', e.target.value)} />
        </label>
      </div>

      <div className="fe-actions">
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? 'Salvo…' : 'Salva dati fiscali'}
        </button>
      </div>
    </form>
  )
}
