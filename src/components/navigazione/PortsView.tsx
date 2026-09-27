'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import { apiFetch } from '@/lib/api'
import {
  ITINERARY_ROLE_LABELS,
  itineraryRoute,
  normalizePortKey,
  ShippingItinerary,
  ShippingPort,
} from '@/lib/shipping-itineraries'

export interface PortWithUsage extends ShippingPort {
  itinerary_count: number
  company_ids: string[]
  company_ids_from_itineraries: string[]
}

interface Props {
  ports: PortWithUsage[] | null
  companies: Array<{ id: string; name: string }>
  reloadPorts: () => Promise<void>
  onOpenCompany: (companyId: string) => void
  showToast: (message: string) => void
}

type SortKey = 'companies' | 'name'

/**
 * Il rovescio della pagina compagnie: si parte dal porto ("chi arriva a
 * Palermo?") e si scende alle compagnie e agli itinerari che ci fanno tappa.
 * Per Speaqi Maps e' la domanda giusta: ogni porto e' una destinazione da
 * vendere a tutte le compagnie che la toccano.
 */
export function PortsView({ ports, companies, reloadPorts, onOpenCompany, showToast }: Props) {
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortKey>('companies')
  const [onlyUsed, setOnlyUsed] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)
  const [itineraries, setItineraries] = useState<ShippingItinerary[] | null>(null)
  const [editing, setEditing] = useState<{ name: string; country: string; unlocode: string; aliases: string; notes: string } | null>(null)
  const [mergeInto, setMergeInto] = useState('')
  const [busy, setBusy] = useState(false)

  const companyName = useMemo(() => new Map(companies.map((company) => [company.id, company.name])), [companies])

  const visible = useMemo(() => {
    const query = normalizePortKey(search)
    return (ports || [])
      .filter((port) => !onlyUsed || port.company_ids.length > 0 || port.itinerary_count > 0)
      .filter((port) => {
        if (!query) return true
        return [port.name, port.unlocode || '', port.country || '', ...port.aliases].some((value) =>
          normalizePortKey(value).includes(query)
        )
      })
      .sort((a, b) =>
        sort === 'companies'
          ? b.company_ids.length - a.company_ids.length || b.itinerary_count - a.itinerary_count || a.name.localeCompare(b.name, 'it')
          : a.name.localeCompare(b.name, 'it')
      )
  }, [ports, search, sort, onlyUsed])

  const openPort = (ports || []).find((port) => port.id === openId) || null

  useEffect(() => {
    if (!openId) return
    let cancelled = false
    setItineraries(null)
    apiFetch<{ itineraries: ShippingItinerary[] }>(`/api/shipping-itineraries?port_id=${encodeURIComponent(openId)}`)
      .then((response) => {
        if (!cancelled) setItineraries(response.itineraries)
      })
      .catch((error) => {
        if (!cancelled) {
          setItineraries([])
          showToast(error instanceof Error ? error.message : 'Impossibile caricare gli itinerari')
        }
      })
    return () => {
      cancelled = true
    }
  }, [openId, showToast])

  function toggle(port: PortWithUsage) {
    setEditing(null)
    setMergeInto('')
    setOpenId((current) => (current === port.id ? null : port.id))
  }

  async function savePort(event: FormEvent) {
    event.preventDefault()
    if (!openPort || !editing) return
    setBusy(true)
    try {
      await apiFetch('/api/shipping-ports', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: openPort.id, ...editing }),
      })
      setEditing(null)
      await reloadPorts()
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Impossibile aggiornare il porto')
    } finally {
      setBusy(false)
    }
  }

  async function merge() {
    if (!openPort || !mergeInto) return
    const target = (ports || []).find((port) => port.id === mergeInto)
    if (!target) return
    if (!window.confirm(`Unire «${openPort.name}» in «${target.name}»? Le tappe passano a ${target.name} e «${openPort.name}» diventa un suo alias.`)) return
    setBusy(true)
    try {
      await apiFetch('/api/shipping-ports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ merge_from: openPort.id, merge_into: target.id }),
      })
      setOpenId(target.id)
      setMergeInto('')
      await reloadPorts()
      showToast(`${openPort.name} unito a ${target.name}`)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Impossibile unire i porti')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!openPort || !window.confirm(`Eliminare il porto «${openPort.name}»?`)) return
    setBusy(true)
    try {
      await apiFetch(`/api/shipping-ports?id=${encodeURIComponent(openPort.id)}`, { method: 'DELETE' })
      setOpenId(null)
      await reloadPorts()
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Impossibile eliminare il porto')
    } finally {
      setBusy(false)
    }
  }

  function renderDetails(port: PortWithUsage) {
    const catalogOnly = port.company_ids.filter((id) => !port.company_ids_from_itineraries.includes(id))
    return (
      <div className="nv-details">
        {port.aliases.length ? (
          <div>
            <span className="nv-dt">Anche detto</span>
            {port.aliases.join(', ')}
          </div>
        ) : null}
        {port.notes ? (
          <div>
            <span className="nv-dt">Note</span>
            {port.notes}
          </div>
        ) : null}

        <div>
          <span className="nv-dt">Compagnie</span>
          {port.company_ids.length ? (
            <span className="nv-chip-list">
              {port.company_ids
                .map((id) => ({ id, name: companyName.get(id) || '?' }))
                .sort((a, b) => a.name.localeCompare(b.name, 'it'))
                .map((company) => (
                  <button key={company.id} type="button" className="nv-chip" onClick={() => onOpenCompany(company.id)}>
                    {company.name}
                    {catalogOnly.includes(company.id) ? ' *' : ''}
                  </button>
                ))}
            </span>
          ) : (
            <span className="nv-muted">nessuna</span>
          )}
          {catalogOnly.length ? (
            <div className="nv-muted">* dal catalogo, senza un itinerario caricato</div>
          ) : null}
        </div>

        <div>
          <span className="nv-dt">Itinerari</span>
          {itineraries === null ? <span className="nv-muted">Caricamento…</span> : null}
          {itineraries && !itineraries.length ? <span className="nv-muted">nessuno</span> : null}
          {itineraries?.length ? (
            <ul className="nv-refs">
              {itineraries.map((itinerary) => {
                const here = itinerary.stops.filter((stop) => stop.port_id === port.id)
                return (
                  <li key={itinerary.id}>
                    <strong>{itinerary.company?.name}</strong> — {itinerary.name}
                    {itinerary.ship ? ` (${itinerary.ship})` : ''}
                    <div className="nv-muted">
                      {here
                        .map((stop) =>
                          [
                            stop.day ? `giorno ${stop.day}` : null,
                            ITINERARY_ROLE_LABELS[stop.role].toLowerCase(),
                            [stop.arrival, stop.departure].filter(Boolean).join('–') || null,
                          ]
                            .filter(Boolean)
                            .join(', ')
                        )
                        .join(' · ')}
                    </div>
                    <div className="nv-muted">{itineraryRoute(itinerary.stops)}</div>
                  </li>
                )
              })}
            </ul>
          ) : null}
        </div>

        {editing ? (
          <form className="nv-port-form" onSubmit={savePort}>
            <input className="fi" value={editing.name} placeholder="Nome" onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            <input className="fi nv-field-short" value={editing.country} placeholder="Paese (IT)" maxLength={2} onChange={(e) => setEditing({ ...editing, country: e.target.value.toUpperCase() })} />
            <input className="fi nv-field-short" value={editing.unlocode} placeholder="UN/LOCODE" maxLength={5} onChange={(e) => setEditing({ ...editing, unlocode: e.target.value.toUpperCase() })} />
            <input className="fi" value={editing.aliases} placeholder="Altri nomi, separati da virgola" onChange={(e) => setEditing({ ...editing, aliases: e.target.value })} />
            <input className="fi" value={editing.notes} placeholder="Note" onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
            <button className="btn btn-primary btn-sm" type="submit" disabled={busy}>Salva</button>
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => setEditing(null)}>Annulla</button>
          </form>
        ) : (
          <div className="nv-port-tools">
            <button
              type="button"
              className="btn-mini"
              onClick={() =>
                setEditing({
                  name: port.name,
                  country: port.country || '',
                  unlocode: port.unlocode || '',
                  aliases: port.aliases.join(', '),
                  notes: port.notes || '',
                })
              }
            >
              Modifica porto
            </button>
            <select className="fi nv-select" value={mergeInto} onChange={(e) => setMergeInto(e.target.value)}>
              <option value="">Unisci in un altro porto…</option>
              {(ports || [])
                .filter((other) => other.id !== port.id)
                .sort((a, b) => a.name.localeCompare(b.name, 'it'))
                .map((other) => (
                  <option key={other.id} value={other.id}>{other.name}</option>
                ))}
            </select>
            {mergeInto ? (
              <button type="button" className="btn-mini" disabled={busy} onClick={merge}>Unisci</button>
            ) : null}
            {port.itinerary_count === 0 ? (
              <button type="button" className="btn-mini" disabled={busy} onClick={remove}>Elimina</button>
            ) : null}
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      <div className="nv-filters">
        <input className="fi nv-search" placeholder="Cerca porto, codice, alias…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="fi nv-select" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
          <option value="companies">Più compagnie prima</option>
          <option value="name">Alfabetico</option>
        </select>
        <label className="nv-toggle">
          <input type="checkbox" checked={onlyUsed} onChange={(e) => setOnlyUsed(e.target.checked)} />
          Solo porti con compagnie
        </label>
      </div>

      {ports === null ? <div className="nv-empty">Caricamento…</div> : null}
      {ports && !visible.length ? (
        <div className="nv-empty">
          {onlyUsed
            ? 'Nessun porto con compagnie. Carica un itinerario dalla scheda di una compagnia, o togli la spunta per vedere tutti i porti.'
            : 'Nessun porto con questi filtri.'}
        </div>
      ) : null}

      {visible.length ? (
        <ul className="nv-list">
          {visible.map((port) => (
            <li key={port.id} className="nv-row">
              <div className="nv-main">
                <div className="nv-name">
                  {port.name}
                  {port.country ? <span className="nv-badge">{port.country}</span> : null}
                  {port.unlocode ? <span className="nv-badge">{port.unlocode}</span> : null}
                </div>
                <div className="nv-meta">
                  {port.company_ids.length === 1 ? '1 compagnia' : `${port.company_ids.length} compagnie`}
                  {' · '}
                  {port.itinerary_count === 1 ? '1 itinerario' : `${port.itinerary_count} itinerari`}
                </div>
              </div>
              <div className="nv-actions">
                <button type="button" className="btn-mini" onClick={() => toggle(port)}>
                  {openId === port.id ? 'Chiudi' : 'Dettagli'}
                </button>
              </div>
              {openId === port.id ? renderDetails(port) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
