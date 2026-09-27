'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import {
  formatItineraryDate,
  ITINERARY_ROLE_LABELS,
  ShippingItinerary,
  ShippingPort,
} from '@/lib/shipping-itineraries'
import { ItineraryEditor } from './ItineraryEditor'

interface Props {
  company: { id: string; name: string }
  ports: ShippingPort[]
  loadPorts: () => Promise<void>
  onChanged: () => void
  showToast: (message: string) => void
}

/** Gli itinerari di una compagnia, con le tappe in ordine e l'editor per aggiungerne. */
export function CompanyItineraries({ company, ports, loadPorts, onChanged, showToast }: Props) {
  const [itineraries, setItineraries] = useState<ShippingItinerary[] | null>(null)
  const [editing, setEditing] = useState<ShippingItinerary | 'new' | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const response = await apiFetch<{ itineraries: ShippingItinerary[] }>(
        `/api/shipping-itineraries?company_id=${encodeURIComponent(company.id)}`
      )
      setItineraries(response.itineraries)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Impossibile caricare gli itinerari')
      setItineraries([])
    }
  }, [company.id, showToast])

  useEffect(() => {
    load()
  }, [load])

  async function openEditor(target: ShippingItinerary | 'new') {
    if (!ports.length) await loadPorts()
    setEditing(target)
  }

  async function remove(itinerary: ShippingItinerary) {
    if (!window.confirm(`Eliminare l'itinerario «${itinerary.name}»?`)) return
    setBusyId(itinerary.id)
    try {
      await apiFetch(`/api/shipping-itineraries?id=${encodeURIComponent(itinerary.id)}`, { method: 'DELETE' })
      setItineraries((current) => (current || []).filter((row) => row.id !== itinerary.id))
      onChanged()
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Impossibile eliminare l'itinerario")
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="nv-itineraries">
      <div className="nv-itineraries-head">
        <span className="nv-dt">Itinerari</span>
        {editing ? null : (
          <button type="button" className="btn-mini" onClick={() => openEditor('new')}>
            + Aggiungi itinerario
          </button>
        )}
      </div>

      {editing ? (
        <ItineraryEditor
          company={company}
          ports={ports}
          itinerary={editing === 'new' ? null : editing}
          showToast={showToast}
          onCancel={() => setEditing(null)}
          onSaved={async (saved, createdPorts) => {
            setItineraries((current) => {
              const rest = (current || []).filter((row) => row.id !== saved.id)
              return [...rest, saved].sort((a, b) => a.name.localeCompare(b.name, 'it'))
            })
            setEditing(null)
            if (createdPorts.length) {
              showToast(`Itinerario salvato. Porti nuovi: ${createdPorts.map((port) => port.name).join(', ')}`)
              await loadPorts()
            } else {
              showToast('Itinerario salvato')
            }
            onChanged()
          }}
        />
      ) : null}

      {itineraries === null ? <div className="nv-muted">Caricamento…</div> : null}
      {itineraries && !itineraries.length && !editing ? (
        <div className="nv-muted">
          Nessun itinerario. Aggiungine uno incollando le tappe dal sito della compagnia.
        </div>
      ) : null}

      {itineraries?.map((itinerary) => (
        <div key={itinerary.id} className="nv-itinerary">
          <div className="nv-itinerary-top">
            <div>
              <strong>{itinerary.name}</strong>
              <span className="nv-muted">
                {[
                  itinerary.ship,
                  itinerary.nights != null ? `${itinerary.nights} notti` : null,
                  itinerary.season,
                ]
                  .filter(Boolean)
                  .map((part) => ` · ${part}`)
                  .join('')}
              </span>
            </div>
            <div className="nv-actions">
              <button type="button" className="btn-mini" disabled={busyId === itinerary.id} onClick={() => openEditor(itinerary)}>
                Modifica
              </button>
              <button type="button" className="btn-mini" disabled={busyId === itinerary.id} onClick={() => remove(itinerary)}>
                Elimina
              </button>
            </div>
          </div>
          <ol className="nv-route">
            {itinerary.stops.map((stop, index) => (
              <li key={stop.id || stop.position} className="nv-route-item">
                {index > 0 ? <span className="nv-route-arrow" aria-hidden="true">→</span> : null}
                <span className={`nv-stop nv-stop-${stop.role}`} title={ITINERARY_ROLE_LABELS[stop.role]}>
                  <span className="nv-stop-day">{stop.day ? `G${stop.day}` : stop.position}</span>
                  <span className="nv-stop-name">{stop.port?.name || '?'}</span>
                  {stop.arrival || stop.departure ? (
                    <span className="nv-stop-time">{[stop.arrival, stop.departure].filter(Boolean).join('–')}</span>
                  ) : null}
                  {stop.overnight ? <span title="Pernottamento in porto">🌙</span> : null}
                </span>
              </li>
            ))}
          </ol>
          {itinerary.departure_dates.length ? (
            <div className="nv-muted">
              Partenze: {itinerary.departure_dates.slice(0, 12).map(formatItineraryDate).join(', ')}
              {itinerary.departure_dates.length > 12 ? ` e altre ${itinerary.departure_dates.length - 12}` : ''}
            </div>
          ) : null}
          {itinerary.source_url ? (
            <a className="nv-source" href={itinerary.source_url} target="_blank" rel="noreferrer">
              fonte
            </a>
          ) : null}
        </div>
      ))}
    </div>
  )
}
