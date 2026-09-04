'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { QuoteLineItem } from '@/types'

function money(value: number, currency: string) {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency }).format(value)
}

export function QuoteChoiceGroup({
  token,
  items,
  currency,
  locked,
}: {
  token: string
  items: QuoteLineItem[]
  currency: string
  locked: boolean
}) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const selected = items.find((item) => item.selected) || items[0]

  async function choose(item: QuoteLineItem) {
    if (locked || saving || item.id === selected?.id) return
    setSaving(true)
    setError(null)
    try {
      const response = await fetch('/api/quotes/public/select-choice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, group_id: item.choice_group_id, item_id: item.id }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.error || 'Impossibile salvare la scelta')
      router.refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Impossibile salvare la scelta')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="public-quote-choice-group">
      <div className="public-quote-choice-heading">
        <div>
          <span>Scelta richiesta</span>
          <h3>{items[0]?.choice_group_label || 'Scegli una delle alternative'}</h3>
        </div>
        {saving && <small>Salvataggio…</small>}
      </div>
      <div className="public-quote-choice-options">
        {items.map((item) => {
          const active = item.id === selected?.id
          return (
            <button
              type="button"
              key={item.id}
              className={`public-quote-choice-option${active ? ' selected' : ''}`}
              onClick={() => choose(item)}
              disabled={locked || saving}
              aria-pressed={active}
            >
              <span className="public-quote-choice-radio">{active ? '✓' : ''}</span>
              <span className="public-quote-choice-copy">
                <strong>{item.description}</strong>
                {item.details && <small>{item.details}</small>}
              </span>
              <span className="public-quote-choice-price">
                {money(Number(item.quantity || 0) * Number(item.unit_price || 0), currency)}
                <small>+ IVA</small>
              </span>
            </button>
          )
        })}
      </div>
      {locked && <p className="public-quote-choice-locked">Scelta confermata con l’accettazione del preventivo.</p>}
      {error && <div className="public-quote-error">{error}</div>}
    </section>
  )
}
