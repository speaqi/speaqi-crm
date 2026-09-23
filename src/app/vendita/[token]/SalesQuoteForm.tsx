'use client'

import { useState } from 'react'

export type SalesPackageOption = {
  key: string
  label: string
  subtitle: string
  unitPrice: number
  listUnitPrice: number | null
  yearly: boolean
}

type SalesQuoteFormProps = {
  token: string
  packages: SalesPackageOption[]
}

const FIELDS: Array<{
  name: string
  label: string
  required?: boolean
  wide?: boolean
  type?: string
  autoComplete?: string
  inputMode?: 'text' | 'email' | 'tel' | 'numeric'
}> = [
  { name: 'company', label: 'Ragione sociale', required: true, wide: true, autoComplete: 'organization' },
  { name: 'contact_name', label: 'Referente (nome e cognome)', required: true, autoComplete: 'name' },
  { name: 'email', label: 'Email', required: true, type: 'email', autoComplete: 'email', inputMode: 'email' },
  { name: 'phone', label: 'Telefono', type: 'tel', autoComplete: 'tel', inputMode: 'tel' },
  { name: 'tax_id', label: 'Partita IVA o codice fiscale', required: true },
  { name: 'address', label: 'Indirizzo sede', wide: true, autoComplete: 'street-address' },
  { name: 'zip', label: 'CAP', autoComplete: 'postal-code', inputMode: 'numeric' },
  { name: 'city', label: 'Città', autoComplete: 'address-level2' },
  { name: 'pec', label: 'PEC', type: 'email', inputMode: 'email' },
  { name: 'sdi', label: 'Codice SDI' },
]

function formatMoney(value: number) {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(value)
}

export function SalesQuoteForm({ token, packages }: SalesQuoteFormProps) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [packageKey, setPackageKey] = useState(packages[0]?.key || 'video_map')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const response = await fetch(`/api/vendita/${encodeURIComponent(token)}/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...values, package_key: packageKey }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.url) throw new Error(payload?.error || 'Impossibile creare il preventivo')
      window.location.assign(payload.url)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Impossibile creare il preventivo')
      setLoading(false)
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <h2>Pacchetto</h2>
      <div className="sales-package-options">
        {packages.map((p) => (
          <label key={p.key} className={`sales-package-option${p.key === packageKey ? ' is-selected' : ''}`}>
            <input
              type="radio"
              name="package_key"
              value={p.key}
              checked={p.key === packageKey}
              onChange={() => setPackageKey(p.key)}
            />
            <span>
              <strong>{p.label}</strong>
              <small>{p.subtitle}</small>
            </span>
            <span className="sales-package-price">
              {p.listUnitPrice ? <s>{formatMoney(p.listUnitPrice)}</s> : null}
              {formatMoney(p.unitPrice)} + IVA{p.yearly ? ' / anno' : ''}
            </span>
          </label>
        ))}
      </div>

      <div className="sales-form-grid">
        {FIELDS.map((field) => (
          <label key={field.name} className={`sales-form-field${field.wide ? ' is-wide' : ''}`}>
            <span className="public-quote-contract-label">
              {field.label}
              {field.required ? ' *' : ''}
            </span>
            <input
              className="public-quote-contract-input"
              name={field.name}
              type={field.type || 'text'}
              required={field.required}
              autoComplete={field.autoComplete}
              inputMode={field.inputMode}
              value={values[field.name] || ''}
              onChange={(event) => setValues((previous) => ({ ...previous, [field.name]: event.target.value }))}
            />
          </label>
        ))}
      </div>

      <button type="submit" className="public-quote-pay sales-form-submit" disabled={loading}>
        {loading ? 'Creazione…' : 'Crea e passa alla firma'}
      </button>
      {error && <div className="public-quote-error">{error}</div>}
    </form>
  )
}
