'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { Modal } from '@/components/ui/Modal'
import { slugify } from '@/lib/fetchers'
import { useCRMContext } from '../layout'
import type { NewsItem } from '@/types/news'

const EMPTY_FORM = {
  title: '',
  slug: '',
  content: '',
  cover_image: '',
  published: false,
}

export default function NewsPage() {
  const { showToast } = useCRMContext()
  const router = useRouter()
  const [news, setNews] = useState<NewsItem[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const [slugManual, setSlugManual] = useState(false)

  const fetchNews = useCallback(async () => {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('news')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) {
      console.error('[news fetch]', error)
      showToast('Errore nel caricamento delle news')
    } else {
      setNews((data || []) as NewsItem[])
    }
    setLoading(false)
  }, [showToast])

  useEffect(() => {
    fetchNews()
  }, [fetchNews])

  function openNew() {
    setEditId(null)
    setForm({ ...EMPTY_FORM })
    setSlugManual(false)
    setModalOpen(true)
  }

  function openEdit(n: NewsItem) {
    setEditId(n.id)
    setForm({
      title: n.title,
      slug: n.slug,
      content: n.content,
      cover_image: n.cover_image || '',
      published: n.published,
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
      content: form.content.trim(),
      cover_image: form.cover_image.trim() || null,
      published: form.published,
    }

    if (editId) {
      const { error } = await supabase.from('news').update(payload).eq('id', editId)
      if (error) { console.error('[news update]', error); showToast('Errore nel salvataggio'); return }
      showToast('News aggiornata!')
    } else {
      const { error } = await supabase.from('news').insert({ ...payload, created_at: new Date().toISOString() })
      if (error) { console.error('[news insert]', error); showToast('Errore nella creazione'); return }
      showToast('News creata!')
    }

    setModalOpen(false)
    fetchNews()
  }

  async function handleDelete() {
    if (!editId || !confirm('Eliminare questa news?')) return
    const supabase = createClient()
    const { error } = await supabase.from('news').delete().eq('id', editId)
    if (error) { console.error('[news delete]', error); showToast('Errore nell\'eliminazione'); return }
    showToast('News eliminata')
    setModalOpen(false)
    fetchNews()
  }

  const filtered = news.filter(n => {
    const q = search.toLowerCase()
    if (!q) return true
    return n.title.toLowerCase().includes(q) || n.slug.toLowerCase().includes(q)
  })

  return (
    <>
      <div className="toolbar">
        <div className="search">
          <span style={{ color: 'var(--text3)' }}>🔍</span>
          <input
            type="text"
            placeholder="Cerca news…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="toolbar-stats">
          <span className="tstat"><strong>{news.length}</strong> news</span>
          <span className="tstat"><strong>{news.filter(n => n.published).length}</strong> pubblicate</span>
        </div>
        <button className="btn btn-primary btn-sm" style={{ marginLeft: 'auto' }} onClick={openNew}>
          ＋ Nuova News
        </button>
      </div>

      <div className="contacts-content">
        {loading ? (
          <p style={{ color: 'var(--text3)', padding: 20 }}>Caricamento...</p>
        ) : filtered.length === 0 ? (
          <p style={{ color: 'var(--text3)', padding: 20 }}>Nessuna news trovata.</p>
        ) : (
          <div className="contacts-grid">
            {filtered.map(n => (
              <div
                key={n.id}
                className={`contact-card ${n.published ? 'cc-speaqi' : ''}`}
                onClick={() => openEdit(n)}
              >
                {n.cover_image && (
                  <div style={{
                    width: '100%',
                    height: 120,
                    backgroundImage: `url(${n.cover_image})`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                    borderRadius: 'var(--radius-sm)',
                    marginBottom: 10,
                  }} />
                )}
                <div className="contact-name">{n.title}</div>
                <div className="contact-meta" style={{ fontFamily: 'monospace', fontSize: 11 }}>/{n.slug}</div>
                <div className="contact-meta">
                  📅 {new Date(n.created_at).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' })}
                </div>
                <div className="contact-tags">
                  <span
                    className="ctag"
                    style={{
                      background: n.published ? 'var(--green-light)' : 'var(--surface2)',
                      color: n.published ? '#065f46' : 'var(--text2)',
                      border: n.published ? 'none' : '1px solid var(--border)',
                    }}
                  >
                    {n.published ? '✓ Pubblicata' : '○ Bozza'}
                  </span>
                </div>
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ marginTop: 10, width: '100%' }}
                  onClick={e => { e.stopPropagation(); router.push(`/news/${n.slug}`) }}
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
        title={editId ? '✏️ Modifica News' : '＋ Nuova News'}
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
            placeholder="Titolo della news"
            value={form.title}
            onChange={e => handleTitleChange(e.target.value)}
          />
        </div>
        <div className="fg">
          <label className="fl">Slug {editId ? '(readonly)' : '(auto-generato)'}</label>
          <input
            className="fi"
            placeholder="slug-della-news"
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
          <label className="fl">Contenuto *</label>
          <textarea
            className="fi"
            rows={6}
            style={{ resize: 'vertical' }}
            placeholder="Testo della news..."
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
        <div className="fg">
          <label className="fl">Pubblicata</label>
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
              {form.published ? 'Pubblicata' : 'Bozza'}
            </span>
          </div>
        </div>
      </Modal>
    </>
  )
}
