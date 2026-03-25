'use client'

import { useState } from 'react'
import { useCRMContext } from '../layout'
import { Modal } from '@/components/ui/Modal'
import type { Contact } from '@/types'

const CT_CATS = ['Tutti', 'Sindaco', 'Persona', 'Azienda', 'Istituzione', 'Ristorante', 'Media']

const EMPTY_CONTACT: Omit<Contact, '_u'> = {
  n: '', ref: '', role: '', comune: '', st: 'da-contattare', p: '', cat: 'Persona', notes: '',
}

function stTag(st: string) {
  const cls: Record<string, string> = {
    contattato: 'ctag-contattato',
    'da-contattare': 'ctag-dacontattare',
    referenziato: 'ctag-referenziato',
  }
  const labels: Record<string, string> = {
    contattato: 'Contattato',
    'da-contattare': 'Da Contattare',
    referenziato: 'Referenziato',
  }
  return { cls: cls[st] || '', label: labels[st] || st }
}

function getBorderClass(c: Contact) {
  if (c.p === 'Alta') return 'cc-alta'
  if (c.p === 'Media') return 'cc-media'
  if (c.p === 'Bassa') return 'cc-bassa'
  if (c.cat === 'Istituzione') return 'cc-istituzione'
  if (c.cat === 'Ristorante') return 'cc-ristorante'
  if (c.cat === 'Sindaco') return 'cc-alta'
  return ''
}

export default function ContactsPage() {
  const { contacts, addContact, updateContact, deleteContact, showToast } = useCRMContext()
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('Tutti')
  const [modalOpen, setModalOpen] = useState(false)
  const [editUid, setEditUid] = useState<string | null>(null)
  const [form, setForm] = useState({ ...EMPTY_CONTACT })

  const filtered = contacts.filter(c => {
    const q = search.toLowerCase()
    if (q && !c.n.toLowerCase().includes(q)) return false
    if (catFilter !== 'Tutti' && c.cat !== catFilter) return false
    return true
  })

  const groups: Record<string, Contact[]> = { contattato: [], 'da-contattare': [], referenziato: [] }
  filtered.forEach(c => { if (groups[c.st]) groups[c.st].push(c) })

  const sectionLabels: Record<string, string> = {
    contattato: '✅ Contattati',
    'da-contattare': '📋 Da Contattare',
    referenziato: '🔗 Referenziati',
  }

  function openNew() {
    setEditUid(null)
    setForm({ ...EMPTY_CONTACT })
    setModalOpen(true)
  }

  function openEdit(uid: string) {
    const c = contacts.find(x => x._u === uid)
    if (!c) return
    setEditUid(uid)
    setForm({ n: c.n, ref: c.ref || '', role: c.role || '', comune: c.comune || '', st: c.st, p: c.p || '', cat: c.cat, notes: c.notes || '' })
    setModalOpen(true)
  }

  function handleSave() {
    if (!form.n.trim()) { alert('Inserisci un nome'); return }
    if (editUid) {
      updateContact(editUid, form)
      showToast('Contatto aggiornato!')
    } else {
      addContact(form)
      showToast('Contatto aggiunto!')
    }
    setModalOpen(false)
  }

  function handleDelete() {
    if (!editUid || !confirm('Eliminare?')) return
    deleteContact(editUid)
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
            placeholder="Cerca contatto…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {CT_CATS.map(cat => (
            <div
              key={cat}
              className={`filter-chip ${catFilter === cat ? 'active' : ''}`}
              onClick={() => setCatFilter(cat)}
            >
              {cat}
            </div>
          ))}
        </div>
        <button className="btn btn-primary btn-sm" style={{ marginLeft: 'auto' }} onClick={openNew}>
          ＋ Contatto
        </button>
      </div>

      <div className="contacts-content">
        <div id="contacts-body">
          {(['contattato', 'da-contattare', 'referenziato'] as const).map(status => {
            const group = groups[status]
            if (!group.length) return null
            return (
              <div key={status}>
                <div className="section-header">
                  {sectionLabels[status]} ({group.length})
                </div>
                <div className="contacts-grid">
                  {group.map(c => {
                    const tag = stTag(c.st)
                    return (
                      <div
                        key={c._u}
                        className={`contact-card ${getBorderClass(c)}`}
                        onClick={() => openEdit(c._u!)}
                      >
                        <div className="contact-name">{c.n}</div>
                        {c.role && <div className="contact-meta">🎭 {c.role}</div>}
                        {c.comune && <div className="contact-meta">📍 {c.comune}</div>}
                        {c.ref && <div className="contact-meta">🔗 {c.ref}</div>}
                        {!c.role && !c.comune && c.cat && (
                          <div className="contact-meta">📁 {c.cat}</div>
                        )}
                        <div className="contact-tags">
                          <span className={`ctag ${tag.cls}`}>{tag.label}</span>
                          {c.p && (
                            <span className={`ctag tag-${c.p.toLowerCase()}`}>{c.p}</span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
          {filtered.length === 0 && (
            <p style={{ color: 'var(--text3)', padding: '20px' }}>Nessun contatto trovato.</p>
          )}
        </div>
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editUid ? '✏️ Modifica Contatto' : '＋ Nuovo Contatto'}
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
          <label className="fl">Nome / Organizzazione *</label>
          <input
            className="fi"
            placeholder="Es. Mario Rossi"
            value={form.n}
            onChange={e => setForm(f => ({ ...f, n: e.target.value }))}
          />
        </div>
        <div className="frow">
          <div className="fg">
            <label className="fl">Ruolo / Carica</label>
            <input
              className="fi"
              placeholder="Es. Sindaco, CEO..."
              value={form.role || ''}
              onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
            />
          </div>
          <div className="fg">
            <label className="fl">Comune / Città</label>
            <input
              className="fi"
              placeholder="Es. Roma (RM)"
              value={form.comune || ''}
              onChange={e => setForm(f => ({ ...f, comune: e.target.value }))}
            />
          </div>
        </div>
        <div className="frow">
          <div className="fg">
            <label className="fl">Riferimento</label>
            <input
              className="fi"
              placeholder="Chi ha fatto il riferimento"
              value={form.ref || ''}
              onChange={e => setForm(f => ({ ...f, ref: e.target.value }))}
            />
          </div>
          <div className="fg">
            <label className="fl">Categoria</label>
            <select
              className="fi"
              value={form.cat}
              onChange={e => setForm(f => ({ ...f, cat: e.target.value }))}
            >
              {['Sindaco', 'Persona', 'Azienda', 'Istituzione', 'Ristorante', 'Media', 'SPEAQI', 'Altro'].map(c => (
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
              onChange={e => setForm(f => ({ ...f, st: e.target.value as Contact['st'] }))}
            >
              <option value="da-contattare">Da Contattare</option>
              <option value="contattato">Contattato</option>
              <option value="referenziato">Referenziato</option>
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
          <label className="fl">Email / Telefono / Note</label>
          <textarea
            className="fi"
            rows={2}
            style={{ resize: 'vertical' }}
            value={form.notes || ''}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
          />
        </div>
      </Modal>
    </>
  )
}
