'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useMemo, useState } from 'react'
import { ContactDrawer } from '@/components/crm/ContactDrawer'
import { ContactModal } from '@/components/crm/ContactModal'
import {
  formatDateTime,
  holdingListLabel,
  isClosedStatus,
  isHoldingContact,
  isNeverContacted,
  priorityBadgeClass,
  priorityLabel,
  sourceLabel,
  statusLabel,
  toLocalDateKey,
} from '@/lib/data'
import { useCRMContext } from '../layout'
import type { CRMContact } from '@/types'

const FOCUS_CHIPS: Array<{ key: string; label: string }> = [
  { key: 'new', label: 'Nuovi' },
  { key: 'today', label: 'Oggi' },
  { key: 'tomorrow', label: 'Domani' },
  { key: 'missing', label: 'Senza next step' },
]

function ContactsPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const {
    allContacts,
    scheduledCalls,
    stages,
    createContact,
    updateContact,
    deleteContact,
    showToast,
  } = useCRMContext()

  const urlId = searchParams.get('id')
  const urlList = searchParams.get('list') || ''
  const urlTag = searchParams.get('tag') || ''
  const urlNew = searchParams.get('new')

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [listFilter, setListFilter] = useState(urlList)
  const [assigneeFilter, setAssigneeFilter] = useState('')
  const [focusFilter, setFocusFilter] = useState('')
  const [showMore, setShowMore] = useState(false)
  const [sourceFilter, setSourceFilter] = useState('')
  const [priorityFilter, setPriorityFilter] = useState('')

  const [modalOpen, setModalOpen] = useState(urlNew === '1')
  const [editingContact, setEditingContact] = useState<CRMContact | null>(null)

  useEffect(() => {
    setListFilter(urlList)
  }, [urlList])

  useEffect(() => {
    if (urlNew === '1') {
      setEditingContact(null)
      setModalOpen(true)
    }
  }, [urlNew])

  function openDrawer(id: string) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('id', id)
    router.replace(`/contacts?${params.toString()}`, { scroll: false })
  }

  function closeDrawer() {
    const params = new URLSearchParams(searchParams.toString())
    params.delete('id')
    const query = params.toString()
    router.replace(query ? `/contacts?${query}` : '/contacts', { scroll: false })
  }

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

  const lists = useMemo(
    () =>
      Array.from(
        new Set(
          allContacts
            .map((contact) => contact.list_name?.trim())
            .filter((name): name is string => Boolean(name))
        )
      ).sort(),
    [allContacts]
  )

  const sources = useMemo(
    () =>
      Array.from(
        new Set(allContacts.map((contact) => contact.source).filter((source): source is string => Boolean(source)))
      ).sort(),
    [allContacts]
  )

  const assignees = useMemo(
    () =>
      Array.from(
        new Set(
          allContacts
            .map((contact) => contact.responsible?.trim())
            .filter((value): value is string => Boolean(value))
        )
      ).sort(),
    [allContacts]
  )

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return allContacts.filter((contact) => {
      const call = scheduledCallsByContactId.get(contact.id) || null
      if (query) {
        const haystack = [
          contact.name,
          contact.company,
          contact.email,
          contact.phone,
          contact.event_tag,
          contact.list_name,
          contact.category,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        if (!haystack.includes(query)) return false
      }
      if (statusFilter && contact.status !== statusFilter) return false
      if (listFilter && contact.list_name !== listFilter) return false
      if (assigneeFilter) {
        if (assigneeFilter === '__unassigned__') {
          if (contact.responsible?.trim()) return false
        } else if (contact.responsible?.trim() !== assigneeFilter) {
          return false
        }
      }
      if (urlTag && contact.event_tag !== urlTag) return false
      if (sourceFilter && contact.source !== sourceFilter) return false
      if (priorityFilter && String(contact.priority) !== priorityFilter) return false
      if (focusFilter === 'new' && !isNeverContacted(contact)) return false
      if (focusFilter === 'today' && toLocalDateKey(call?.due_at) !== todayKey) return false
      if (focusFilter === 'tomorrow' && toLocalDateKey(call?.due_at) !== tomorrowKey) return false
      if (focusFilter === 'missing' && (isClosedStatus(contact.status) || !!call)) return false
      return true
    })
  }, [
    allContacts,
    assigneeFilter,
    focusFilter,
    listFilter,
    priorityFilter,
    scheduledCallsByContactId,
    search,
    sourceFilter,
    statusFilter,
    todayKey,
    tomorrowKey,
    urlTag,
  ])

  const activeFilterCount =
    (listFilter ? 1 : 0) +
    (statusFilter ? 1 : 0) +
    (assigneeFilter ? 1 : 0) +
    (sourceFilter ? 1 : 0) +
    (priorityFilter ? 1 : 0) +
    (focusFilter ? 1 : 0) +
    (urlTag ? 1 : 0)

  function resetFilters() {
    setSearch('')
    setStatusFilter('')
    setListFilter('')
    setAssigneeFilter('')
    setSourceFilter('')
    setPriorityFilter('')
    setFocusFilter('')
    const params = new URLSearchParams(searchParams.toString())
    params.delete('list')
    params.delete('tag')
    params.delete('id')
    const query = params.toString()
    router.replace(query ? `/contacts?${query}` : '/contacts', { scroll: false })
  }

  return (
    <div className="contacts-page">
      <div className="contacts-toolbar">
        <div className="contacts-search">
          <span className="contacts-search-icon">🔍</span>
          <input
            type="text"
            placeholder="Cerca nome, azienda, email…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <select
          className="filter-select"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
        >
          <option value="">Stato: tutti</option>
          {stages.map((stage) => (
            <option key={stage.id} value={stage.name}>
              {statusLabel(stage.name)}
            </option>
          ))}
        </select>
        <select
          className="filter-select"
          value={listFilter}
          onChange={(event) => setListFilter(event.target.value)}
        >
          <option value="">Lista: tutte</option>
          {lists.map((list) => (
            <option key={list} value={list}>
              📁 {list}
            </option>
          ))}
        </select>
        {assignees.length > 0 && (
          <select
            className="filter-select"
            value={assigneeFilter}
            onChange={(event) => setAssigneeFilter(event.target.value)}
          >
            <option value="">Assegnato: tutti</option>
            {assignees.map((assignee) => (
              <option key={assignee} value={assignee}>
                👤 {assignee}
              </option>
            ))}
            <option value="__unassigned__">— Non assegnato —</option>
          </select>
        )}
        <button
          type="button"
          className="filter-chip"
          onClick={() => setShowMore((value) => !value)}
        >
          Altri filtri {activeFilterCount > 1 && `(${activeFilterCount})`}
        </button>
        {activeFilterCount > 0 && (
          <button type="button" className="filter-chip" onClick={resetFilters}>
            Azzera
          </button>
        )}
        <button
          type="button"
          className="btn btn-primary btn-sm contacts-toolbar-cta"
          onClick={() => {
            setEditingContact(null)
            setModalOpen(true)
          }}
        >
          ＋ Nuovo contatto
        </button>
      </div>

      {showMore && (
        <div className="contacts-more-filters">
          <select
            className="filter-select"
            value={sourceFilter}
            onChange={(event) => setSourceFilter(event.target.value)}
          >
            <option value="">Origine: tutte</option>
            {sources.map((source) => (
              <option key={source} value={source}>
                {sourceLabel(source)}
              </option>
            ))}
          </select>
          <select
            className="filter-select"
            value={priorityFilter}
            onChange={(event) => setPriorityFilter(event.target.value)}
          >
            <option value="">Priorità: tutte</option>
            <option value="3">Alta</option>
            <option value="2">Media</option>
            <option value="1">Bassa</option>
            <option value="0">Nessuna</option>
          </select>
          {FOCUS_CHIPS.map((chip) => (
            <button
              key={chip.key}
              type="button"
              className={`filter-chip ${focusFilter === chip.key ? 'active' : ''}`}
              onClick={() => setFocusFilter((value) => (value === chip.key ? '' : chip.key))}
            >
              {chip.label}
            </button>
          ))}
        </div>
      )}

      <div className="contacts-summary">
        <span>
          <strong>{filtered.length}</strong> contatti
        </span>
        {listFilter && (
          <span className="contacts-summary-chip">
            📁 {listFilter}
            <button type="button" onClick={() => setListFilter('')} aria-label="Rimuovi lista">
              ×
            </button>
          </span>
        )}
        {urlTag && (
          <span className="contacts-summary-chip">
            #{urlTag}
            <button
              type="button"
              onClick={() => {
                const params = new URLSearchParams(searchParams.toString())
                params.delete('tag')
                const query = params.toString()
                router.replace(query ? `/contacts?${query}` : '/contacts', { scroll: false })
              }}
              aria-label="Rimuovi tag"
            >
              ×
            </button>
          </span>
        )}
      </div>

      <div className="contacts-table">
        {filtered.length === 0 ? (
          <div className="contacts-empty">
            {search || activeFilterCount > 0 ? (
              <>
                <p>Nessun contatto corrisponde ai filtri.</p>
                <button type="button" className="btn btn-ghost btn-sm" onClick={resetFilters}>
                  Azzera filtri
                </button>
              </>
            ) : (
              <>
                <p>Ancora nessun contatto.</p>
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
              </>
            )}
          </div>
        ) : (
          filtered.map((contact) => {
            const call = scheduledCallsByContactId.get(contact.id) || null
            const holdingTag = isHoldingContact(contact) ? holdingListLabel(contact) : null
            return (
              <button
                type="button"
                key={contact.id}
                className="contacts-row"
                onClick={() => openDrawer(contact.id)}
              >
                <div className="contacts-row-main">
                  <div className="contacts-row-name">
                    <strong>{contact.name}</strong>
                    {contact.company && <span className="contacts-row-company">· {contact.company}</span>}
                  </div>
                  <div className="contacts-row-meta">
                    {contact.email && <span>{contact.email}</span>}
                    {contact.phone && <span>{contact.phone}</span>}
                    {holdingTag && <span>📁 {holdingTag}</span>}
                    {contact.list_name && !holdingTag && <span>📁 {contact.list_name}</span>}
                    {contact.responsible && <span>👤 {contact.responsible}</span>}
                  </div>
                </div>
                <div className="contacts-row-side">
                  <span className="ctag ctag-contattato">{statusLabel(contact.status)}</span>
                  {contact.priority > 0 && (
                    <span className={`ctag ${priorityBadgeClass(contact.priority)}`}>
                      {priorityLabel(contact.priority)}
                    </span>
                  )}
                  <span className="contacts-row-followup">
                    {call ? formatDateTime(call.due_at) : isNeverContacted(contact) ? 'Mai contattato' : ''}
                  </span>
                </div>
              </button>
            )
          })
        )}
      </div>

      <ContactDrawer
        contactId={urlId}
        onClose={closeDrawer}
        onEdit={(id) => {
          const target = allContacts.find((contact) => contact.id === id) || null
          setEditingContact(target)
          setModalOpen(true)
        }}
      />

      <ContactModal
        open={modalOpen}
        title={editingContact ? 'Modifica contatto' : 'Nuovo contatto'}
        stages={stages}
        initialContact={editingContact}
        onClose={() => {
          setModalOpen(false)
          if (urlNew === '1') {
            const params = new URLSearchParams(searchParams.toString())
            params.delete('new')
            const query = params.toString()
            router.replace(query ? `/contacts?${query}` : '/contacts', { scroll: false })
          }
        }}
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
    </div>
  )
}

export default function ContactsPage() {
  return (
    <Suspense fallback={<div className="contacts-page"><div className="contacts-empty"><p>Caricamento…</p></div></div>}>
      <ContactsPageInner />
    </Suspense>
  )
}
