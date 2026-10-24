'use client'

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { useCRMContext } from '@/components/layout/CRMContext'
import { apiFetch } from '@/lib/api'
import {
  formatEuro,
  parseReceivableAmount,
  Receivable,
  ReceivableCategory,
  sortReceivables,
  summarizeReceivables,
} from '@/lib/receivables'

// Registro personale dentro Fatture: soldi sicuri da incassare e prossimi, fuori da Speaqi.

function formatDate(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' })
}

function amountInputValue(amount: number) {
  return String(amount).replace('.', ',')
}

export default function ReceivablesSection() {
  const { showToast } = useCRMContext()
  const [items, setItems] = useState<Receivable[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState<ReceivableCategory>('confirmed')
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id: string; name: string; amount: string } | null>(null)
  const [showCollected, setShowCollected] = useState(false)

  const load = useCallback(async () => {
    try {
      const response = await apiFetch<{ receivables: Receivable[] }>('/api/receivables')
      setItems(response.receivables)
      setLoadError('')
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Impossibile caricare gli incassi')
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const { pending, prospective, collected } = useMemo(() => sortReceivables(items || []), [items])
  const totals = useMemo(() => summarizeReceivables(items || []), [items])

  function replaceItem(next: Receivable) {
    setItems((current) => (current || []).map((item) => (item.id === next.id ? next : item)))
  }

  async function add(event: FormEvent) {
    event.preventDefault()
    const cleanName = name.trim()
    if (!cleanName) return showToast('Scrivi da chi devi ricevere i soldi')
    if (parseReceivableAmount(amount) === null) return showToast('Importo non valido')

    setSaving(true)
    try {
      const response = await apiFetch<{ receivable: Receivable }>('/api/receivables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: cleanName, amount, category }),
      })
      setItems((current) => [...(current || []), response.receivable])
      setName('')
      setAmount('')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Impossibile salvare')
    } finally {
      setSaving(false)
    }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    setBusyId(id)
    try {
      const response = await apiFetch<{ receivable: Receivable }>('/api/receivables', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...body }),
      })
      replaceItem(response.receivable)
      return true
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Impossibile aggiornare')
      return false
    } finally {
      setBusyId(null)
    }
  }

  async function toggleCollected(item: Receivable) {
    const ok = await patch(item.id, { collected: !item.collected_at })
    if (ok) showToast(item.collected_at ? `${item.name}: di nuovo da incassare` : `${item.name}: incassato ${formatEuro(item.amount)}`)
  }

  async function saveEdit(event: FormEvent) {
    event.preventDefault()
    if (!editing) return
    if (!editing.name.trim()) return showToast('Il nome non puo essere vuoto')
    if (parseReceivableAmount(editing.amount) === null) return showToast('Importo non valido')
    const ok = await patch(editing.id, { name: editing.name, amount: editing.amount })
    if (ok) setEditing(null)
  }

  async function remove(item: Receivable) {
    if (!window.confirm(`Eliminare «${item.name}» (${formatEuro(item.amount)})?`)) return
    setBusyId(item.id)
    try {
      await apiFetch(`/api/receivables?id=${encodeURIComponent(item.id)}`, { method: 'DELETE' })
      setItems((current) => (current || []).filter((row) => row.id !== item.id))
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Impossibile eliminare')
    } finally {
      setBusyId(null)
    }
  }

  function renderRow(item: Receivable) {
    const isEditing = editing?.id === item.id
    const busy = busyId === item.id

    if (isEditing && editing) {
      return (
        <li key={item.id} className="rc-row is-editing">
          <form className="rc-edit" onSubmit={saveEdit}>
            <input
              className="fi"
              value={editing.name}
              maxLength={120}
              autoFocus
              onChange={(event) => setEditing({ ...editing, name: event.target.value })}
            />
            <input
              className="fi rc-amount-input"
              inputMode="decimal"
              value={editing.amount}
              onChange={(event) => setEditing({ ...editing, amount: event.target.value })}
            />
            <button className="btn btn-primary btn-sm" type="submit" disabled={busy}>
              Salva
            </button>
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => setEditing(null)}>
              Annulla
            </button>
          </form>
        </li>
      )
    }

    return (
      <li key={item.id} className={`rc-row${item.collected_at ? ' is-collected' : ''}`}>
        <button
          type="button"
          className="rc-check"
          aria-pressed={Boolean(item.collected_at)}
          title={item.collected_at ? 'Segna come da incassare' : 'Segna come incassato'}
          disabled={busy}
          onClick={() => toggleCollected(item)}
        >
          {item.collected_at ? '✓' : ''}
        </button>
        <div className="rc-main">
          <div className="rc-name">{item.name}</div>
          <div className="rc-meta">
            {item.collected_at ? `Incassato il ${formatDate(item.collected_at)}` : `Dal ${formatDate(item.created_at)}`}
          </div>
        </div>
        <div className="rc-amount">{formatEuro(item.amount)}</div>
        <div className="rc-actions">
          {!item.collected_at ? (
            <button type="button" className="btn-mini" disabled={busy}
              onClick={() => patch(item.id, { category: item.category === 'prospective' ? 'confirmed' : 'prospective' })}>
              {item.category === 'prospective' ? 'Conferma incasso' : 'Sposta tra i prossimi'}
            </button>
          ) : null}
          <button
            type="button"
            className="btn-mini"
            disabled={busy}
            onClick={() => setEditing({ id: item.id, name: item.name, amount: amountInputValue(item.amount) })}
          >
            Modifica
          </button>
          <button type="button" className="btn-mini" disabled={busy} onClick={() => remove(item)}>
            Elimina
          </button>
        </div>
      </li>
    )
  }

  const rows = (list: Receivable[], empty: string) =>
    list.length ? <ul className="rc-list">{list.map(renderRow)}</ul> : <div className="rc-empty">{empty}</div>

  return (
    <section className="fe-section" id="da-incassare">
      <h2>Da incassare</h2>
      <p className="page-subtitle">I soldi che devi ricevere, fuori da Speaqi: prima quelli sicuri, poi i prossimi. Li vedi solo tu.</p>

      <div className="rc-totals">
        <div className="rc-total is-pending">
          <span>Da incassare sicuro</span>
          <strong>{formatEuro(totals.pending)}</strong>
          <small>{totals.pendingCount === 1 ? '1 voce' : `${totals.pendingCount} voci`}</small>
        </div>
        <div className="rc-total is-prospective">
          <span>Prossimi</span>
          <strong>{formatEuro(totals.prospective)}</strong>
          <small>{totals.prospectiveCount} voci · da confermare</small>
        </div>
        <div className="rc-total is-collected">
          <span>Già incassati</span>
          <strong>{formatEuro(totals.collected)}</strong>
          <small>{totals.collectedCount === 1 ? '1 voce' : `${totals.collectedCount} voci`}</small>
        </div>
      </div>

      <form className="rc-add" onSubmit={add}>
        <label className="rc-field">
          <span className="fl">Chi / cosa</span>
          <input
            className="fi"
            placeholder="Es. Mario Rossi — lavoro sito"
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="rc-field rc-field-amount">
          <span className="fl">Cifra (€)</span>
          <input
            className="fi"
            inputMode="decimal"
            placeholder="1.250,00"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </label>
        <label className="rc-field rc-field-amount">
          <span className="fl">Quando</span>
          <select className="fi" value={category} onChange={(event) => setCategory(event.target.value as ReceivableCategory)}>
            <option value="confirmed">Sicuro</option>
            <option value="prospective">Prossimo</option>
          </select>
        </label>
        <button className="btn btn-primary" type="submit" disabled={saving}>
          {saving ? 'Salvo…' : 'Aggiungi'}
        </button>
      </form>

      {loadError ? <div className="inline-error">{loadError}</div> : null}
      {items === null && !loadError ? <div className="rc-empty">Caricamento…</div> : null}

      {items !== null ? (
        <>
          <h3>Da incassare sicuro</h3>
          {rows(pending, 'Nessun incasso confermato in attesa.')}

          <h3>Prossimi</h3>
          <p className="page-subtitle">Ancora da confermare. Questi importi non entrano nel totale da incassare sicuro.</p>
          {rows(prospective, 'Nessun importo prossimo.')}

          {collected.length ? (
            <div className="rc-collected">
              <button type="button" className="rc-collected-toggle" onClick={() => setShowCollected((open) => !open)}>
                {showCollected ? '▾' : '▸'} Già incassati ({collected.length})
              </button>
              {showCollected ? <ul className="rc-list">{collected.map(renderRow)}</ul> : null}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  )
}
