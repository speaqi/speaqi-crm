'use client'

import { FormEvent, useMemo, useState } from 'react'
import { apiFetch } from '@/lib/api'
import {
  buildPortIndex,
  formatItineraryDate,
  ITINERARY_ROLE_LABELS,
  itineraryToText,
  ItineraryStopRole,
  parseDepartureDates,
  parseItineraryText,
  resolvePort,
  ShippingItinerary,
  ShippingPort,
} from '@/lib/shipping-itineraries'

// Si incolla l'itinerario come lo mostra il sito della compagnia; l'anteprima
// dice subito quale porto ha riconosciuto per ogni riga, e quale verrebbe creato
// da zero. Un porto nuovo per un nome scritto male va visto qui, non dopo.

const NEW_PORT = '__new__'

interface Props {
  company: { id: string; name: string }
  ports: ShippingPort[]
  itinerary?: ShippingItinerary | null
  onSaved: (itinerary: ShippingItinerary, createdPorts: ShippingPort[]) => void
  onCancel: () => void
  showToast: (message: string) => void
}

const PLACEHOLDER = `Giorno 1 · Genova, Italia (imbarco) 17:00
Giorno 2 · Napoli 13:00 - 19:00
Giorno 3 · Messina 08:00 - 18:00
Navigazione
Giorno 5 · La Valletta, Malta 08:00 - 18:00`

