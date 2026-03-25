'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { getProjectBySlug } from '@/lib/fetchers'
import { ProjectTemplate } from '@/components/templates/ProjectTemplate'
import type { Project } from '@/types/project'

export default function ProjectDetailPage() {
  const params = useParams()
  const router = useRouter()
  const slug = params.slug as string
  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!slug) return
    getProjectBySlug(slug).then(data => {
      setProject(data)
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

  if (!project) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, color: 'var(--text2)' }}>
        <div style={{ fontSize: 40 }}>📁</div>
        <div style={{ fontSize: 18, fontWeight: 600 }}>Progetto non trovato</div>
        <p style={{ fontSize: 14, color: 'var(--text3)' }}>Il progetto &quot;{slug}&quot; non esiste o è stato eliminato.</p>
        <button className="btn btn-ghost" onClick={() => router.back()}>
          ← Torna indietro
        </button>
      </div>
    )
  }

  return <ProjectTemplate project={project} />
}
