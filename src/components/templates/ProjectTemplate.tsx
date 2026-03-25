'use client'

import { useRouter } from 'next/navigation'
import type { Project } from '@/types/project'
import { Hero } from '@/components/blocks/Hero'
import { RichText } from '@/components/blocks/RichText'
import { Gallery } from '@/components/blocks/Gallery'

interface ProjectTemplateProps {
  project: Project
}

export function ProjectTemplate({ project }: ProjectTemplateProps) {
  const router = useRouter()

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>
      <button
        className="btn btn-ghost btn-sm"
        onClick={() => router.back()}
        style={{ marginBottom: 20 }}
      >
        ← Torna ai Progetti
      </button>

      <Hero
        title={project.title}
        excerpt={project.excerpt}
        cover_image={project.cover_image}
        client={project.client}
        year={project.year}
      />

      {project.content && <RichText content={project.content} />}

      {project.gallery && project.gallery.length > 0 && (
        <Gallery items={project.gallery} />
      )}

      <div style={{
        fontSize: 12,
        color: 'var(--text3)',
        marginTop: 8,
        paddingTop: 16,
        borderTop: '1px solid var(--border)',
      }}>
        Pubblicato il {new Date(project.created_at).toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' })}
      </div>
    </div>
  )
}
