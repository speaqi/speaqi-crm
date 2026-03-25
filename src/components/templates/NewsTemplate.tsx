'use client'

import { useRouter } from 'next/navigation'
import type { NewsItem } from '@/types/news'
import { Hero } from '@/components/blocks/Hero'
import { RichText } from '@/components/blocks/RichText'

interface NewsTemplateProps {
  news: NewsItem
}

export function NewsTemplate({ news }: NewsTemplateProps) {
  const router = useRouter()

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>
      <button
        className="btn btn-ghost btn-sm"
        onClick={() => router.back()}
        style={{ marginBottom: 20 }}
      >
        ← Torna alle News
      </button>

      <Hero
        title={news.title}
        cover_image={news.cover_image}
      />

      {news.content && <RichText content={news.content} />}

      <div style={{
        fontSize: 12,
        color: 'var(--text3)',
        marginTop: 8,
        paddingTop: 16,
        borderTop: '1px solid var(--border)',
      }}>
        Pubblicato il {new Date(news.created_at).toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' })}
      </div>
    </div>
  )
}
