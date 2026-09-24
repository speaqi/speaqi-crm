'use client'

import { useState } from 'react'

type Values = Record<string, string>

const FIELDS: Array<{ name: string; label: string; type?: string; autoComplete?: string; required?: boolean; wide?: boolean }> = [
  { name: 'name', label: 'Nome e cognome', autoComplete: 'name', required: true },
  { name: 'email', label: 'Email', type: 'email', autoComplete: 'email', required: true },
  { name: 'phone', label: 'Telefono', type: 'tel', autoComplete: 'tel', required: true },
  { name: 'area', label: 'Zona in cui vuoi lavorare', autoComplete: 'address-level2', required: true },
  { name: 'availability', label: 'Disponibilità (es. part-time, weekend)' },
]

export function ApplicationForm() {
  const [values, setValues] = useState<Values>({})
  const [hasVat, setHasVat] = useState<'yes' | 'no' | ''>('')
  const [privacy, setPrivacy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const response = await fetch('/api/candidature-commerciali', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...values, has_vat_number: hasVat || null, privacy }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload?.success) throw new Error(payload?.error || 'Candidatura non inviata')
      setSent(true)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Candidatura non inviata')
    } finally {
      setLoading(false)
    }
  }

  if (sent) {
    return (
      <div className="public-quote-success">
        Grazie! Abbiamo ricevuto la tua candidatura: ti richiamiamo entro pochi giorni.
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit}>
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
              autoComplete={field.autoComplete}
              required={field.required}
              value={values[field.name] || ''}
              onChange={(event) => setValues((previous) => ({ ...previous, [field.name]: event.target.value }))}
            />
          </label>
        ))}
        <label className="sales-form-field">
          <span className="public-quote-contract-label">Hai la partita IVA?</span>
          <select
            className="public-quote-contract-input"
            value={hasVat}
            onChange={(event) => setHasVat(event.target.value as 'yes' | 'no' | '')}
          >
            <option value="">Preferisco dirlo al colloquio</option>
            <option value="yes">Sì</option>
            <option value="no">No</option>
          </select>
        </label>
        <label className="sales-form-field is-wide">
          <span className="public-quote-contract-label">Esperienze di vendita (facoltativo)</span>
          <textarea
            className="public-quote-contract-input"
            rows={4}
            maxLength={2000}
            value={values.experience || ''}
            onChange={(event) => setValues((previous) => ({ ...previous, experience: event.target.value }))}
          />
        </label>
        {/* Honeypot: invisibile alle persone, compilato dai bot. */}
        <label className="recruit-honeypot" aria-hidden="true">
          Sito web
          <input
            tabIndex={-1}
            autoComplete="off"
            value={values.website || ''}
            onChange={(event) => setValues((previous) => ({ ...previous, website: event.target.value }))}
          />
        </label>
      </div>

      <label className="public-quote-contract-check recruit-privacy">
        <input type="checkbox" checked={privacy} onChange={(event) => setPrivacy(event.target.checked)} />
        <span>
          Acconsento al trattamento dei miei dati da parte di Speaqi di TheBestItaly (P.IVA 10831191217) al solo scopo
          di valutare la candidatura e ricontattarmi. Posso chiederne la cancellazione in qualsiasi momento scrivendo a
          info@speaqi.com.
        </span>
      </label>

      <button type="submit" className="public-quote-pay sales-form-submit" disabled={loading || !privacy}>
        {loading ? 'Invio…' : 'Invia candidatura'}
      </button>
      {error && <div className="public-quote-error">{error}</div>}
    </form>
  )
}
