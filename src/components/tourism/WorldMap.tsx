'use client'

import { useEffect, useRef, useState } from 'react'
import type { Map as LeafletMap } from 'leaflet'
import 'leaflet/dist/leaflet.css'

// Display anchors for country aggregates, never office locations or geographic coverage boundaries.
const ANCHORS: Record<string, [number, number]> = {
  IT: [42.5, 12.5],
  FR: [46.6, 2.2],
  ES: [40.4, -3.7],
  PT: [39.4, -8.2],
  GB: [54, -2],
  DE: [51, 10],
  HR: [45.1, 15.2],
  GR: [39, 22],
  CH: [46.8, 8.2],
  AT: [47.5, 14.5],
  US: [39, -98],
  CA: [57, -105],
  MX: [23.6, -102.5],
  BR: [-14, -52],
  AR: [-35, -64],
  JP: [36, 138],
  CN: [35, 103],
  IN: [22, 79],
  AU: [-25, 134],
  NZ: [-41, 174],
  ZA: [-29, 24],
  EG: [27, 30],
  MA: [32, -6],
  AE: [24, 54],
  SA: [24, 45],
  TH: [15, 101],
  ID: [-2, 118],
  NO: [62, 10],
  SE: [62, 16],
  FI: [64, 26],
  DK: [56, 10],
  NL: [52, 5],
  BE: [50.8, 4.5],
  PL: [52, 19],
  CZ: [50, 15],
  IE: [53, -8],
  TR: [39, 35],
  KE: [0, 38],
  PE: [-10, -76],
  CL: [-30, -71],
  CO: [4, -73]
}
export default function WorldMap({
  countries,
  onSelect
}: {
  countries: { country_code: string; total: number }[]
  onSelect: (country: string) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const map = useRef<LeafletMap | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let disposed = false
    const controller = new AbortController()
    setFailed(false)
    Promise.all([
      import('leaflet'),
      fetch('/tourism-assets/world.geojson', {
        signal: controller.signal
      }).then((r) => {
        if (!r.ok) throw new Error('Map unavailable')
        return r.json()
      })
    ])
      .then(([L, world]) => {
        if (disposed || !ref.current) return
        const instance = L.map(ref.current, {
          scrollWheelZoom: false,
          minZoom: 0,
          maxZoom: 5,
          maxBounds: [
            [-85, -200],
            [85, 200]
          ]
        }).fitBounds([
          [-55, -165],
          [80, 180]
        ])
        map.current = instance
        instance.attributionControl.addAttribution(
          '<a href="https://www.naturalearthdata.com/">Natural Earth</a> · public domain'
        )
        const countByCode = new Map(
          countries.map((c) => [c.country_code, c.total])
        )
        const fallbackAnchors: Record<string, [number, number]> = {}
        L.geoJSON(world, {
          style: (feature) => ({
            color: '#c0d1c5',
            weight: 0.65,
            fillColor: countByCode.has(feature?.properties?.iso)
              ? '#bddbc9'
              : '#f5f7ee',
            fillOpacity: 1
          }),
          onEachFeature: (feature, layer) => {
            const code = feature.properties?.iso as string
            if ('getBounds' in layer) {
              const point = (layer as import('leaflet').Polygon)
                .getBounds()
                .getCenter()
              fallbackAnchors[code] = [point.lat, point.lng]
            }
            if (countByCode.has(code)) {
              const label = document.createElement('span')
              label.textContent = `${feature.properties?.name} · ${countByCode.get(code)} organizzazioni`
              layer.bindTooltip(label)
              layer.on('click', () => onSelect(code))
            }
          }
        }).addTo(instance)
        for (const c of countries) {
          const anchor =
            ANCHORS[c.country_code] || fallbackAnchors[c.country_code]
          if (!anchor) continue
          const marker = L.circleMarker(anchor, {
            radius: Math.min(22, 7 + Math.log2(c.total + 1) * 3),
            color: '#ffffff',
            weight: 3,
            fillColor: '#147d64',
            fillOpacity: 0.9
          }).addTo(instance)
          // Tooltip uses DOM text, never source HTML.
          const label = document.createElement('span')
          label.textContent = `${c.country_code} · ${c.total} organizzazioni`
          marker.bindTooltip(label).on('click', () => onSelect(c.country_code))
        }
        const observer = new ResizeObserver(() => instance.invalidateSize())
        observer.observe(ref.current)
        instance.on('unload', () => observer.disconnect())
      })
      .catch(() => {
        if (!disposed) setFailed(true)
      })
    return () => {
      disposed = true
      controller.abort()
      map.current?.remove()
      map.current = null
    }
  }, [countries, onSelect])
  return (
    <>
      <div
        ref={ref}
        role="img"
        aria-label="Mappa dei paesi con organizzazioni censite. I punti sono aggregati nazionali; selezione disponibile anche nell’elenco paesi."
        style={{
          height: 360,
          width: '100%',
          background: '#e8eff0',
          borderRadius: 12,
          zIndex: 0
        }}
      />
      {failed && (
        <p role="status">
          Mappa non disponibile. I paesi restano consultabili nell’elenco
          sottostante.
        </p>
      )}
    </>
  )
}
