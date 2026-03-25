'use client'

import { useState } from 'react'
import { useCRMContext } from '../layout'
import { Modal } from '@/components/ui/Modal'
import type { SpeaqiContact } from '@/types'

const EMPTY_SPEAQI: Omit<SpeaqiContact, '_u'> = {
  n: '', role: '', cat: 'Persona', st: 'da-contattare', p: '', note: '',
}

const CAT_COLORS: Record<string, string> = {
  Istituzione: 'cc-istituzione',
  Ristorante: 'cc-ristorante',
  Media: 'cc-alta',
  Persona: 'cc-speaqi',
  Azienda: 'cc-bassa',
  Comune: 'cc-media',
}

function stTag(st: string) {
  const cls: Record<string, string> = {
    contattato: 'ctag-contattato',
    'da-contattare': 'ctag-dacontattare',
  }
  const labels: Record<string, string> = {
    contattato: 'Contattato',
    'da-contattare': 'Da Contattare',
  }
  return { cls: cls[st] || '', label: labels[st] || st }
}

export default function SpeaqiPage() {
  const { speaqi, addSpeaqi, updateSpeaqi, deleteSpeaqi, showToast } = useCRMContext()
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editUid, setEditUid] = useState<string | null>(null)
  const [form, setForm] = useState({ ...EMPTY_SPEAQI })

  const allCats = Array.from(new Set(speaqi.map(c => c.cat))).sort()

  const filtered = speaqi.filter(c => {
    const q = search.toLowerCase()
    if (q && !c.n.toLowerCase().includes(q) && !(c.role || '').toLowerCase().includes(q)) return false
    if (catFilter && c.cat !== catFilter) return false
    return true
  })

  function openNew() {
    setEditUid(null)
    setForm({ ...EMPTY_SPEAQI })
    setModalOpen(true)
  }

  function openEdit(uid: string) {
    const c = speaqi.find(x => x._u === uid)
    if (!c) return
    setEditUid(uid)
    setForm({ n: c.n, role: c.role || '', cat: c.cat, st: c.st, p: c.p || '', note: c.note || '' })
    setModalOpen(true)
  }

  function handleSave() {
    if (!form.n.trim()) { alert('Inserisci un nome'); return }
    if (editUid) {
      updateSpeaqi(editUid, form)
      showToast('Aggiornato!')
    } else {
      addSpeaqi(form)
      showToast('Aggiunto!')
    }
    setModalOpen(false)
  }

  function handleDelete() {
    if (!editUid || !confirm('Eliminare?')) return
    deleteSpeaqi(editUid)
    setModalOpen(false)
    showToast('Eliminato')
  }

  return (
    <>
      <div className="toolbar">
        <div className="search">
          <span style={{ color: 'var(--text3)' }}>🔍</span>
          <input
            type="text"
            placeholder="Cerca nella rete SPEAQI…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select
          className="filter-select"
          value={catFilter}
          onChange={e => setCatFilter(e.target.value)}
        >
          <option value="">Tutte le categorie</option>
          {allCats.map(c => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <button className="btn btn-primary btn-sm" style={{ marginLeft: 'auto' }} onClick={openNew}>
          ＋ Aggiungi
        </button>
      </div>

      <div className="contacts-content">
        <div className="contacts-grid" id="speaqi-grid">
          {filtered.length === 0 ? (
            <p style={{ color: 'var(--text3)', padding: '20px' }}>Nessun risultato.</p>
          ) : (
            filtered.map(c => {
              const tag = stTag(c.st)
              return (
                <div
                  key={c._u}
                  className={`contact-card ${CAT_COLORS[c.cat] || ''}`}
                  onClick={() => openEdit(c._u!)}
                >
                  <div className="contact-name">{c.n}</div>
                  {c.role && <div className="contact-meta">🎭 {c.role}</div>}
                  <div className="contact-meta">📁 {c.cat}</div>
                  {c.note && (
                    <div className="contact-meta" style={{ fontSize: 11, color: 'var(--text3)' }}>
                      {c.note}
                    </div>
                  )}
                  <div className="contact-tags">
                    <span className={`ctag ${tag.cls}`}>{tag.label}</span>
                    {c.p && (
                      <span className={`ctag tag-${c.p.toLowerCase()}`}>{c.p}</span>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editUid ? '✏️ Modifica Rete SPEAQI' : '＋ Nuovo Contatto SPEAQI'}
        footer={
          <>
            {editUid && (
              <button className="btn btn-del" onClick={handleDelete}>🗑 Elimina</button>
            )}
            <button className="btn btn-ghost" onClick={() => setModalOpen(false)}>Annulla</button>
            <button className="btn btn-primary" onClick={handleSave}>Salva</button>
          </>
        }
      >
        <div className="fg">
          <label className="fl">Nome *</label>
          <input
            className="fi"
            placeholder="Nome o organizzazione"
            value={form.n}
            onChange={e => setForm(f => ({ ...f, n: e.target.value }))}
          />
        </div>
        <div className="frow">
          <div className="fg">
            <label className="fl">Ruolo / Nota</label>
            <input
              className="fi"
              placeholder="Es. CEO, KPMG..."
              value={form.role || ''}
              onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
            />
          </div>
          <div className="fg">
            <label className="fl">Categoria</label>
            <select
              className="fi"
              value={form.cat}
              onChange={e => setForm(f => ({ ...f, cat: e.target.value }))}
            >
              {['Persona', 'Azienda', 'Istituzione', 'Ristorante', 'Media', 'Comune'].map(c => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="frow">
          <div className="fg">
            <label className="fl">Stato</label>
            <select
              className="fi"
              value={form.st}
              onChange={e => setForm(f => ({ ...f, st: e.target.value as SpeaqiContact['st'] }))}
            >
              <option value="da-contattare">Da Contattare</option>
              <option value="contattato">Contattato</option>
            </select>
          </div>
          <div className="fg">
            <label className="fl">Priorità</label>
            <select
              className="fi"
              value={form.p || ''}
              onChange={e => setForm(f => ({ ...f, p: e.target.value }))}
            >
              <option value="">Nessuna</option>
              <option value="Alta">Alta</option>
              <option value="Media">Media</option>
              <option value="Bassa">Bassa</option>
            </select>
          </div>
        </div>
        <div className="fg">
          <label className="fl">Note / Email</label>
          <textarea
            className="fi"
            rows={2}
            style={{ resize: 'vertical' }}
            value={form.note || ''}
            onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
          />
        </div>
      </Modal>
    </>
  )
}
