'use client'

import 'leaflet/dist/leaflet.css'
import type * as Leaflet from 'leaflet'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { ITINERARY_ROLE_LABELS, ShippingItinerary } from '@/lib/shipping-itineraries'
import {
  itineraryPoints,
  legArc,
  legArrow,
  parseCoordinates,
  routeColor,
  routeLegs,
  RoutePoint,
  shipsOf,
} from '@/lib/shipping-routes'

// Mappa del mondo con gli itinerari caricati: si sceglie una compagnia e si
// vedono tutte le sue rotte, con una freccia per ogni tratta; si sceglie una
// nave (es. MSC World Europa) e restano solo le sue. Le linee collegano i porti
// nell'ordine dell'itinerario, non seguono la rotta vera della nave.

interface Props {
  onOpenCompany: (companyId: string) => void
  showToast: (message: string) => void
}

const ALL = 'all'

// Napoli e Civitavecchia sono i due mercati da cui si parte: si vedono subito.
const HOME_PORTS = new Set(['napoli', 'civitavecchia'])
const HOME_RING = '#e8590c'

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] || char)
}

function stopLine(point: RoutePoint) {
  const role = point.role === 'call' ? '' : ` · ${ITINERARY_ROLE_LABELS[point.role]}`
  const times = [point.arrival, point.departure].filter(Boolean).join('–')
  return `${point.day ? `G${point.day}` : `#${point.position}`}${role}${times ? ` · ${times}` : ''}${point.overnight ? ' · 🌙' : ''}`
}

interface PortVisit {
  point: RoutePoint
  itinerary: ShippingItinerary
  color: string
}

