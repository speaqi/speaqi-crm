'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { Modal } from '@/components/ui/Modal'
import { slugify } from '@/lib/fetchers'
import { useCRMContext } from '../layout'
import type { Project } from '@/types/project'

const EMPTY_FORM = {
  title: '',
  slug: '',
  excerpt: '',
  content: '',
  cover_image: '',
  client: '',
  year: '',
  published: false,
}

export default function ProjectsPage() {
  const { showToast } = useCRMContext()
  const router = useRouter()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const [slugManual, setSlugManual] = useState(false)

  const fetchProjects = useCallback(async () => {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) {
      console.error('[projects fetch]', error)
      showToast('Errore nel caricamento dei progetti')
    } else {
      setProjects((data || []) as Project[])
    }
    setLoading(false)
  }, [showToast])

  useEffect(() => {
    fetchProjects()
  }, [fetchProjects])

  function openNew() {
    setEditId(null)
    setForm({ ...EMPTY_FORM })
    setSlugManual(false)
    setModalOpen(true)
  }

  function openEdit(p: Project) {
    setEditId(p.id)
    setForm({
      title: p.title,
      slug: p.slug,
      excerpt: p.excerpt || '',
      content: p.content,
      cover_image: p.cover_image || '',
      client: p.client || '',
      year: p.year ? String(p.year) : '',
      published: p.published,
    })
    setSlugManual(true)
    setModalOpen(true)
  }

  function handleTitleChange(val: string) {
    setForm(f => ({
      ...f,
      title: val,
      slug: slugManual ? f.slug : slugify(val),
    }))
  }

  async function handleSave() {
    if (!form.title.trim()) { showToast('Inserisci un titolo'); return }
    if (!form.slug.trim()) { showToast('Lo slug è obbligatorio'); return }
    if (!form.content.trim()) { showToast('Inserisci il contenuto'); return }

    const supabase = createClient()
    const payload = {
      title: form.title.trim(),
      slug: form.slug.trim(),
      excerpt: form.excerpt.trim() || null,
      content: form.content.trim(),
      cover_image: form.cover_image.trim() || null,
      client: form.client.trim() || null,
      year: form.year ? parseInt(form.year) : null,
      published: form.published,
      updated_at: new Date().toISOString(),
    }

    if (editId) {
      const { error } = await supabase.from('projects').update(payload).eq('id', editId)
      if (error) { console.error('[projects update]', error); showToast('Errore nel salvataggio'); return }
      showToast('Progetto aggiornato!')
    } else {
      const { error } = await supabase.from('projects').insert({ ...payload, created_at: new Date().toISOString() })
      if (error) { console.error('[projects insert]', error); showToast('Errore nella creazione'); return }
      showToast('Progetto creato!')
    }

    setModalOpen(false)
    fetchProjects()
  }

  async function handleDelete() {
    if (!editId || !confirm('Eliminare questo progetto?')) return
    const supabase = createClient()
    const { error } = await supabase.from('projects').delete().eq('id', editId)
    if (error) { console.error('[projects delete]', error); showToast('Errore nell\'eliminazione'); return }
    showToast('Progetto eliminato')
    setModalOpen(false)
    fetchProjects()
  }

  const filtered = projects.filter(p => {
    const q = search.toLowerCase()
    if (!q) return true
    return p.title.toLowerCase().includes(q) || (p.client || '').toLowerCase().includes(q) || p.slug.toLowerCase().includes(q)
  })

  return (
    <>
      <div className="toolbar">
        <div className="search">
          <span style={{ color: 'var(--text3)' }}>🔍</span>
          <input
            type="text"
            placeholder="Cerca progetti…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="toolbar-stats">
          <span className="tstat"><strong>{projects.length}</strong> progetti</span>
          <span className="tstat"><strong>{projects.filter(p => p.published).length}</strong> pubblicati</span>
        </div>
        <button className="btn btn-primary btn-sm" style={{ marginLeft: 'auto' }} onClick={openNew}>
          ＋ Nuovo Progetto
        </button>
      </div>

      <div className="contacts-content">
        {loading ? (
          <p style={{ color: 'var(--text3)', padding: 20 }}>Caricamento...</p>
        ) : filtered.length === 0 ? (
          <p style={{ color: 'var(--text3)', padding: 20 }}>Nessun progetto trovato.</p>
        ) : (
          <div className="contacts-grid">
            {filtered.map(p => (
              <div
                key={p.id}
                className={`contact-card ${p.published ? 'cc-speaqi' : ''}`}
                onClick={() => openEdit(p)}
              >
                {p.cover_image && (
                  <div style={{
                    width: '100%',
                    height: 120,
                    backgroundImage: `url(${p.cover_image})`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                    borderRadius: 'var(--radius-sm)',
                    marginBottom: 10,
                  }} />
                )}
                <div className="contact-name">{p.title}</div>
                {p.excerpt && (
                  <div className="contact-meta" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                    {p.excerpt}
                  </div>
                )}
                {p.client && <div className="contact-meta">👤 {p.client}</div>}
                {p.year && <div className="contact-meta">📅 {p.year}</div>}
                <div className="contact-meta" style={{ fontFamily: 'monospace', fontSize: 11 }}>/{p.slug}</div>
                <div className="contact-tags">
                  <span
                    className="ctag"
                    style={{
                      background: p.published ? 'var(--green-light)' : 'var(--surface2)',
                      color: p.published ? '#065f46' : 'var(--text2)',
                      border: p.published ? 'none' : '1px solid var(--border)',
                    }}
                  >
                    {p.published ? '✓ Pubblicato' : '○ Bozza'}
                  </span>
                </div>
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ marginTop: 10, width: '100%' }}
                  onClick={e => { e.stopPropagation(); router.push(`/projects/${p.slug}`) }}
                >
                  Visualizza →
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editId ? '✏️ Modifica Progetto' : '＋ Nuovo Progetto'}
        footer={
          <>
            {editId && (
              <button className="btn btn-del" onClick={handleDelete}>🗑 Elimina</button>
            )}
            <button className="btn btn-ghost" onClick={() => setModalOpen(false)}>Annulla</button>
            <button className="btn btn-primary" onClick={handleSave}>Salva</button>
          </>
        }
      >
        <div className="fg">
          <label className="fl">Titolo *</label>
          <input
            className="fi"
            placeholder="Nome del progetto"
            value={form.title}
            onChange={e => handleTitleChange(e.target.value)}
          />
        </div>
        <div className="fg">
          <label className="fl">Slug {editId ? '(readonly)' : '(auto-generato)'}</label>
          <input
            className="fi"
            placeholder="slug-del-progetto"
            value={form.slug}
            readOnly={!!editId}
            onChange={e => {
              if (!editId) {
                setSlugManual(true)
                setForm(f => ({ ...f, slug: e.target.value }))
              }
            }}
            style={{
              fontFamily: 'monospace',
              fontSize: 13,
              background: editId ? 'var(--surface2)' : undefined,
              color: editId ? 'var(--text2)' : undefined,
            }}
          />
        </div>
        <div className="fg">
          <label className="fl">Estratto / Sottotitolo</label>
          <input
            className="fi"
            placeholder="Breve descrizione del progetto"
            value={form.excerpt}
            onChange={e => setForm(f => ({ ...f, excerpt: e.target.value }))}
          />
        </div>
        <div className="fg">
          <label className="fl">Contenuto *</label>
          <textarea
            className="fi"
            rows={5}
            style={{ resize: 'vertical' }}
            placeholder="Descrizione completa del progetto..."
            value={form.content}
            onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
          />
        </div>
        <div className="fg">
          <label className="fl">URL Cover Image</label>
          <input
            className="fi"
            placeholder="https://..."
            value={form.cover_image}
            onChange={e => setForm(f => ({ ...f, cover_image: e.target.value }))}
          />
        </div>
        <div className="frow">
          <div className="fg">
            <label className="fl">Cliente</label>
            <input
              className="fi"
              placeholder="Nome cliente"
              value={form.client}
              onChange={e => setForm(f => ({ ...f, client: e.target.value }))}
            />
          </div>
          <div className="fg">
            <label className="fl">Anno</label>
            <input
              className="fi"
              type="number"
              placeholder="2024"
              value={form.year}
              onChange={e => setForm(f => ({ ...f, year: e.target.value }))}
            />
          </div>
        </div>
        <div className="fg">
          <label className="fl">Pubblicato</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
            <button
              type="button"
              onClick={() => setForm(f => ({ ...f, published: !f.published }))}
              style={{
                width: 44,
                height: 24,
                borderRadius: 12,
                background: form.published ? 'var(--green)' : 'var(--border)',
                border: 'none',
                cursor: 'pointer',
                position: 'relative',
                transition: 'background 0.2s',
                flexShrink: 0,
              }}
            >
              <span style={{
                position: 'absolute',
                top: 2,
                left: form.published ? 22 : 2,
                width: 20,
                height: 20,
                borderRadius: '50%',
                background: 'white',
                transition: 'left 0.2s',
                boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
              }} />
            </button>
            <span style={{ fontSize: 13, color: form.published ? 'var(--green)' : 'var(--text2)', fontWeight: 500 }}>
              {form.published ? 'Pubblicato' : 'Bozza'}
            </span>
          </div>
        </div>
      </Modal>
    </>
  )
}
