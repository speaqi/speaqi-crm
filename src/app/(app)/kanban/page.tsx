'use client'

import Link from 'next/link'
import { useMemo, useRef, useState } from 'react'
import { ContactModal } from '@/components/crm/ContactModal'
import {
  formatDateTime,
  isComuneContact,
  isPipelineVisible,
  priorityBadgeClass,
  priorityLabel,
  sourceLabel,
  stageColor,
} from '@/lib/data'
import { useCRMContext } from '../layout'
import type { CRMContact } from '@/types'

export default function KanbanPage() {
  const { stages, contacts, createContact, updateContact, deleteContact, showToast } = useCRMContext()
  const [search, setSearch] = useState('')
  const [priorityFilter, setPriorityFilter] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')
  const [comuneFilter, setComuneFilter] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingContact, setEditingContact] = useState<CRMContact | null>(null)
  const dragId = useRef<string | null>(null)

  const filtered = useMemo(() => {
    return contacts.filter((contact) => {
      if (!isPipelineVisible(contact)) return false

      const query = search.trim().toLowerCase()
      if (
        query &&
        !contact.name.toLowerCase().includes(query) &&
        !(contact.email || '').toLowerCase().includes(query) &&
        !(contact.responsible || '').toLowerCase().includes(query)
      ) {
        return false
      }

      if (priorityFilter && String(contact.priority) !== priorityFilter) return false
      if (sourceFilter && contact.source !== sourceFilter) return false
      if (comuneFilter === 'comuni' && !isComuneContact(contact)) return false
      if (comuneFilter === 'altri' && isComuneContact(contact)) return false
      return true
    })
  }, [comuneFilter, contacts, priorityFilter, search, sourceFilter])

  const uniqueSources = Array.from(new Set(contacts.map((contact) => contact.source).filter(Boolean))).sort()

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
      showToast(`"${contact.name}" spostato in ${status}`)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Spostamento non riuscito')
    }
  }

  return (
    <>
      <div className="toolbar">
        <div className="search">
          <span style={{ color: 'var(--text3)' }}>🔍</span>
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Cerca lead, email, responsabile..."
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
          ＋ Nuovo Lead
        </button>
      </div>

      <div className="board-outer">
        <div className="board-scroll">
          <div className="board">
            {stages.map((stage) => {
              const stageContacts = filtered.filter((contact) => contact.status === stage.name)
              return (
                <div key={stage.id} className="col">
                  <div className="col-head">
                    <div className="col-dot" style={{ background: stage.color || '#4f6ef7' }} />
                    <div className="col-name">{stage.name}</div>
                    <div className="col-count">{stageContacts.length}</div>
                  </div>
                  <div
                    className="col-cards"
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => handleDrop(stage.name)}
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
                            <Link href={`/contacts/${contact.id}`} className="btn btn-ghost btn-sm">
                              Apri scheda
                            </Link>
                            <span className="stage-pill" style={{ background: stageColor(contact.status, stages) }}>
                              {contact.status}
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

      <ContactModal
        open={modalOpen}
        title={editingContact ? 'Modifica Lead' : 'Nuovo Lead'}
        stages={stages}
        initialContact={editingContact}
        onClose={() => setModalOpen(false)}
        onSave={async (payload) => {
          if (editingContact) {
            await updateContact(editingContact.id, payload)
            showToast('Lead aggiornato')
          } else {
            await createContact(payload)
            showToast('Lead creato')
          }
        }}
        onDelete={
          editingContact
            ? async () => {
                await deleteContact(editingContact.id)
                showToast('Lead eliminato')
              }
            : undefined
        }
      />
    </>
  )
}