export function ItineraryEditor({ company, ports, itinerary, onSaved, onCancel, showToast }: Props) {
  const [name, setName] = useState(itinerary?.name || '')
  const [ship, setShip] = useState(itinerary?.ship || '')
  const [nights, setNights] = useState(itinerary?.nights != null ? String(itinerary.nights) : '')
  const [season, setSeason] = useState(itinerary?.season || '')
  const [dates, setDates] = useState((itinerary?.departure_dates || []).map(formatItineraryDate).join(', '))
  const [sourceUrl, setSourceUrl] = useState(itinerary?.source_url || '')
  const [notes, setNotes] = useState(itinerary?.notes || '')
  const [stopsText, setStopsText] = useState(itinerary ? itineraryToText(itinerary.stops) : '')
  // Porto scelto a mano per una riga, per "numero riga + nome letto": se il testo cambia, la scelta decade.
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [roleOverrides, setRoleOverrides] = useState<Record<string, ItineraryStopRole>>({})
  const [saving, setSaving] = useState(false)

  const index = useMemo(() => buildPortIndex(ports), [ports])
  const parsed = useMemo(() => parseItineraryText(stopsText), [stopsText])
  const dateCheck = useMemo(() => parseDepartureDates(dates), [dates])
  const sortedPorts = useMemo(() => [...ports].sort((a, b) => a.name.localeCompare(b.name, 'it')), [ports])

  const rows = parsed.stops.map((stop, position) => {
    const key = `${position}:${stop.name}:${stop.alt || ''}`
    const matched = resolvePort(index, stop)
    const choice = overrides[key] ?? (matched ? matched.id : NEW_PORT)
    return { key, stop, matched, choice, role: roleOverrides[key] ?? stop.role }
  })
  const newPorts = rows.filter((row) => row.choice === NEW_PORT)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return showToast("Dai un nome all'itinerario")
    if (!rows.length) return showToast('Incolla le tappe: una per riga')
    if (dateCheck.invalid.length) return showToast(`Date non valide: ${dateCheck.invalid.join(', ')}`)

    setSaving(true)
    try {
      const response = await apiFetch<{ itinerary: ShippingItinerary; created_ports: ShippingPort[] }>(
        '/api/shipping-itineraries',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: itinerary?.id,
            company_id: company.id,
            name,
            ship,
            nights,
            season,
            departure_dates: dateCheck.dates,
            source_url: sourceUrl,
            notes,
            stops: rows.map((row) => ({
              port_id: row.choice === NEW_PORT ? null : row.choice,
              name: row.stop.name,
              alt: row.stop.alt,
              country: row.stop.country,
              day: row.stop.day,
              role: row.role,
              arrival: row.stop.arrival,
              departure: row.stop.departure,
              overnight: row.stop.overnight,
            })),
          }),
        }
      )
      onSaved(response.itinerary, response.created_ports || [])
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Impossibile salvare l'itinerario")
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="nv-editor" onSubmit={submit}>
      <div className="nv-editor-title">
        {itinerary ? 'Modifica itinerario' : 'Nuovo itinerario'} · {company.name}
      </div>
      <div className="nv-editor-grid">
        <label className="nv-field nv-field-wide">
          <span className="fl">Nome</span>
          <input className="fi" value={name} maxLength={160} placeholder="Es. Mediterraneo occidentale 7 notti" onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="nv-field">
          <span className="fl">Nave</span>
          <input className="fi" value={ship} maxLength={120} placeholder="MSC World Europa" onChange={(e) => setShip(e.target.value)} />
        </label>
        <label className="nv-field nv-field-short">
          <span className="fl">Notti</span>
          <input className="fi" inputMode="numeric" value={nights} onChange={(e) => setNights(e.target.value.replace(/\D/g, ''))} />
        </label>
        <label className="nv-field">
          <span className="fl">Stagione</span>
          <input className="fi" value={season} maxLength={80} placeholder="Estate 2026" onChange={(e) => setSeason(e.target.value)} />
        </label>
        <label className="nv-field nv-field-wide">
          <span className="fl">Date di partenza</span>
          <input className="fi" value={dates} placeholder="13/06/2026, 20/06/2026" onChange={(e) => setDates(e.target.value)} />
          {dateCheck.invalid.length ? <small className="nv-warn">Non valide: {dateCheck.invalid.join(', ')}</small> : null}
        </label>
        <label className="nv-field nv-field-wide">
          <span className="fl">Fonte (link)</span>
          <input className="fi" value={sourceUrl} maxLength={500} placeholder="https://…" onChange={(e) => setSourceUrl(e.target.value)} />
        </label>
      </div>

      <label className="nv-field">
        <span className="fl">Tappe — una per riga, come le copi dal sito</span>
        <textarea
          className="fi nv-stops-input"
          rows={8}
          value={stopsText}
          placeholder={PLACEHOLDER}
          onChange={(e) => {
            setStopsText(e.target.value)
            setOverrides({})
            setRoleOverrides({})
          }}
        />
      </label>

      {rows.length ? (
        <div className="nv-preview">
          <div className="nv-preview-head">
            {rows.length} {rows.length === 1 ? 'tappa' : 'tappe'}
            {parsed.seaDays ? ` · ${parsed.seaDays} ${parsed.seaDays === 1 ? 'giorno' : 'giorni'} di navigazione` : ''}
            {newPorts.length ? <span className="nv-warn"> · {newPorts.length} porti nuovi da creare</span> : null}
          </div>
          <table className="nv-preview-table">
            <thead>
              <tr>
                <th>Giorno</th>
                <th>Letto</th>
                <th>Porto</th>
                <th>Ruolo</th>
                <th>Arrivo</th>
                <th>Partenza</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className={row.choice === NEW_PORT ? 'is-new' : ''}>
                  <td>{row.stop.day ?? '—'}</td>
                  <td className="nv-preview-read">
                    {row.stop.name}
                    {row.stop.alt ? ` (${row.stop.alt})` : ''}
                  </td>
                  <td>
                    <select
                      className="fi nv-preview-select"
                      value={row.choice}
                      onChange={(e) => setOverrides((current) => ({ ...current, [row.key]: e.target.value }))}
                    >
                      <option value={NEW_PORT}>➕ Nuovo: {row.stop.name}</option>
                      {sortedPorts.map((port) => (
                        <option key={port.id} value={port.id}>
                          {port.name}
                          {port.country ? ` (${port.country})` : ''}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      className="fi nv-preview-select"
                      value={row.role}
                      onChange={(e) =>
                        setRoleOverrides((current) => ({ ...current, [row.key]: e.target.value as ItineraryStopRole }))
                      }
                    >
                      {(Object.keys(ITINERARY_ROLE_LABELS) as ItineraryStopRole[]).map((role) => (
                        <option key={role} value={role}>{ITINERARY_ROLE_LABELS[role]}</option>
                      ))}
                    </select>
                  </td>
                  <td>{row.stop.arrival || '—'}</td>
                  <td>
                    {row.stop.departure || '—'}
                    {row.stop.overnight ? ' 🌙' : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {parsed.ignored.length ? (
            <div className="nv-warn">Righe ignorate: {parsed.ignored.join(' · ')}</div>
          ) : null}
        </div>
      ) : null}

      <label className="nv-field">
        <span className="fl">Note</span>
        <input className="fi" value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} />
      </label>

      <div className="nv-editor-actions">
        <button className="btn btn-primary" type="submit" disabled={saving}>
          {saving ? 'Salvo…' : 'Salva itinerario'}
        </button>
        <button className="btn btn-ghost" type="button" onClick={onCancel} disabled={saving}>
          Annulla
        </button>
      </div>
    </form>
  )
}
