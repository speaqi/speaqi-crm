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
import {
  comparePorts,
  formatPassengers,
  GUIDE_STATUS_LABELS,
  GUIDE_STATUSES,
  GuideStatus,
  PORT_REGIONS,
  PORT_SORT_LABELS,
  PortSortKey,
  portsToCsv,
  summarizeGuides,
} from '@/lib/shipping-ports'

export interface PortWithUsage extends ShippingPort {
  itinerary_count: number
  company_ids: string[]
  company_ids_from_itineraries: string[]
}

// Una lista di centinaia di porti si monta a pezzi: filtri, conteggi ed export lavorano comunque su tutti.
const PAGE_SIZE = 120

interface PortForm {
  name: string
  country: string
  unlocode: string
  aliases: string
  notes: string
  region: string
  subregion: string
  destination: string
  cruise_passengers: string
  passengers_year: string
  cruise_calls: string
  stats_source: string
  guide_notes: string
}

function portForm(port: PortWithUsage): PortForm {
  return {
    name: port.name,
    country: port.country || '',
    unlocode: port.unlocode || '',
    aliases: port.aliases.join(', '),
    notes: port.notes || '',
    region: port.region || '',
    subregion: port.subregion || '',
    destination: port.destination || '',
    cruise_passengers: port.cruise_passengers == null ? '' : String(port.cruise_passengers),
    passengers_year: port.passengers_year == null ? '' : String(port.passengers_year),
    cruise_calls: port.cruise_calls == null ? '' : String(port.cruise_calls),
    stats_source: port.stats_source || '',
    guide_notes: port.guide_notes || '',
  }
}

interface Props {
  ports: PortWithUsage[] | null
  companies: Array<{ id: string; name: string }>
  reloadPorts: () => Promise<void>
  onOpenCompany: (companyId: string) => void
  showToast: (message: string) => void
}

/**
 * Il rovescio della pagina compagnie: si parte dal porto ("chi arriva a
 * Palermo?") e si scende alle compagnie e agli itinerari che ci fanno tappa.
 * Ed e' la classifica delle superguide: quanti crocieristi passano da ogni
 * porto, che citta' serve e a che punto e' la sua guida.
 */