export function RoutesMap({ onOpenCompany, showToast }: Props) {
  const [itineraries, setItineraries] = useState<ShippingItinerary[] | null>(null)
  const [companyId, setCompanyId] = useState<string>(ALL)
  const [shipKey, setShipKey] = useState<string>(ALL)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [focusId, setFocusId] = useState<string | null>(null)
  const [placing, setPlacing] = useState<{ port_id: string; name: string } | null>(null)
  const [placeText, setPlaceText] = useState('')
  const [saving, setSaving] = useState(false)

  const mapElement = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<Leaflet.Map | null>(null)
  const layerRef = useRef<Leaflet.LayerGroup | null>(null)
  const arrowLayerRef = useRef<Leaflet.LayerGroup | null>(null)
  const arrowsRef = useRef<Array<{ marker: Leaflet.Marker; from: Leaflet.LatLngExpression; to: Leaflet.LatLngExpression }>>([])
  const leafletRef = useRef<typeof Leaflet | null>(null)
  const [mapReady, setMapReady] = useState(false)

  const load = useCallback(async () => {
    try {
      const response = await apiFetch<{ itineraries: ShippingItinerary[] }>('/api/shipping-itineraries')
      setItineraries(response.itineraries)
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Impossibile caricare gli itinerari')
      setItineraries([])
    }
  }, [showToast])

  useEffect(() => {
    load()
  }, [load])

  // Leaflet tocca `window` appena importato: lo si carica solo nel browser.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const L = await import('leaflet')
      if (cancelled || !mapElement.current || mapRef.current) return
      leafletRef.current = L
      const map = L.map(mapElement.current, { worldCopyJump: true, minZoom: 2, zoomSnap: 0.5 }).setView([38, 12], 3)
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 12,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map)
      layerRef.current = L.layerGroup().addTo(map)
      arrowLayerRef.current = L.layerGroup().addTo(map)
      mapRef.current = map
      map.on('zoomend', () => refreshArrows())
      setMapReady(true)
    })()
    return () => {
      cancelled = true
      mapRef.current?.remove()
      mapRef.current = null
      layerRef.current = null
      arrowLayerRef.current = null
    }
  }, [])

  // A vista mondo cento frecce su un Mediterraneo largo tre centimetri sono una
  // macchia: una freccia si mostra solo se la sua tratta e' lunga a schermo.
  // Zoomando compaiono da sole.
  function refreshArrows() {
    const map = mapRef.current
    const layer = arrowLayerRef.current
    if (!map || !layer) return
    layer.clearLayers()
    for (const arrow of arrowsRef.current) {
      const a = map.latLngToLayerPoint(arrow.from)
      const b = map.latLngToLayerPoint(arrow.to)
      if (a.distanceTo(b) >= 56) arrow.marker.addTo(layer)
    }
  }

  const companies = useMemo(() => {
    const map = new Map<string, { id: string; name: string; count: number }>()
    for (const itinerary of itineraries || []) {
      const entry = map.get(itinerary.company_id) || {
        id: itinerary.company_id,
        name: itinerary.company?.name || '?',
        count: 0,
      }
      entry.count += 1
      map.set(itinerary.company_id, entry)
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'it'))
  }, [itineraries])

  const allShips = useMemo(() => shipsOf(itineraries || []), [itineraries])
  const ships = useMemo(
    () => (companyId === ALL ? allShips : allShips.filter((ship) => ship.company_id === companyId)),
    [allShips, companyId]
  )
  const selectedShip = allShips.find((ship) => ship.key === shipKey) || null

  // Gli itinerari nel perimetro scelto (compagnia, poi nave), prima di spegnerne a mano.
  const scoped = useMemo(() => {
    let list = itineraries || []
    if (companyId !== ALL) list = list.filter((row) => row.company_id === companyId)
    if (selectedShip) {
      const ids = new Set(selectedShip.itinerary_ids)
      list = list.filter((row) => ids.has(row.id))
    }
    return [...list].sort(
      (a, b) =>
        (a.company?.name || '').localeCompare(b.company?.name || '', 'it') ||
        (a.ship || '').localeCompare(b.ship || '', 'it') ||
        a.name.localeCompare(b.name, 'it')
    )
  }, [itineraries, companyId, selectedShip])

  // Con tutte le compagnie il colore dice la compagnia; dentro una compagnia dice l'itinerario.
  const colorOf = useMemo(() => {
    const colors = new Map<string, string>()
    if (companyId === ALL && !selectedShip) {
      const companyIndex = new Map(companies.map((company, index) => [company.id, index]))
      for (const itinerary of scoped) colors.set(itinerary.id, routeColor(companyIndex.get(itinerary.company_id) || 0))
    } else {
      scoped.forEach((itinerary, index) => colors.set(itinerary.id, routeColor(index)))
    }
    return colors
  }, [scoped, companyId, selectedShip, companies])

  const visible = useMemo(
    () => scoped.filter((row) => !hidden.has(row.id) && (!focusId || row.id === focusId)),
    [scoped, hidden, focusId]
  )

  const drawn = useMemo(() => visible.map((itinerary) => ({ itinerary, ...itineraryPoints(itinerary) })), [visible])

  const missing = useMemo(() => {
    const map = new Map<string, { port_id: string; name: string; itineraries: number }>()
    for (const row of drawn) {
      for (const port of row.missing) {
        const entry = map.get(port.port_id) || { ...port, itineraries: 0 }
        entry.itineraries += 1
        map.set(port.port_id, entry)
      }
    }
    return Array.from(map.values()).sort((a, b) => b.itineraries - a.itineraries || a.name.localeCompare(b.name, 'it'))
  }, [drawn])

  const summary = useMemo(() => {
    const ports = new Set<string>()
    let legs = 0
    for (const row of drawn) {
      row.points.forEach((point) => ports.add(point.port_id))
      legs += routeLegs(row.points).length
    }
    return { ports: ports.size, legs }
  }, [drawn])

  const focusFrom = useCallback((companyValue: string, shipValue: string) => {
    setCompanyId(companyValue)
    setShipKey(shipValue)
    setHidden(new Set())
    setFocusId(null)
  }, [])

  // Disegno: tutto il gruppo si rifa' a ogni cambio di filtro. Sono al massimo
  // qualche centinaio di tratte, e rifare e' piu' semplice che riconciliare.
  useEffect(() => {
    const L = leafletRef.current
    const map = mapRef.current
    const layer = layerRef.current
    if (!mapReady || !L || !map || !layer) return
    layer.clearLayers()
    arrowsRef.current = []

    const single = drawn.length === 1
    const visits = new Map<string, PortVisit[]>()
    const bounds: Leaflet.LatLngExpression[] = []

    drawn.forEach((row, rowIndex) => {
      const color = colorOf.get(row.itinerary.id) || routeColor(rowIndex)
      // Tratte uguali di itinerari diversi (Marsiglia → Barcellona compare dieci
      // volte) si aprono a ventaglio: curvatura diversa per ogni itinerario.
      const bend = 0.6 + (rowIndex % 5) * 0.35
      const label = `${row.itinerary.company?.name || ''} · ${row.itinerary.ship || 'nave n.d.'} · ${row.itinerary.name}`
      for (const leg of routeLegs(row.points, bend)) {
        const arc = legArc(leg.from, leg.to, leg.bend)
        const line = L.polyline(
          arc.map((point) => [point.lat, point.lng] as [number, number]),
          { color, weight: single ? 3.5 : 2.5, opacity: 0.85, lineCap: 'round' }
        )
        line.bindTooltip(`${escapeHtml(leg.from.name)} → ${escapeHtml(leg.to.name)}<br><span class="nv-map-tip">${escapeHtml(label)}</span>`, {
          sticky: true,
        })
        line.on('click', () => setFocusId((current) => (current === row.itinerary.id ? null : row.itinerary.id)))
        line.addTo(layer)
        const arrow = legArrow(arc)
        const marker = L.marker([arrow.point.lat, arrow.point.lng], {
          interactive: false,
          keyboard: false,
          icon: L.divIcon({
            className: 'nv-map-arrow',
            iconSize: [20, 20],
            iconAnchor: [10, 10],
            html: `<svg viewBox="0 0 20 20" width="20" height="20" style="transform: rotate(${arrow.angle.toFixed(1)}deg)"><path d="M3 3 L18 10 L3 17 L7 10 Z" fill="${color}" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>`,
          }),
        })
        arrowsRef.current.push({ marker, from: [leg.from.lat, leg.from.lng], to: [arc[arc.length - 1].lat, arc[arc.length - 1].lng] })
      }
      for (const point of row.points) {
        const list = visits.get(point.port_id) || []
        list.push({ point, itinerary: row.itinerary, color })
        visits.set(point.port_id, list)
        bounds.push([point.lat, point.lng])
      }
    })

    for (const [portId, list] of Array.from(visits.entries())) {
      const first = list[0].point
      const itineraryCount = new Set(list.map((visit) => visit.itinerary.id)).size
      const home = list.some((visit) => HOME_PORTS.has(visit.itinerary.stops.find((stop) => stop.port_id === portId)?.port?.slug || ''))
      const turnaround = list.some((visit) => visit.point.role !== 'call')
      const rows = list
        .slice(0, 12)
        .map(
          (visit) =>
            `<li><span class="nv-map-dot" style="background:${visit.color}"></span>${escapeHtml(visit.itinerary.ship || visit.itinerary.company?.name || '')} — ${escapeHtml(visit.itinerary.name)} <em>${escapeHtml(stopLine(visit.point))}</em></li>`
        )
        .join('')
      const more = list.length > 12 ? `<li><em>e altre ${list.length - 12} soste</em></li>` : ''
      const popup = `<strong>${escapeHtml(first.name)}</strong>${first.country ? ` <span class="nv-map-tip">${escapeHtml(first.country)}</span>` : ''}<div class="nv-map-tip">${itineraryCount === 1 ? '1 itinerario' : `${itineraryCount} itinerari`}</div><ul class="nv-map-popup">${rows}${more}</ul>`

      if (single) {
        // Con un itinerario solo, ogni tappa porta il suo numero d'ordine.
        const numbers = list.map((visit) => visit.point.position).join('·')
        L.marker([first.lat, first.lng], {
          icon: L.divIcon({
            className: `nv-map-num${turnaround ? ' is-turn' : ''}${home ? ' is-home' : ''}`,
            iconSize: [26, 26],
            iconAnchor: [13, 13],
            html: `<span style="border-color:${list[0].color}">${escapeHtml(numbers)}</span>`,
          }),
        })
          .bindTooltip(escapeHtml(first.name), { permanent: true, direction: 'right', offset: [14, 0], className: 'nv-map-label' })
          .bindPopup(popup)
          .addTo(layer)
      } else {
        L.circleMarker([first.lat, first.lng], {
          radius: Math.min(4 + itineraryCount * 1.2, 13),
          color: home ? HOME_RING : '#ffffff',
          weight: home ? 3.5 : 1.5,
          fillColor: turnaround ? '#16192e' : list[0].color,
          fillOpacity: 0.95,
        })
          .bindTooltip(`${escapeHtml(first.name)} · ${itineraryCount}`, { direction: 'top' })
          .bindPopup(popup)
          .addTo(layer)
      }
    }

    // Se fitBounds non cambia zoom non scatta 'zoomend': le frecce si ricalcolano comunque.
    if (bounds.length) map.fitBounds(L.latLngBounds(bounds), { padding: [36, 36], maxZoom: 7, animate: false })
    refreshArrows()
  }, [drawn, colorOf, mapReady])

  async function savePosition() {
    if (!placing) return
    const coords = parseCoordinates(placeText)
    if (!coords) {
      showToast('Scrivi latitudine e longitudine, es. 40.8359, 14.2488 (o incolla un link di Google Maps)')
      return
    }
    setSaving(true)
    try {
      await apiFetch('/api/shipping-ports', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: placing.port_id, latitude: coords.lat, longitude: coords.lng }),
      })
      showToast(`${placing.name} posizionato`)
      setPlacing(null)
      setPlaceText('')
      await load()
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Impossibile salvare la posizione')
    } finally {
      setSaving(false)
    }
  }

  function toggle(id: string) {
    setFocusId(null)
    setHidden((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const shownCount = scoped.filter((row) => !hidden.has(row.id)).length

  return (
    <div className="nv-map-wrap">
      <aside className="nv-map-side">
        <label className="nv-field">
          <span className="nv-dt">Compagnia</span>
          <select
            className="fi"
            value={companyId}
            onChange={(event) => focusFrom(event.target.value, ALL)}
          >
            <option value={ALL}>Tutte le compagnie ({companies.length})</option>
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name} ({company.count})
              </option>
            ))}
          </select>
        </label>

        <label className="nv-field">
          <span className="nv-dt">Nave</span>
          <select
            className="fi"
            value={shipKey}
            onChange={(event) => {
              const ship = allShips.find((row) => row.key === event.target.value)
              focusFrom(ship ? ship.company_id : companyId, event.target.value)
            }}
            disabled={!ships.length}
          >
            <option value={ALL}>{ships.length ? `Tutte le navi (${ships.length})` : 'Nessuna nave indicata'}</option>
            {ships.map((ship) => (
              <option key={ship.key} value={ship.key}>
                {companyId === ALL ? `${ship.company_name} — ` : ''}
                {ship.name} ({ship.itinerary_ids.length})
              </option>
            ))}
          </select>
        </label>

        {selectedShip ? (
          <div className="nv-map-ship">
            🚢 <strong>{selectedShip.name}</strong>
            <span className="nv-muted">
              {' '}
              · {selectedShip.itinerary_ids.length === 1 ? '1 itinerario' : `${selectedShip.itinerary_ids.length} itinerari`}
            </span>
          </div>
        ) : null}

        <div className="nv-map-count">
          {itineraries === null
            ? 'Caricamento…'
            : `${shownCount} di ${scoped.length} itinerari · ${summary.ports} porti · ${summary.legs} tratte`}
        </div>

        {scoped.length > 1 ? (
          <div className="nv-map-bulk">
            <button type="button" className="btn-mini" onClick={() => { setHidden(new Set()); setFocusId(null) }}>
              Mostra tutti
            </button>
            <button type="button" className="btn-mini" onClick={() => { setHidden(new Set(scoped.map((row) => row.id))); setFocusId(null) }}>
              Nascondi tutti
            </button>
          </div>
        ) : null}

        <ul className="nv-map-list">
          {scoped.map((itinerary) => {
            const off = hidden.has(itinerary.id)
            const focused = focusId === itinerary.id
            const color = colorOf.get(itinerary.id) || routeColor(0)
            return (
              <li key={itinerary.id} className={`nv-map-item${off ? ' is-off' : ''}${focused ? ' is-focused' : ''}`}>
                <input
                  type="checkbox"
                  checked={!off}
                  onChange={() => toggle(itinerary.id)}
                  aria-label={`Mostra ${itinerary.name}`}
                />
                <span className="nv-map-swatch" style={{ background: color }} />
                <button
                  type="button"
                  className="nv-map-item-body"
                  onClick={() => {
                    if (off) toggle(itinerary.id)
                    setFocusId(focused ? null : itinerary.id)
                  }}
                  title={focused ? 'Torna a tutti' : 'Mostra solo questo'}
                >
                  <span className="nv-map-item-name">{itinerary.name}</span>
                  <span className="nv-muted">
                    {[companyId === ALL ? itinerary.company?.name : null, itinerary.ship, itinerary.nights != null ? `${itinerary.nights} notti` : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  <span className="nv-map-item-route">
                    {itinerary.stops.map((stop) => stop.port?.name || '?').join(' → ')}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>

        {companyId !== ALL ? (
          <button type="button" className="btn-mini" onClick={() => onOpenCompany(companyId)}>
            Apri la scheda della compagnia
          </button>
        ) : null}
        {itineraries !== null && !itineraries.length ? (
          <div className="nv-muted">
            Nessun itinerario caricato. Si aggiungono dalla scheda di una compagnia, incollando le tappe dal suo sito.
          </div>
        ) : null}
      </aside>

      <div className="nv-map-main">
        <div ref={mapElement} className="nv-map" />
        <div className="nv-map-legend">
          <span><i className="nv-legend-dot" /> scalo</span>
          <span><i className="nv-legend-dot is-turn" /> imbarco/sbarco</span>
          <span><i className="nv-legend-dot is-home" /> Napoli / Civitavecchia</span>
          <span>➤ verso della tratta</span>
          <span className="nv-muted">Linee indicative: collegano i porti in ordine, non seguono la rotta reale.</span>
        </div>

        {missing.length ? (
          <div className="nv-map-missing">
            <strong>{missing.length === 1 ? '1 porto senza posizione' : `${missing.length} porti senza posizione`}</strong>
            <span className="nv-muted">
              {missing.length === 1 ? ' — non compare sulla mappa. Clic per posizionarlo:' : ' — non compaiono sulla mappa. Clic per posizionarli:'}
            </span>
            <div className="nv-chips">
              {missing.map((port) => (
                <button
                  key={port.port_id}
                  type="button"
                  className={`nv-chip${placing?.port_id === port.port_id ? ' is-active' : ''}`}
                  onClick={() => {
                    setPlacing(port)
                    setPlaceText('')
                  }}
                >
                  {port.name}
                </button>
              ))}
            </div>
            {placing ? (
              <div className="nv-map-place">
                <input
                  className="fi"
                  autoFocus
                  placeholder={`Coordinate di ${placing.name}: 40.8359, 14.2488 o link Google Maps`}
                  value={placeText}
                  onChange={(event) => setPlaceText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') savePosition()
                  }}
                />
                <a
                  className="btn-mini"
                  href={`https://www.google.com/maps/search/${encodeURIComponent(`porto ${placing.name}`)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Cerca su Google Maps
                </a>
                <button type="button" className="btn-mini" disabled={saving} onClick={savePosition}>
                  Salva
                </button>
                <button type="button" className="btn-mini" onClick={() => setPlacing(null)}>
                  Annulla
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
