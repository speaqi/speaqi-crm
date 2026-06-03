'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { ContactModal } from '@/components/crm/ContactModal'
import { formatDateTime, priorityBadgeClass, priorityLabel, statusLabel } from '@/lib/data'
import { useCRMContext } from '../layout'
import type { CRMContact, TaskWithContact } from '@/types'

export default function PartnerPage() {
  const {
    partnerContacts,
    partnerTasks,
    stages,
    teamMembers,
    createContact,
    updateContact,
    deleteContact,
    showToast,
  } = useCRMContext()
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingContact, setEditingContact] = useState<CRMContact | null>(null)

  const taskByContactId = useMemo(
    () => new Map(partnerTasks.map((task: TaskWithContact) => [task.contact_id, task])),
    [partnerTasks]
  )

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return partnerContacts

    return partnerContacts.filter((contact) => {
      return [
        contact.name,
        contact.company,
        contact.email,
        contact.phone,
        contact.note,
        contact.category,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(query)
    })
  }, [partnerContacts, search])

  return (
    <>
      <div className="contacts-page">
        <div className="contacts-toolbar">
          <div className="contacts-search">
            <span className="contacts-search-icon">🔍</span>
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Cerca partner per nome, azienda, note..."
            />
          </div>
          <button
            className="btn btn-primary btn-sm contacts-toolbar-cta"
            onClick={() => {
              setEditingContact(null)
              setModalOpen(true)
            }}
          >
            ＋ Nuovo partner
          </button>
        </div>

        <div className="contacts-summary">
          <span>
            <strong>{partnerContacts.length}</strong> partner
          </span>
          <span>
            <strong>{partnerTasks.length}</strong> promemoria attivi
          </span>
        </div>

        {filtered.length === 0 ? (
          <div className="contacts-empty" style={{ border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)' }}>
            {search.trim() ? (
              <p>Nessun partner trovato per «{search}».</p>
            ) : (
              <>
                <p>Nessun partner salvato.</p>
                <p className="text-muted">
                  I partner sono contatti che ti supportano e a cui riconosci una percentuale sulle vendite. Aggiungili qui per tenerli sotto controllo.
                </p>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => {
                    setEditingContact(null)
                    setModalOpen(true)
                  }}
                >
                  Aggiungi il primo partner
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="dash-card">
            <div className="dash-card-title">🤝 Partner</div>
            <div className="contacts-grid">
              {filtered.map((contact) => {
                const pendingTask = taskByContactId.get(contact.id) || null

                return (
                  <div key={contact.id} className="contact-card contact-card-rich">
                    <Link href={`/contacts/${contact.id}`} className="contact-card-link">
                      <div className="contact-name">{contact.name}</div>
                      <div className="contact-meta">{contact.company || contact.email || 'Nessun dettaglio principale'}</div>
                      <div className="contact-meta">{contact.phone || 'Telefono non impostato'}</div>
                      <div className="contact-meta">Promemoria: {formatDateTime(pendingTask?.due_date || contact.next_followup_at)}</div>
                      <div className="contact-meta">{contact.note || 'Nessuna nota salvata'}</div>
                      <div className="contact-tags">
                        {contact.category && <span className="ctag ctag-event">🏷️ {contact.category}</span>}
                        <span className="ctag ctag-contattato">{statusLabel(contact.status)}</span>
                        <span className={`ctag ${priorityBadgeClass(contact.priority)}`}>{priorityLabel(contact.priority)}</span>
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
              })}
            </div>
          </div>
        )}
      </div>

      <ContactModal
        open={modalOpen}
        title={editingContact ? 'Modifica partner' : 'Nuovo partner'}
        stages={stages}
        teamMembers={teamMembers}
        initialContact={editingContact}
        onClose={() => setModalOpen(false)}
        onSave={async (payload) => {
          const normalizedPayload = {
            ...payload,
            contact_scope: 'partner' as const,
            source: payload.source || 'manual',
          }

          if (editingContact) {
            await updateContact(editingContact.id, normalizedPayload)
            showToast('Partner aggiornato')
          } else {
            await createContact(normalizedPayload)
            showToast('Partner creato')
          }
        }}
        onDelete={
          editingContact
            ? async () => {
                await deleteContact(editingContact.id)
                showToast('Partner eliminato')
              }
            : undefined
        }
      />
    </>
  )
}
