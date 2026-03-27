'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { ContactModal } from '@/components/crm/ContactModal'
import {
  formatDateTime,
  isComuneContact,
  isNeverContacted,
  priorityBadgeClass,
  priorityLabel,
  sourceLabel,
} from '@/lib/data'
import { useCRMContext } from '../layout'
import type { CRMContact } from '@/types'

export default function ContactsPage() {
  const { contacts, stages, createContact, updateContact, deleteContact, showToast } = useCRMContext()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')
  const [priorityFilter, setPriorityFilter] = useState('')
  const [contactStateFilter, setContactStateFilter] = useState('')
  const [comuneFilter, setComuneFilter] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingContact, setEditingContact] = useState<CRMContact | null>(null)

  const sources = Array.from(new Set(contacts.map((contact) => contact.source).filter(Boolean))).sort()

  const filtered = useMemo(() => {
    return contacts.filter((contact) => {
      const query = search.trim().toLowerCase()
      if (
        query &&
        !contact.name.toLowerCase().includes(query) &&
        !(contact.email || '').toLowerCase().includes(query) &&
        !(contact.phone || '').toLowerCase().includes(query)
      ) {
        return false
      }
      if (statusFilter && contact.status !== statusFilter) return false
      if (sourceFilter && contact.source !== sourceFilter) return false
      if (priorityFilter && String(contact.priority) !== priorityFilter) return false
      if (contactStateFilter === 'never' && !isNeverContacted(contact)) return false
      if (contactStateFilter === 'contacted' && isNeverContacted(contact)) return false
      if (comuneFilter === 'comuni' && !isComuneContact(contact)) return false
      if (comuneFilter === 'altri' && isComuneContact(contact)) return false
      return true
    })
  }, [contacts, comuneFilter, contactStateFilter, priorityFilter, search, sourceFilter, statusFilter])

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
              {stage.name}
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
        <div className="contacts-grid">
          {filtered.length === 0 ? (
            <p style={{ color: 'var(--text3)' }}>Nessun contatto trovato.</p>
          ) : (
            filtered.map((contact) => (
              <div key={contact.id} className="contact-card contact-card-rich">
                <Link href={`/contacts/${contact.id}`} className="contact-card-link">
                  <div className="contact-name">{contact.name}</div>
                  <div className="contact-meta">{contact.email || 'Nessuna email'}</div>
                  <div className="contact-meta">{contact.phone || 'Nessun telefono'}</div>
                  <div className="contact-meta">Origine: {sourceLabel(contact.source)}</div>
                  <div className="contact-meta">Follow-up: {formatDateTime(contact.next_followup_at)}</div>
                  <div className="contact-tags">
                    <span className="ctag ctag-contattato">{contact.status}</span>
                    <span className={`ctag ${priorityBadgeClass(contact.priority)}`}>{priorityLabel(contact.priority)}</span>
                    {isNeverContacted(contact) && <span className="ctag ctag-dacontattare">Mai contattato</span>}
                  </div>
                </Link>
                <div className="card-actions-row">
                  <button className="btn btn-ghost btn-sm" onClick={() => { setEditingContact(contact); setModalOpen(true) }}>
                    Modifica
                  </button>
                  <Link href={`/contacts/${contact.id}`} className="btn btn-primary btn-sm">
                    Scheda
                  </Link>
                </div>
              </div>
            ))
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
