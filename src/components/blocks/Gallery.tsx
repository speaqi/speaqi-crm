'use client'

import type { GalleryItem } from '@/types/project'

interface GalleryProps {
  items: GalleryItem[]
}

export function Gallery({ items }: GalleryProps) {
  if (!items || items.length === 0) return null

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{
        fontSize: 13,
        fontWeight: 700,
        color: 'var(--text2)',
        textTransform: 'uppercase',
        letterSpacing: '0.8px',
        marginBottom: 12,
      }}>
        Galleria
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
        gap: 12,
      }}>
        {items.map((item, i) => (
          <div
            key={i}
            style={{
              background: 'var(--surface)',
              borderRadius: 'var(--radius-sm)',
              overflow: 'hidden',
              boxShadow: 'var(--shadow)',
              border: '1px solid var(--border)',
            }}
          >
            {item.type === 'image' ? (
              <img
                src={item.url}
                alt={item.caption || `Immagine ${i + 1}`}
                style={{ width: '100%', height: 160, objectFit: 'cover', display: 'block' }}
              />
            ) : (
              <video
                src={item.url}
                controls
                style={{ width: '100%', height: 160, objectFit: 'cover', display: 'block', background: '#000' }}
              />
            )}
            {item.caption && (
              <div style={{
                padding: '8px 12px',
                fontSize: 12,
                color: 'var(--text2)',
                lineHeight: 1.4,
              }}>
                {item.caption}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
