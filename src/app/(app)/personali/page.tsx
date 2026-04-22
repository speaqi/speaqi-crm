'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { ContactModal } from '@/components/crm/ContactModal'
import { formatDateTime, personalSectionLabel, priorityBadgeClass, priorityLabel, statusLabel } from '@/lib/data'
import { useCRMContext } from '../layout'
import type { CRMContact, TaskWithContact } from '@/types'

export default function PersonaliPage() {
  const {
    personalContacts,
    personalTasks,
    stages,
    teamMembers,
    createContact,
    updateContact,
    deleteContact,
    showToast,
  } = useCRMContext()
  const [search, setSearch] = useState('')
  const [sectionFilter, setSectionFilter] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingContact, setEditingContact] = useState<CRMContact | null>(null)

  const taskByContactId = useMemo(
    () => new Map(personalTasks.map((task: TaskWithContact) => [task.contact_id, task])),
    [personalTasks]
  )

  const sectionOptions = useMemo(
    () =>
      Array.from(new Set(personalContacts.map((contact) => personalSectionLabel(contact)).filter(Boolean))).sort(),
    [personalContacts]
  )

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()

    return personalContacts.filter((contact) => {
      if (sectionFilter && personalSectionLabel(contact) !== sectionFilter) return false
      if (!query) return true

      return [
        contact.name,
        contact.company,
        contact.email,
        contact.phone,
        contact.note,
        contact.personal_section,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(query)
    })
  }, [personalContacts, search, sectionFilter])

  const grouped = useMemo(() => {
    return filtered.reduce<Record<string, CRMContact[]>>((accumulator, contact) => {
      const key = personalSectionLabel(contact)
      accumulator[key] = accumulator[key] || []
      accumulator[key].push(contact)
      return accumulator
    }, {})
  }, [filtered])

  const sectionEntries = useMemo(
    () =>
      Object.entries(grouped).sort(([left], [right]) => {
        if (left === 'Senza sezione') return 1
        if (right === 'Senza sezione') return -1
        return left.localeCompare(right)
      }),
    [grouped]
  )

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
              placeholder="Cerca amici, persone da chiamare, note..."
            />
          </div>
          <select
            className="filter-select"
            value={sectionFilter}
            onChange={(event) => setSectionFilter(event.target.value)}
          >
            <option value="">Tutte le sezioni</option>
            {sectionOptions.map((section) => (
              <option key={section} value={section}>
                {section}
              </option>
            ))}
          </select>
          <button
            className="btn btn-primary btn-sm contacts-toolbar-cta"
            onClick={() => {
              setEditingContact(null)
              setModalOpen(true)
            }}
          >
            ＋ Nuovo personale
          </button>
        </div>

        <div className="contacts-summary">
          <span>
            <strong>{personalContacts.length}</strong> contatti personali
          </span>
          <span>
            <strong>{sectionOptions.length}</strong> sezioni
          </span>
          <span>
            <strong>{personalTasks.length}</strong> promemoria attivi
          </span>
        </div>

        {sectionEntries.length === 0 ? (
          <div className="contacts-empty" style={{ border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)' }}>
            <p>Nessun contatto personale trovato.</p>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => {
                setEditingContact(null)
                setModalOpen(true)
              }}
            >
              Aggiungi il primo
            </button>
          </div>
        ) : (
          sectionEntries.map(([section, contacts]) => (
            <div key={section} className="dash-card">
              <div className="dash-card-title">{section}</div>
              <div className="contacts-grid">
                {contacts.map((contact) => {
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
                          <span className="ctag ctag-event">🗂️ {section}</span>
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
          ))
        )}
      </div>

      <ContactModal
        open={modalOpen}
        title={editingContact ? 'Modifica contatto personale' : 'Nuovo contatto personale'}
        stages={stages}
        teamMembers={teamMembers}
        initialContact={editingContact}
        onClose={() => setModalOpen(false)}
        onSave={async (payload) => {
          const normalizedPayload = {
            ...payload,
            contact_scope: 'personal' as const,
            source: payload.source || 'manual',
          }

          if (editingContact) {
            await updateContact(editingContact.id, normalizedPayload)
            showToast('Contatto personale aggiornato')
          } else {
            await createContact(normalizedPayload)
            showToast('Contatto personale creato')
          }
        }}
        onDelete={
          editingContact
            ? async () => {
                await deleteContact(editingContact.id)
                showToast('Contatto personale eliminato')
              }
            : undefined
        }
      />
    </>
  )
}
