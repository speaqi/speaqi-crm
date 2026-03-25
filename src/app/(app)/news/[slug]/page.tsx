'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { getNewsBySlug } from '@/lib/fetchers'
import { NewsTemplate } from '@/components/templates/NewsTemplate'
import type { NewsItem } from '@/types/news'

export default function NewsDetailPage() {
  const params = useParams()
  const router = useRouter()
  const slug = params.slug as string
  const [newsItem, setNewsItem] = useState<NewsItem | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!slug) return
    getNewsBySlug(slug).then(data => {
      setNewsItem(data)
      setLoading(false)
    })
  }, [slug])

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)' }}>
        Caricamento...
      </div>
    )
  }

  if (!newsItem) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, color: 'var(--text2)' }}>
        <div style={{ fontSize: 40 }}>📰</div>
        <div style={{ fontSize: 18, fontWeight: 600 }}>News non trovata</div>
        <p style={{ fontSize: 14, color: 'var(--text3)' }}>La news &quot;{slug}&quot; non esiste o è stata eliminata.</p>
        <button className="btn btn-ghost" onClick={() => router.back()}>
          ← Torna indietro
        </button>
      </div>
    )
  }

  return <NewsTemplate news={newsItem} />
}
