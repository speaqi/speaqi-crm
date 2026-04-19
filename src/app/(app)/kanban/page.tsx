'use client'

import Link from 'next/link'
import { useMemo, useRef, useState } from 'react'
import { ContactModal } from '@/components/crm/ContactModal'
import {
  formatDateTime,
  isComuneContact,
  priorityBadgeClass,
  priorityLabel,
  sourceLabel,
  statusLabel,
  stageColor,
} from '@/lib/data'
import { useCRMContext } from '../layout'
import type { CRMContact } from '@/types'

type ViewMode = 'board' | 'list'

const DAY_MS = 24 * 60 * 60 * 1000

function startOfDay(date: Date) {
  const clone = new Date(date)
  clone.setHours(0, 0, 0, 0)
  return clone
}

function bucketFor(dueAt: string | null | undefined, now: Date): 'overdue' | 'today' | 'tomorrow' | 'week' | 'later' | 'none' {
  if (!dueAt) return 'none'
  const due = new Date(dueAt)
  if (Number.isNaN(due.getTime())) return 'none'
  const today = startOfDay(now)
  const tomorrow = new Date(today.getTime() + DAY_MS)
  const weekEnd = new Date(today.getTime() + 7 * DAY_MS)
  if (due < today) return 'overdue'
  if (due < tomorrow) return 'today'
  if (due < new Date(tomorrow.getTime() + DAY_MS)) return 'tomorrow'
  if (due < weekEnd) return 'week'
  return 'later'
}

const BUCKET_LABELS: Record<string, string> = {
  overdue: '⏰ In ritardo',
  today: '🔥 Oggi',
  tomorrow: '📅 Domani',
  week: '📆 Questa settimana',
  later: '🗓 Più avanti',
  none: '💤 Senza follow-up',
}

const BUCKET_ORDER: Array<keyof typeof BUCKET_LABELS> = ['overdue', 'today', 'tomorrow', 'week', 'later', 'none']

