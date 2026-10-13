'use client'

import { useMemo, useState } from 'react'
import { FairExhibitor, STATUS_LABELS } from '@/lib/trade-fair'
import ElencoTab from './ElencoTab'
import { downloadCsv, FAIR, TYPE_SHORT } from './shared'

type Props = {
  rows: FairExhibitor[]
  now: Date
  showToast: (message: string) => void
  onRowChange: (row: FairExhibitor) => void
}

export default function DestinazioniEstereTab({ rows, now, showToast, onRowChange }: Props) {
  const [country, setCountry] = useState('')
  const countries = useMemo(() => Array.from(new Set(rows.map((row) => row.country?.trim()).filter((value): value is string => Boolean(value)))).sort((a, b) => a.localeCompare(b, 'it')), [rows])
  const selected = useMemo(() => country ? rows.filter((row) => row.country?.trim() === country) : rows, [rows, country])

  function exportCompleteList() {
    downloadCsv(`destinazioni-estere-${FAIR}.csv`,
      ['Destinazione / Ente', 'Paese', 'Città', 'Tipologia', 'Categoria', 'Padiglione', 'Stand', 'Referente', 'Email', 'Telefono', 'Sito', 'Scheda fiera', 'Stato', 'Prossimo richiamo', 'Note'],
      rows.map((row) => [row.name, row.country, row.city, TYPE_SHORT[row.organization_type || ''] || '', row.category,
        row.hall, row.stand, row.contact_person, row.email, row.phone, row.website, row.source_url,
        STATUS_LABELS[row.status], row.next_followup_at, row.notes.map((note) => note.text).join(' | ')]))
  }

  return (
    <>
      <section className="fx-card">
        <strong>{rows.length} destinazioni estere nel catalogo importato</strong>
        <p className="fx-hint">Enti del turismo, consorzi e associazioni di promozione territoriale, incluse le rappresentanze con sede in Italia. L’elenco iniziale include tutti gli stati e tutte le priorità.</p>
        <div className="fx-bar">
          <select className="fi" aria-label="Filtra per paese" value={country} onChange={(event) => setCountry(event.target.value)}>
            <option value="">Tutti i paesi</option>
            {countries.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <button type="button" className="btn btn-primary btn-sm" onClick={exportCompleteList} disabled={!rows.length}>⬇ Esporta elenco completo in CSV</button>
        </div>
      </section>
      {rows.length ? <ElencoTab key={country} rows={selected} now={now} showToast={showToast} onRowChange={onRowChange} completeList />
        : <div className="fx-card fx-empty">Nessuna destinazione estera riconosciuta nel catalogo importato. Controlla che l’elenco includa paese e categoria degli espositori.</div>}
    </>
  )
}