export function PortsView({ ports, companies, reloadPorts, onOpenCompany, showToast }: Props) {
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<PortSortKey>('passengers')
  const [region, setRegion] = useState('')
  const [guide, setGuide] = useState<GuideStatus | ''>('')
  const [onlyUsed, setOnlyUsed] = useState(false)
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [openId, setOpenId] = useState<string | null>(null)
  const [itineraries, setItineraries] = useState<ShippingItinerary[] | null>(null)
  const [editing, setEditing] = useState<PortForm | null>(null)
  const [mergeInto, setMergeInto] = useState('')
  const [busy, setBusy] = useState(false)
  const [savingGuide, setSavingGuide] = useState<string | null>(null)

  const companyName = useMemo(() => new Map(companies.map((company) => [company.id, company.name])), [companies])

  // I conteggi in testa seguono ricerca e regione, non il filtro sullo stato: altrimenti cliccarne uno azzererebbe gli altri.
  const scoped = useMemo(() => {
    const query = normalizePortKey(search)
    return (ports || [])
      .filter((port) => !onlyUsed || port.company_ids.length > 0 || port.itinerary_count > 0)
      .filter((port) => !region || (region === '-' ? !port.region : port.region === region))
      .filter((port) => {
        if (!query) return true
        return [port.name, port.destination || '', port.subregion || '', port.unlocode || '', port.country || '', ...port.aliases].some(
          (value) => normalizePortKey(value).includes(query)
        )
      })
  }, [ports, search, region, onlyUsed])

  const visible = useMemo(
    () => scoped.filter((port) => !guide || (port.guide_status || 'none') === guide).sort(comparePorts(sort)),
    [scoped, guide, sort]
  )
  const summary = useMemo(() => summarizeGuides(scoped), [scoped])

  useEffect(() => {
    setLimit(PAGE_SIZE)
  }, [search, region, guide, onlyUsed, sort])

  function exportCsv() {
    const csv = portsToCsv(visible, (id) => companyName.get(id) || '?')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `porti-superguide-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  async function setGuideStatus(port: PortWithUsage, status: GuideStatus) {
    setSavingGuide(port.id)
    try {
      await apiFetch('/api/shipping-ports', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: port.id, guide_status: status }),
      })
      await reloadPorts()
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Impossibile aggiornare la superguida')
    } finally {
      setSavingGuide(null)
    }
  }

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
        {port.cruise_passengers != null || port.cruise_calls != null ? (
          <div>
            <span className="nv-dt">Traffico</span>
            {[
              port.cruise_passengers != null ? `${port.cruise_passengers.toLocaleString('it-IT')} crocieristi` : null,
              port.cruise_calls != null ? `${port.cruise_calls.toLocaleString('it-IT')} scali` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
            {port.passengers_year ? ` nel ${port.passengers_year}` : ''}
            {port.stats_source ? (
              <a className="nv-source" href={port.stats_source} target="_blank" rel="noreferrer">fonte</a>
            ) : null}
          </div>
        ) : null}
        {port.region || port.subregion ? (
          <div>
            <span className="nv-dt">Dove</span>
            {[port.region, port.subregion].filter(Boolean).join(' · ')}
          </div>
        ) : null}
        {port.guide_notes ? (
          <div>
            <span className="nv-dt">Superguida</span>
            {port.guide_notes}
          </div>
        ) : null}
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
            <input className="fi" value={editing.destination} placeholder="Città servita (es. Roma)" onChange={(e) => setEditing({ ...editing, destination: e.target.value })} />
            <select className="fi nv-select" value={editing.region} onChange={(e) => setEditing({ ...editing, region: e.target.value })}>
              <option value="">Regione…</option>
              {PORT_REGIONS.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
            <input className="fi" value={editing.subregion} placeholder="Area (es. Fiordi norvegesi)" onChange={(e) => setEditing({ ...editing, subregion: e.target.value })} />
            <input className="fi nv-field-num" value={editing.cruise_passengers} inputMode="numeric" placeholder="Passeggeri/anno" onChange={(e) => setEditing({ ...editing, cruise_passengers: e.target.value })} />
            <input className="fi nv-field-short" value={editing.passengers_year} inputMode="numeric" maxLength={4} placeholder="Anno" onChange={(e) => setEditing({ ...editing, passengers_year: e.target.value })} />
            <input className="fi nv-field-num" value={editing.cruise_calls} inputMode="numeric" placeholder="Scali/anno" onChange={(e) => setEditing({ ...editing, cruise_calls: e.target.value })} />
            <input className="fi" value={editing.stats_source} placeholder="Fonte della statistica (link)" onChange={(e) => setEditing({ ...editing, stats_source: e.target.value })} />
            <input className="fi" value={editing.guide_notes} placeholder="Note sulla superguida" onChange={(e) => setEditing({ ...editing, guide_notes: e.target.value })} />
            <button className="btn btn-primary btn-sm" type="submit" disabled={busy}>Salva</button>
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => setEditing(null)}>Annulla</button>
          </form>
        ) : (
          <div className="nv-port-tools">
            <button
              type="button"
              className="btn-mini"
              onClick={() => setEditing(portForm(port))}
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
      <div className="nv-stats">
        <button type="button" className={`nv-stat${guide === '' ? ' is-active' : ''}`} onClick={() => setGuide('')}>
          <strong>{summary.total}</strong>
          <span>Porti{summary.passengers ? ` · ${formatPassengers(summary.passengers)} crocieristi` : ''}</span>
        </button>
        {(['none', 'planned', 'in_progress', 'live'] as GuideStatus[]).map((status) => (
          <button
            key={status}
            type="button"
            className={`nv-stat${guide === status ? ' is-active' : ''}`}
            onClick={() => setGuide(guide === status ? '' : status)}
          >
            <strong>{summary.byStatus[status]}</strong>
            <span>
              {status === 'none' ? 'Superguida da valutare' : GUIDE_STATUS_LABELS[status]}
              {status === 'live' && summary.passengers
                ? ` · ${Math.round((summary.covered / summary.passengers) * 100)}% dei crocieristi`
                : ''}
            </span>
          </button>
        ))}
      </div>

      <div className="nv-filters">
        <input className="fi nv-search" placeholder="Cerca porto, città, area, codice…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="fi nv-select" value={region} onChange={(e) => setRegion(e.target.value)}>
          <option value="">Tutto il mondo</option>
          {PORT_REGIONS.map((item) => (
            <option key={item} value={item}>{item}</option>
          ))}
          <option value="-">Senza regione</option>
        </select>
        <select className="fi nv-select" value={guide} onChange={(e) => setGuide(e.target.value as GuideStatus | '')}>
          <option value="">Superguida: tutte</option>
          {GUIDE_STATUSES.map((status) => (
            <option key={status} value={status}>{GUIDE_STATUS_LABELS[status]}</option>
          ))}
        </select>
        <select className="fi nv-select" value={sort} onChange={(e) => setSort(e.target.value as PortSortKey)}>
          {(Object.keys(PORT_SORT_LABELS) as PortSortKey[]).map((key) => (
            <option key={key} value={key}>{PORT_SORT_LABELS[key]}</option>
          ))}
        </select>
        <label className="nv-toggle">
          <input type="checkbox" checked={onlyUsed} onChange={(e) => setOnlyUsed(e.target.checked)} />
          Solo porti con compagnie
        </label>
        <button type="button" className="btn-mini" disabled={!visible.length} onClick={exportCsv}>
          Esporta CSV
        </button>
      </div>

      {ports === null ? <div className="nv-empty">Caricamento…</div> : null}
      {ports && !visible.length ? <div className="nv-empty">Nessun porto con questi filtri.</div> : null}

      {visible.length ? (
        <>
          <div className="nv-count">
            {visible.length === 1 ? '1 porto' : `${visible.length} porti`}
          </div>
          <ul className="nv-list">
            {visible.slice(0, limit).map((port, index) => (
              <li key={port.id} className={`nv-row nv-port-row nv-guide-${port.guide_status || 'none'}`}>
                <div className="nv-main">
                  <div className="nv-name">
                    {sort !== 'name' ? <span className="nv-rank">{index + 1}</span> : null}
                    {port.name}
                    {port.destination ? <span className="nv-dest">→ {port.destination}</span> : null}
                    {port.country ? <span className="nv-badge">{port.country}</span> : null}
                    {port.is_homeport ? <span className="nv-badge nv-badge-route" title="Porto d'imbarco">imbarco</span> : null}
                  </div>
                  <div className="nv-meta">
                    {[
                      port.cruise_passengers != null
                        ? `${formatPassengers(port.cruise_passengers)} crocieristi${port.passengers_year ? ` (${port.passengers_year})` : ''}`
                        : null,
                      port.company_ids.length === 1 ? '1 compagnia' : `${port.company_ids.length} compagnie`,
                      port.itinerary_count === 1 ? '1 itinerario' : `${port.itinerary_count} itinerari`,
                      port.subregion || port.region,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </div>
                <select
                  className={`fi nv-select nv-guide-select is-${port.guide_status || 'none'}`}
                  aria-label={`Superguida di ${port.name}`}
                  value={port.guide_status || 'none'}
                  disabled={savingGuide === port.id}
                  onChange={(e) => setGuideStatus(port, e.target.value as GuideStatus)}
                >
                  {GUIDE_STATUSES.map((status) => (
                    <option key={status} value={status}>{GUIDE_STATUS_LABELS[status]}</option>
                  ))}
                </select>
                <div className="nv-actions">
                  <button type="button" className="btn-mini" onClick={() => toggle(port)}>
                    {openId === port.id ? 'Chiudi' : 'Dettagli'}
                  </button>
                </div>
                {openId === port.id ? renderDetails(port) : null}
              </li>
            ))}
          </ul>
          {visible.length > limit ? (
            <button type="button" className="btn btn-ghost btn-sm nv-more" onClick={() => setLimit(limit + PAGE_SIZE)}>
              Mostra altri {Math.min(PAGE_SIZE, visible.length - limit)} di {visible.length - limit}
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