export default function KanbanPage() {
  const { stages, contacts, scheduledCalls, teamMembers, completeTask, createContact, updateContact, deleteContact, showToast } = useCRMContext()
  const [view, setView] = useState<ViewMode>('board')
  const [search, setSearch] = useState('')
  const [priorityFilter, setPriorityFilter] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [comuneFilter, setComuneFilter] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingContact, setEditingContact] = useState<CRMContact | null>(null)
  const dragId = useRef<string | null>(null)

  const filtered = useMemo(() => {
    return contacts.filter((contact) => {
      const query = search.trim().toLowerCase()
      if (
        query &&
        !contact.name.toLowerCase().includes(query) &&
        !(contact.email || '').toLowerCase().includes(query) &&
        !(contact.responsible || '').toLowerCase().includes(query) &&
        !(contact.category || '').toLowerCase().includes(query)
      ) {
        return false
      }

      if (priorityFilter && String(contact.priority) !== priorityFilter) return false
      if (sourceFilter && contact.source !== sourceFilter) return false
      if (categoryFilter && contact.category !== categoryFilter) return false
      if (comuneFilter === 'comuni' && !isComuneContact(contact)) return false
      if (comuneFilter === 'altri' && isComuneContact(contact)) return false
      return true
    })
  }, [categoryFilter, comuneFilter, contacts, priorityFilter, search, sourceFilter])

  const uniqueSources = Array.from(new Set(contacts.map((contact) => contact.source).filter(Boolean))).sort()
  const uniqueCategories = Array.from(new Set(contacts.map((contact) => contact.category).filter(Boolean))).sort()

  const filteredIds = useMemo(() => new Set(filtered.map((contact) => contact.id)), [filtered])
  const now = useMemo(() => new Date(), [])

  const listBuckets = useMemo(() => {
    const buckets: Record<string, typeof scheduledCalls> = {
      overdue: [],
      today: [],
      tomorrow: [],
      week: [],
      later: [],
      none: [],
    }
    for (const call of scheduledCalls) {
      if (!filteredIds.has(call.contact.id)) continue
      const bucket = bucketFor(call.due_at, now)
      buckets[bucket].push(call)
    }
    for (const contact of filtered) {
      if (contact.next_followup_at) continue
      if (scheduledCalls.some((call) => call.contact.id === contact.id)) continue
      buckets.none.push({
        contact,
        task: null,
        due_at: '',
        source: 'contact',
        task_type: 'follow-up',
      })
    }
    return buckets
  }, [filtered, filteredIds, now, scheduledCalls])

  function openCreate() {
    setEditingContact(null)
    setModalOpen(true)
  }

  function openEdit(contact: CRMContact) {
    setEditingContact(contact)
    setModalOpen(true)
  }

  async function handleDrop(status: string) {
    const id = dragId.current
    dragId.current = null
    if (!id) return

    const contact = contacts.find((item) => item.id === id)
    if (!contact || contact.status === status) return

    try {
      await updateContact(id, { status })
      showToast(`"${contact.name}" spostato in ${statusLabel(status)}`)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Spostamento non riuscito')
    }
  }

  async function handleComplete(taskId: string) {
    try {
      await completeTask(taskId)
      showToast('Completato')
    } catch (error) {
      showToast(`Errore: ${error instanceof Error ? error.message : 'completamento'}`)
    }
  }

  return (
    <>
      <div className="toolbar">
        <div className="pipeline-toggle" role="tablist">
          <button
            type="button"
            className={`pipeline-toggle-btn ${view === 'board' ? 'active' : ''}`}
            onClick={() => setView('board')}
          >
            🔀 Board
          </button>
          <button
            type="button"
            className={`pipeline-toggle-btn ${view === 'list' ? 'active' : ''}`}
            onClick={() => setView('list')}
          >
            📋 Lista
          </button>
        </div>
        <div className="search">
          <span style={{ color: 'var(--text3)' }}>🔍</span>
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Cerca nome, email, persona…"
          />
        </div>
        <select className="filter-select" value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}>
          <option value="">Tutte le priorità</option>
          <option value="3">Alta</option>
          <option value="2">Media</option>
          <option value="1">Bassa</option>
          <option value="0">Nessuna</option>
        </select>
        <select className="filter-select" value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}>
          <option value="">Tutte le origini</option>
          {uniqueSources.map((source) => (
            <option key={source} value={source || ''}>
              {sourceLabel(source)}
            </option>
          ))}
        </select>
        <select className="filter-select" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
          <option value="">Tutte le categorie</option>
          {uniqueCategories.map((category) => (
            <option key={category} value={category || ''}>
              {category}
            </option>
          ))}
        </select>
        <select className="filter-select" value={comuneFilter} onChange={(event) => setComuneFilter(event.target.value)}>
          <option value="">Tutti i contatti</option>
          <option value="comuni">Solo comuni</option>
          <option value="altri">Escludi comuni</option>
        </select>
        <div className="toolbar-stats">
          <span className="tstat">Lead: <strong>{filtered.length}</strong></span>
          <span className="tstat">Alta priorità: <strong style={{ color: 'var(--red)' }}>{filtered.filter((contact) => contact.priority >= 3).length}</strong></span>
        </div>
        <button className="btn btn-primary btn-sm" onClick={openCreate}>
          ＋ Nuovo contatto
        </button>
      </div>

      {view === 'list' ? (
        <div className="pipeline-list">
          {BUCKET_ORDER.map((bucket) => {
            const items = listBuckets[bucket]
            if (!items || items.length === 0) return null
            return (
              <section key={bucket} className="pipeline-bucket">
                <div className="pipeline-bucket-head">
                  <span>{BUCKET_LABELS[bucket]}</span>
                  <span className="pipeline-bucket-count">{items.length}</span>
                </div>
                <div className="pipeline-bucket-list">
                  {items.map((call) => (
                    <div key={call.contact.id} className="pipeline-list-row">
                      <Link
                        href={`/contacts?id=${call.contact.id}`}
                        className="pipeline-list-main"
                      >
                        <strong>{call.contact.name}</strong>
                        {call.contact.company && (
                          <span className="pipeline-list-company">· {call.contact.company}</span>
                        )}
                      </Link>
                      <span className="pipeline-list-stage" style={{ background: stageColor(call.contact.status, stages) }}>
                        {statusLabel(call.contact.status)}
                      </span>
                      {call.contact.priority > 0 && (
                        <span className={`ctag ${priorityBadgeClass(call.contact.priority)}`}>
                          {priorityLabel(call.contact.priority)}
                        </span>
                      )}
                      <span className="pipeline-list-date">
                        {call.due_at ? formatDateTime(call.due_at) : 'Senza data'}
                      </span>
                      {call.task?.id ? (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => handleComplete(call.task!.id)}
                        >
                          ✓ fatto
                        </button>
                      ) : (
                        <Link
                          href={`/contacts?id=${call.contact.id}`}
                          className="btn btn-ghost btn-sm"
                        >
                          apri →
                        </Link>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      ) : (
      <div className="board-outer">
        <div className="board-scroll">
          <div className="board">
            {stages.map((stage) => {
              const stageContacts = filtered.filter((contact) => contact.status === stage.name)
              return (
                <div key={stage.id} className="col">
                  <div className="col-head">
                    <div className="col-dot" style={{ background: stage.color || '#4f6ef7' }} />
                    <div className="col-name">{statusLabel(stage.name)}</div>
                    <div className="col-count">{stageContacts.length}</div>
                  </div>
                  <div
                    className="col-cards"
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault()
                      handleDrop(stage.name)
                    }}
                  >
                    {stageContacts.length === 0 ? (
                      <div className="empty-col">
                        <div className="e-icon">📭</div>
                        Vuoto
                      </div>
                    ) : (
                      stageContacts.map((contact) => (
                        <div
                          key={contact.id}
                          className="card"
                          draggable
                          onDragStart={() => {
                            dragId.current = contact.id
                          }}
                          onDragEnd={() => {
                            dragId.current = null
                          }}
                        >
                          <div className="card-actions">
                            <button className="icon-btn" onClick={() => openEdit(contact)}>✏️</button>
                          </div>
                          <div className="card-header">
                            <div className="card-name">{contact.name}</div>
                          </div>
                          <div className="card-desc">
                            {contact.last_activity_summary || 'Nessuna attività registrata'}
                          </div>
                          <div className="card-tags">
                            <span className={`tag ${priorityBadgeClass(contact.priority)}`}>{priorityLabel(contact.priority)}</span>
                            {contact.source && <span className="tag tag-price">{sourceLabel(contact.source)}</span>}
                            {contact.category && <span className="tag tag-resp">{contact.category}</span>}
                            {contact.responsible && <span className="tag tag-resp">👤 {contact.responsible}</span>}
                          </div>
                          <div className="card-meta">
                            <div>Prossimo follow-up</div>
                            <strong>{formatDateTime(contact.next_followup_at)}</strong>
                          </div>
                          <div className="card-meta">
                            <div>Ultimo contatto</div>
                            <strong>{formatDateTime(contact.last_contact_at)}</strong>
                          </div>
                          <div className="card-actions-row">
                            <Link href={`/contacts?id=${contact.id}`} className="btn btn-ghost btn-sm">
                              Apri scheda
                            </Link>
                            <span className="stage-pill" style={{ background: stageColor(contact.status, stages) }}>
                              {statusLabel(contact.status)}
                            </span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
      )}

      <ContactModal
        open={modalOpen}
        title={editingContact ? 'Modifica contatto' : 'Nuovo contatto'}
        stages={stages}
        teamMembers={teamMembers}
        initialContact={editingContact}
        onClose={() => setModalOpen(false)}
        onSave={async (payload) => {
          if (editingContact) {
            await updateContact(editingContact.id, payload)
            showToast('Contatto aggiornato')
          } else {
            await createContact(payload)
            showToast('Contatto creato')
          }
        }}
        onDelete={
          editingContact
            ? async () => {
                await deleteContact(editingContact.id)
                showToast('Contatto eliminato')
              }
            : undefined
        }
      />
    </>
  )
}
