'use client'
import { useEffect, useRef } from 'react'
import type { PoiCandidate } from '@/lib/tourism-research'
import 'leaflet/dist/leaflet.css'

export default function PoiPreview({ points }: { points: PoiCandidate[] }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let disposed = false,
      map: import('leaflet').Map | undefined
    import('leaflet').then((L) => {
      if (disposed || !ref.current) return
      const coordinates = points.filter(
        (p) => p.latitude !== null && p.longitude !== null
      )
      if (!coordinates.length) return
      map = L.map(ref.current, { scrollWheelZoom: false })
      L.tileLayer(
        'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
        { attribution: '© OpenStreetMap contributors © CARTO', maxZoom: 19 }
      ).addTo(map)
      const bounds: L.LatLngTuple[] = []
      for (const p of coordinates) {
        const position: L.LatLngTuple = [p.latitude!, p.longitude!]
        bounds.push(position)
        const content = document.createElement('div'),
          name = document.createElement('strong'),
          link = document.createElement('a')
        name.textContent = p.name
        link.textContent = 'Apri la fonte'
        link.href = p.source_url
        link.target = '_blank'
        link.rel = 'noopener noreferrer'
        content.append(name, document.createElement('br'), link)
        L.circleMarker(position, {
          radius: 6,
          color: p.category === 'restaurant' ? '#b76e28' : '#23795b'
        })
          .bindPopup(content)
          .addTo(map)
      }
      map.fitBounds(bounds, { padding: [30, 30], maxZoom: 14 })
    })
    return () => {
      disposed = true
      map?.remove()
    }
  }, [points])
  return (
    <div
      ref={ref}
      style={{ height: 320, borderRadius: 12, background: '#eef2ee' }}
      aria-label="Anteprima interna dei luoghi osservati"
    />
  )
}
