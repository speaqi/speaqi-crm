'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { ContactModal } from '@/components/crm/ContactModal'
import { formatDateTime, priorityBadgeClass, priorityLabel, sourceLabel, statusLabel } from '@/lib/data'
import { useCRMContext } from '../layout'
import type { CRMContact } from '@/types'

export default function SpeaqiPage() {
  const { speaqiContacts, stages, teamMembers, createContact, updateContact, deleteContact, showToast } = useCRMContext()
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingContact, setEditingContact] = useState<CRMContact | null>(null)

  const filtered = useMemo(() => {
    return speaqiContacts.filter((contact) => {
      const query = search.trim().toLowerCase()
      return (
        !query ||
        contact.name.toLowerCase().includes(query) ||
        (contact.email || '').toLowerCase().includes(query) ||
        (contact.note || '').toLowerCase().includes(query)
      )
    })
  }, [search, speaqiContacts])

  return (
    <>
      <div className="toolbar">
        <div className="search">
          <span style={{ color: 'var(--text3)' }}>🔍</span>
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Cerca lead inbound..."
          />
        </div>
        <button
          className="btn btn-primary btn-sm"
          style={{ marginLeft: 'auto' }}
          onClick={() => {
            setEditingContact(null)
            setModalOpen(true)
          }}
        >
          ＋ Lead Inbound
        </button>
      </div>

      <div className="contacts-content">
        <div className="contacts-grid">
          {filtered.length === 0 ? (
            <p style={{ color: 'var(--text3)' }}>Nessun lead inbound presente.</p>
          ) : (
            filtered.map((contact) => (
              <div key={contact.id} className="contact-card contact-card-rich">
                <Link href={`/contacts/${contact.id}`} className="contact-card-link">
                  <div className="contact-name">{contact.name}</div>
                  <div className="contact-meta">{contact.email || 'Email non disponibile'}</div>
                  <div className="contact-meta">{contact.note || 'Nessuna nota importata'}</div>
                  <div className="contact-meta">Follow-up: {formatDateTime(contact.next_followup_at)}</div>
                  <div className="contact-tags">
                    <span className="ctag ctag-speaqi">{sourceLabel('speaqi')}</span>
                    <span className="ctag ctag-contattato">{statusLabel(contact.status)}</span>
                    <span className={`ctag ${priorityBadgeClass(contact.priority)}`}>{priorityLabel(contact.priority)}</span>
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
        title={editingContact ? 'Modifica lead inbound' : 'Nuovo lead inbound'}
        stages={stages}
        teamMembers={teamMembers}
        initialContact={editingContact}
        defaultSource="speaqi"
        onClose={() => setModalOpen(false)}
        onSave={async (payload) => {
          if (editingContact) {
            await updateContact(editingContact.id, { ...payload, source: 'speaqi' })
            showToast('Lead inbound aggiornato')
          } else {
            await createContact({ ...payload, source: 'speaqi' })
            showToast('Lead inbound creato')
          }
        }}
        onDelete={
          editingContact
            ? async () => {
                await deleteContact(editingContact.id)
                showToast('Lead inbound eliminato')
              }
            : undefined
        }
      />
    </>
  )
}
