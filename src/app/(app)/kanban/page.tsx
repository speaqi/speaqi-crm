'use client'

import { useState, useRef, useCallback } from 'react'
import { useCRMContext } from '../layout'
import { Modal } from '@/components/ui/Modal'
import { COLS } from '@/lib/data'
import type { Card } from '@/types'

function dateClass(d: string) {
  if (!d) return ''
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const diff = Math.ceil((new Date(d).getTime() - today.getTime()) / 86400000)
  return diff < 0 ? 'past' : diff <= 3 ? 'soon' : 'ok'
}

function fDate(d: string) {
  if (!d) return ''
  const [y, m, dd] = d.split('-')
  return `${dd}/${m}/${y}`
}

const EMPTY_CARD: Omit<Card, '_u'> = {
  id: '', n: '', s: 'Da Richiamare', p: '', r: '', d: '', $: '', note: '',
}

export default function KanbanPage() {
  const { cards, addCard, updateCard, deleteCard, moveCard, showToast } = useCRMContext()
  const [search, setSearch] = useState('')
  const [filterPri, setFilterPri] = useState('')
  const [filterResp, setFilterResp] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editUid, setEditUid] = useState<string | null>(null)
  const [form, setForm] = useState({ ...EMPTY_CARD })
  const dragUid = useRef<string | null>(null)

  const allResps = Array.from(new Set(cards.map(c => c.r).filter(Boolean))).sort() as string[]

  const filtered = cards.filter(c => {
    const q = search.toLowerCase()
    if (q && !c.n.toLowerCase().includes(q) && !(c.r || '').toLowerCase().includes(q)) return false
    if (filterPri && c.p !== filterPri) return false
    if (filterResp && c.r !== filterResp) return false
    return true
  })

  const totalVal = filtered.filter(c => c.$).reduce((s, c) => s + Number(c.$), 0)

  function openNew(colId?: string) {
    setEditUid(null)
    setForm({ ...EMPTY_CARD, s: colId || 'Da Richiamare' })
    setModalOpen(true)
  }

  function openEdit(uid: string) {
    const c = cards.find(x => x._u === uid)
    if (!c) return
    setEditUid(uid)
    setForm({ id: c.id || '', n: c.n, s: c.s, p: c.p || '', r: c.r || '', d: c.d || '', $: c.$ || '', note: c.note || '' })
    setModalOpen(true)
  }

  function handleSave() {
    if (!form.n.trim()) { alert('Inserisci un nome'); return }
    if (editUid) {
      updateCard(editUid, form)
      showToast('Card aggiornata!')
    } else {
      addCard(form)
      showToast('Card creata! 🎉')
    }
    setModalOpen(false)
  }

  function handleDelete() {
    if (!editUid || !confirm('Eliminare questa card?')) return
    deleteCard(editUid)
    setModalOpen(false)
    showToast('Card eliminata')
  }

  // Drag and drop
  function handleDragStart(e: React.DragEvent, uid: string) {
    dragUid.current = uid
    setTimeout(() => (e.target as HTMLElement).classList.add('dragging'), 0)
    e.dataTransfer.effectAllowed = 'move'
  }

  function handleDragEnd(e: React.DragEvent) {
    ;(e.target as HTMLElement).classList.remove('dragging')
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).classList.add('drop-over')
  }

  function handleDragLeave(e: React.DragEvent) {
    ;(e.currentTarget as HTMLElement).classList.remove('drop-over')
  }

  function handleDrop(e: React.DragEvent, colId: string) {
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).classList.remove('drop-over')
    const uid = dragUid.current
    if (!uid) return
    const card = cards.find(x => x._u === uid)
    if (card && card.s !== colId) {
      moveCard(uid, colId)
      showToast(`"${card.n}" → ${colId}`)
    }
    dragUid.current = null
  }

  return (
    <>
      <div className="toolbar">
        <div className="search">
          <span style={{ color: 'var(--text3)' }}>🔍</span>
          <input
            type="text"
            placeholder="Cerca nome, responsabile…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <select
          className="filter-select"
          value={filterPri}
          onChange={e => setFilterPri(e.target.value)}
        >
          <option value="">Tutte le priorità</option>
          <option value="Alta">🔴 Alta</option>
          <option value="Media">🟡 Media</option>
          <option value="Bassa">🔵 Bassa</option>
        </select>
        <select
          className="filter-select"
          value={filterResp}
          onChange={e => setFilterResp(e.target.value)}
        >
          <option value="">Tutti i responsabili</option>
          {allResps.map(r => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <div className="toolbar-stats">
          <span className="tstat">Totale: <strong>{filtered.length}</strong></span>
          <span className="tstat">Alta: <strong style={{ color: 'var(--red)' }}>{filtered.filter(c => c.p === 'Alta').length}</strong></span>
          <span className="tstat">Valore: <strong style={{ color: 'var(--green)' }}>€{totalVal.toLocaleString('it')}</strong></span>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => openNew()}>
          ＋ Nuova Card
        </button>
      </div>

      <div className="board-outer">
        <div className="board-scroll">
          <div className="board">
            {COLS.map(col => {
              const colCards = filtered.filter(c => c.s === col.id)
              return (
                <div key={col.id} className="col">
                  <div className="col-head">
                    <div className="col-dot" style={{ background: col.color }} />
                    <div className="col-name">{col.label}</div>
                    <div className="col-count">{colCards.length}</div>
                  </div>
                  <div
                    className="col-cards"
                    onDragOver={handleDragOver}
                    onDrop={e => handleDrop(e, col.id)}
                    onDragLeave={handleDragLeave}
                  >
                    {colCards.length === 0 ? (
                      <div className="empty-col">
                        <div className="e-icon">📭</div>
                        Vuoto
                      </div>
                    ) : (
                      colCards.map(c => (
                        <KanbanCard
                          key={c._u}
                          card={c}
                          onEdit={() => openEdit(c._u!)}
                          onDragStart={e => handleDragStart(e, c._u!)}
                          onDragEnd={handleDragEnd}
                        />
                      ))
                    )}
                  </div>
                  <div className="col-add">
                    <button className="col-add-btn" onClick={() => openNew(col.id)}>
                      ＋ Aggiungi
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editUid ? '✏️ Modifica Card' : '＋ Nuova Card'}
        footer={
          <>
            {editUid && (
              <button className="btn btn-del" onClick={handleDelete}>
                🗑 Elimina
              </button>
            )}
            <button className="btn btn-ghost" onClick={() => setModalOpen(false)}>
              Annulla
            </button>
            <button className="btn btn-primary" onClick={handleSave}>
              Salva
            </button>
          </>
        }
      >
        <div className="frow">
          <div className="fg" style={{ gridColumn: '1/-1' }}>
            <label className="fl">Nome / Azienda *</label>
            <input
              className="fi"
              placeholder="Es. Mario Rossi"
              value={form.n}
              onChange={e => setForm(f => ({ ...f, n: e.target.value }))}
            />
          </div>
        </div>
        <div className="frow">
          <div className="fg">
            <label className="fl">ID</label>
            <input
              className="fi"
              placeholder="Es. 105"
              value={form.id || ''}
              onChange={e => setForm(f => ({ ...f, id: e.target.value }))}
            />
          </div>
          <div className="fg">
            <label className="fl">Stato</label>
            <select
              className="fi"
              value={form.s}
              onChange={e => setForm(f => ({ ...f, s: e.target.value }))}
            >
              {COLS.map(col => (
                <option key={col.id} value={col.id}>{col.e} {col.label}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="frow">
          <div className="fg">
            <label className="fl">Priorità</label>
            <select
              className="fi"
              value={form.p || ''}
              onChange={e => setForm(f => ({ ...f, p: e.target.value }))}
            >
              <option value="">Nessuna</option>
              <option value="Alta">🔴 Alta</option>
              <option value="Media">🟡 Media</option>
              <option value="Bassa">🔵 Bassa</option>
            </select>
          </div>
          <div className="fg">
            <label className="fl">Responsabile</label>
            <input
              className="fi"
              placeholder="Nome responsabile"
              value={form.r || ''}
              onChange={e => setForm(f => ({ ...f, r: e.target.value }))}
            />
          </div>
        </div>
        <div className="frow">
          <div className="fg">
            <label className="fl">Scadenza</label>
            <input
              className="fi"
              type="date"
              value={form.d || ''}
              onChange={e => setForm(f => ({ ...f, d: e.target.value }))}
            />
          </div>
          <div className="fg">
            <label className="fl">Prezzo (€)</label>
            <input
              className="fi"
              type="number"
              placeholder="Es. 5000"
              value={form.$ || ''}
              onChange={e => setForm(f => ({ ...f, $: e.target.value }))}
            />
          </div>
        </div>
        <div className="fg">
          <label className="fl">Descrizione / Note</label>
          <textarea
            className="fi"
            rows={3}
            placeholder="Note, dettagli, email…"
            style={{ resize: 'vertical' }}
            value={form.note || ''}
            onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
          />
        </div>
      </Modal>
    </>
  )
}

interface KanbanCardProps {
  card: Card
  onEdit: () => void
  onDragStart: (e: React.DragEvent) => void
  onDragEnd: (e: React.DragEvent) => void
}

function KanbanCard({ card, onEdit, onDragStart, onDragEnd }: KanbanCardProps) {
  return (
    <div
      className="card"
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <div className="card-actions">
        <button className="icon-btn" onClick={onEdit}>✏️</button>
      </div>
      <div className="card-header">
        <div className="card-name">{card.n}</div>
        {card.id && <span className="card-num">#{card.id}</span>}
      </div>
      {card.note && <div className="card-desc">{card.note}</div>}
      <div className="card-tags">
        {card.p && (
          <span className={`tag tag-${card.p.toLowerCase()}`}>
            {card.p === 'Alta' ? '🔴' : card.p === 'Media' ? '🟡' : '🔵'} {card.p}
          </span>
        )}
        {card.$ && (
          <span className="tag tag-price">€{Number(card.$).toLocaleString('it')}</span>
        )}
        {card.d && (
          <span className={`tag tag-deadline ${dateClass(card.d)}`}>
            📅 {fDate(card.d)}
          </span>
        )}
        {card.r && (
          <span className="tag tag-resp">👤 {card.r}</span>
        )}
      </div>
    </div>
  )
}
