'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { ContactModal } from '@/components/crm/ContactModal'
import {
  formatDateTime,
  isClosedStatus,
  isComuneContact,
  isNeverContacted,
  priorityBadgeClass,
  priorityLabel,
  sourceLabel,
  statusLabel,
  toLocalDateKey,
} from '@/lib/data'
import { useCRMContext } from '../layout'
import type { CRMContact } from '@/types'

export default function ContactsPage() {
  const {
    contacts,
    scheduledCalls,
    openContactsWithoutQueue,
    stages,
    createContact,
    updateContact,
    deleteContact,
    showToast,
  } = useCRMContext()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [priorityFilter, setPriorityFilter] = useState('')
  const [contactStateFilter, setContactStateFilter] = useState('')
  const [comuneFilter, setComuneFilter] = useState('')
  const [focusFilter, setFocusFilter] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingContact, setEditingContact] = useState<CRMContact | null>(null)

  const sources = Array.from(new Set(contacts.map((contact) => contact.source).filter(Boolean))).sort()
  const categories = Array.from(new Set(contacts.map((contact) => contact.category).filter(Boolean))).sort()
  const scheduledCallsByContactId = useMemo(
    () => new Map(scheduledCalls.map((item) => [item.contact.id, item])),
    [scheduledCalls]
  )
  const todayKey = toLocalDateKey(new Date())
  const tomorrowKey = useMemo(() => {
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    return toLocalDateKey(tomorrow)
  }, [])
  const missingQueueCount = useMemo(
    () => openContactsWithoutQueue.filter((contact) => !isClosedStatus(contact.status)).length,
    [openContactsWithoutQueue]
  )

  const filtered = useMemo(() => {
    return contacts.filter((contact) => {
      const scheduledCall = scheduledCallsByContactId.get(contact.id) || null
      const query = search.trim().toLowerCase()
      if (
        query &&
        !contact.name.toLowerCase().includes(query) &&
        !(contact.company || '').toLowerCase().includes(query) &&
        !(contact.email || '').toLowerCase().includes(query) &&
        !(contact.phone || '').toLowerCase().includes(query) &&
        !(contact.event_tag || '').toLowerCase().includes(query) &&
        !(contact.category || '').toLowerCase().includes(query)
      ) {
        return false
      }
      if (statusFilter && contact.status !== statusFilter) return false
      if (sourceFilter && contact.source !== sourceFilter) return false
      if (categoryFilter && contact.category !== categoryFilter) return false
      if (priorityFilter && String(contact.priority) !== priorityFilter) return false
      if (contactStateFilter === 'never' && !isNeverContacted(contact)) return false
      if (contactStateFilter === 'contacted' && isNeverContacted(contact)) return false
      if (comuneFilter === 'comuni' && !isComuneContact(contact)) return false
      if (comuneFilter === 'altri' && isComuneContact(contact)) return false
      if (focusFilter === 'new' && !isNeverContacted(contact)) return false
      if (focusFilter === 'today' && toLocalDateKey(scheduledCall?.due_at) !== todayKey) return false
      if (focusFilter === 'tomorrow' && toLocalDateKey(scheduledCall?.due_at) !== tomorrowKey) return false
      if (focusFilter === 'missing' && (isClosedStatus(contact.status) || !!scheduledCall)) return false
      if (focusFilter === 'missing-phone' && (!scheduledCall || !!contact.phone)) return false
      return true
    })
  }, [
    comuneFilter,
    contactStateFilter,
    contacts,
    focusFilter,
    categoryFilter,
    priorityFilter,
    scheduledCallsByContactId,
    search,
    sourceFilter,
    statusFilter,
    todayKey,
    tomorrowKey,
  ])

  return (
    <>
      <div className="toolbar">
        <div className="search">
          <span style={{ color: 'var(--text3)' }}>🔍</span>
          <input
            type="text"
            placeholder="Cerca contatto, email, telefono..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <select className="filter-select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="">Tutti gli stadi</option>
          {stages.map((stage) => (
            <option key={stage.id} value={stage.name}>
              {statusLabel(stage.name)}
            </option>
          ))}
        </select>
        <select className="filter-select" value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}>
          <option value="">Tutte le origini</option>
          {sources.map((source) => (
            <option key={source} value={source || ''}>
              {sourceLabel(source)}
            </option>
          ))}
        </select>
        <select className="filter-select" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
          <option value="">Tutte le categorie</option>
          {categories.map((category) => (
            <option key={category} value={category || ''}>
              {category}
            </option>
          ))}
        </select>
        <select className="filter-select" value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}>
          <option value="">Tutte le priorità</option>
          <option value="3">Alta</option>
          <option value="2">Media</option>
          <option value="1">Bassa</option>
          <option value="0">Nessuna</option>
        </select>
        <select className="filter-select" value={contactStateFilter} onChange={(event) => setContactStateFilter(event.target.value)}>
          <option value="">Tutti i contatti</option>
          <option value="never">Mai contattati</option>
          <option value="contacted">Già contattati</option>
        </select>
        <select className="filter-select" value={comuneFilter} onChange={(event) => setComuneFilter(event.target.value)}>
          <option value="">Tutti i tipi</option>
          <option value="comuni">Solo comuni</option>
          <option value="altri">Escludi comuni</option>
        </select>
        <button
          className={`filter-chip ${focusFilter === 'new' ? 'active' : ''}`}
          onClick={() => setFocusFilter((current) => current === 'new' ? '' : 'new')}
        >
          Nuovi lead
        </button>
        <button
          className={`filter-chip ${focusFilter === 'today' ? 'active' : ''}`}
          onClick={() => setFocusFilter((current) => current === 'today' ? '' : 'today')}
        >
          Da chiamare oggi
        </button>
        <button
          className={`filter-chip ${focusFilter === 'tomorrow' ? 'active' : ''}`}
          onClick={() => setFocusFilter((current) => current === 'tomorrow' ? '' : 'tomorrow')}
        >
          Da chiamare domani
        </button>
        <button
          className={`filter-chip ${focusFilter === 'missing' ? 'active' : ''}`}
          onClick={() => setFocusFilter((current) => current === 'missing' ? '' : 'missing')}
        >
          Senza next step
        </button>
        <button
          className={`filter-chip ${focusFilter === 'missing-phone' ? 'active' : ''}`}
          onClick={() => setFocusFilter((current) => current === 'missing-phone' ? '' : 'missing-phone')}
        >
          Senza telefono
        </button>
        <button
          className="btn btn-primary btn-sm"
          style={{ marginLeft: 'auto' }}
          onClick={() => {
            setEditingContact(null)
            setModalOpen(true)
          }}
        >
          ＋ Contatto
        </button>
      </div>

      <div className="contacts-content">
        <div className="dash-meta-grid" style={{ marginBottom: 20 }}>
          <div className="meta-card meta-card-strong">
            <strong>{contacts.filter((contact) => isNeverContacted(contact)).length}</strong>
            <span>nuovi lead da lavorare</span>
          </div>
          <div className="meta-card">
            <strong>{scheduledCalls.filter((item) => toLocalDateKey(item.due_at) === todayKey).length}</strong>
            <span>chiamate previste oggi</span>
          </div>
          <div className="meta-card">
            <strong>{scheduledCalls.filter((item) => toLocalDateKey(item.due_at) === tomorrowKey).length}</strong>
            <span>chiamate previste domani</span>
          </div>
          <div className="meta-card">
            <strong>{missingQueueCount}</strong>
            <span>lead aperti senza prossimo step</span>
          </div>
        </div>

        <div className="contacts-grid">
          {filtered.length === 0 ? (
            <p style={{ color: 'var(--text3)' }}>Nessun contatto trovato.</p>
          ) : (
            filtered.map((contact) => {
              const scheduledCall = scheduledCallsByContactId.get(contact.id) || null

              return (
                <div key={contact.id} className="contact-card contact-card-rich">
                  <Link href={`/contacts/${contact.id}`} className="contact-card-link">
                    <div className="contact-name">{contact.name}</div>
                    <div className="contact-meta">{contact.company || 'Azienda non impostata'}</div>
                    <div className="contact-meta">{contact.email || 'Nessuna email'}</div>
                    <div className="contact-meta">{contact.phone || 'Nessun telefono'}</div>
                    <div className="contact-meta">Origine: {sourceLabel(contact.source)}</div>
                    <div className="contact-meta">Evento: {contact.event_tag || 'Non assegnato'}</div>
                    <div className="contact-meta">Categoria: {contact.category || 'Non assegnata'}</div>
                    <div className="contact-meta">Follow-up: {formatDateTime(scheduledCall?.due_at || contact.next_followup_at)}</div>
                    <div className="contact-tags">
                      <span className="ctag ctag-contattato">{statusLabel(contact.status)}</span>
                      <span className={`ctag ${priorityBadgeClass(contact.priority)}`}>{priorityLabel(contact.priority)}</span>
                      {contact.event_tag && <span className="ctag ctag-event">{contact.event_tag}</span>}
                      {contact.category && <span className="ctag ctag-comune">{contact.category}</span>}
                      {scheduledCall && <span className="ctag ctag-referenziato">{scheduledCall.task_type}</span>}
                      {isNeverContacted(contact) && <span className="ctag ctag-dacontattare">Mai contattato</span>}
                    </div>
                  </Link>
                  <div className="card-actions-row">
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => {
                        setEditingContact(contact)
                        setModalOpen(true)
                      }}
                    >
                      Modifica
                    </button>
                    <Link href={`/contacts/${contact.id}`} className="btn btn-primary btn-sm">
                      Scheda
                    </Link>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      <ContactModal
        open={modalOpen}
        title={editingContact ? 'Modifica Contatto' : 'Nuovo Contatto'}
        stages={stages}
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
