'use client'

import { apiFetch } from '@/lib/api'
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
import type { CRMContact, TaskWithContact } from '@/types'

function todayAt9am() {
  const d = new Date()
  d.setHours(9, 0, 0, 0)
  return d.toISOString()
}

const FOCUS_CHIPS: Array<{ key: string; label: string }> = [
  { key: 'new', label: 'Nuovi' },
  { key: 'today', label: 'Oggi' },
  { key: 'tomorrow', label: 'Domani' },
  { key: 'missing', label: 'Senza next step' },
]

type BulkUpdateDraft = {
  responsible: string
  status: string
  source: string
  priority: string
  list_name: string
  event_tag: string
  company: string
}

function ContactsPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const {
    contacts,
    scheduledCalls,
    stages,
    teamMembers,
    createContact,
    updateContact,
    deleteContact,
    addTask,
    updateTask,
    refresh,
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
  const [dataCompletenessFilter, setDataCompletenessFilter] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [bulkAssignee, setBulkAssignee] = useState('')
  const [bulkSaving, setBulkSaving] = useState(false)
  const [bulkEditOpen, setBulkEditOpen] = useState(false)
  const [bulkUpdate, setBulkUpdate] = useState<BulkUpdateDraft>({
    responsible: '',
    status: '',
    source: '',
    priority: '',
    list_name: '',
    event_tag: '',
    company: '',
  })

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
          contacts
            .map((contact) => contact.list_name?.trim())
            .filter((name): name is string => Boolean(name))
        )
      ).sort(),
    [contacts]
  )

  const sources = useMemo(
    () =>
      Array.from(
        new Set(contacts.map((contact) => contact.source).filter((source): source is string => Boolean(source)))
      ).sort(),
    [contacts]
  )

  const assignees = useMemo(
    () => teamMembers.map((member) => member.name).sort(),
    [teamMembers]
  )

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return contacts.filter((contact) => {
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
      if (dataCompletenessFilter === 'missing_phone' && contact.phone?.trim()) return false
      if (dataCompletenessFilter === 'missing_email' && contact.email?.trim()) return false
      if (focusFilter === 'new' && !isNeverContacted(contact)) return false
      if (focusFilter === 'today' && toLocalDateKey(call?.due_at) !== todayKey) return false
      if (focusFilter === 'tomorrow' && toLocalDateKey(call?.due_at) !== tomorrowKey) return false
      if (focusFilter === 'missing' && (isClosedStatus(contact.status) || !!call)) return false
      return true
    })
  }, [
    contacts,
    assigneeFilter,
    focusFilter,
    listFilter,
    priorityFilter,
    dataCompletenessFilter,
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
    (dataCompletenessFilter ? 1 : 0) +
    (focusFilter ? 1 : 0) +
    (urlTag ? 1 : 0)

  const filteredIds = useMemo(() => filtered.map((contact) => contact.id), [filtered])
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedIds.includes(id))
  const hasSelected = selectedIds.length > 0

  useEffect(() => {
    setSelectedIds((previous) => previous.filter((id) => filteredIds.includes(id)))
  }, [filteredIds])

  function resetFilters() {
    setSearch('')
    setStatusFilter('')
    setListFilter('')
    setAssigneeFilter('')
    setSourceFilter('')
    setPriorityFilter('')
    setDataCompletenessFilter('')
    setFocusFilter('')
    const params = new URLSearchParams(searchParams.toString())
    params.delete('list')
    params.delete('tag')
    params.delete('id')
    const query = params.toString()
    router.replace(query ? `/contacts?${query}` : '/contacts', { scroll: false })
  }

  function toggleSelection(contactId: string) {
    setSelectedIds((previous) =>
      previous.includes(contactId) ? previous.filter((id) => id !== contactId) : [...previous, contactId]
    )
  }

  function toggleSelectAllFiltered() {
    setSelectedIds((previous) => {
      if (allFilteredSelected) return previous.filter((id) => !filteredIds.includes(id))
      return Array.from(new Set([...previous, ...filteredIds]))
    })
  }

  async function runBulkUpdate(patch: Record<string, unknown>, successMessage: string) {
    if (!selectedIds.length) return
    setBulkSaving(true)
    try {
      await apiFetch('/api/contacts/bulk', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact_ids: selectedIds,
          patch,
        }),
      })
      await refresh()
      showToast(successMessage)
      setSelectedIds([])
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Aggiornamento massivo non riuscito')
    } finally {
      setBulkSaving(false)
    }
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
          <button
            type="button"
            className={`filter-chip ${dataCompletenessFilter === 'missing_phone' ? 'active' : ''}`}
            onClick={() =>
              setDataCompletenessFilter((value) => (value === 'missing_phone' ? '' : 'missing_phone'))
            }
          >
            Senza telefono
          </button>
          <button
            type="button"
            className={`filter-chip ${dataCompletenessFilter === 'missing_email' ? 'active' : ''}`}
            onClick={() =>
              setDataCompletenessFilter((value) => (value === 'missing_email' ? '' : 'missing_email'))
            }
          >
            Senza email
          </button>
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
        <label className="contacts-summary-selectall">
          <input
            type="checkbox"
            checked={allFilteredSelected}
            onChange={toggleSelectAllFiltered}
          />
          <span>Seleziona tutti i filtrati</span>
        </label>
        {hasSelected && <span className="contacts-summary-chip">{selectedIds.length} selezionati</span>}
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

      {hasSelected && (
        <div className="contacts-bulkbar">
          <div className="contacts-bulkbar-copy">
            <strong>{selectedIds.length} contatti selezionati</strong>
            <span>Puoi assegnarli o aggiornare i dati in blocco.</span>
          </div>
          <div className="contacts-bulkbar-actions">
            {assignees.length > 0 && (
              <>
                <select
                  className="filter-select"
                  value={bulkAssignee}
                  onChange={(event) => setBulkAssignee(event.target.value)}
                >
                  <option value="">Assegna a…</option>
                  {assignees.map((assignee) => (
                    <option key={assignee} value={assignee}>
                      {assignee}
                    </option>
                  ))}
                  <option value="__unassigned__">— Rimuovi assegnazione —</option>
                </select>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={bulkSaving || !bulkAssignee}
                  onClick={async () => {
                    await runBulkUpdate(
                      { responsible: bulkAssignee === '__unassigned__' ? '' : bulkAssignee },
                      'Assegnazione aggiornata'
                    )
                    setBulkAssignee('')
                  }}
                >
                  {bulkSaving ? 'Salvataggio…' : 'Assegna'}
                </button>
              </>
            )}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setBulkEditOpen((value) => !value)}
            >
              {bulkEditOpen ? 'Chiudi update dati' : 'Update dati'}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setSelectedIds([])}
            >
              Deseleziona
            </button>
          </div>
        </div>
      )}

      {hasSelected && bulkEditOpen && (
        <div className="contacts-bulkpanel">
          <div className="contacts-bulkpanel-title">Aggiornamento massivo dati</div>
          <div className="contacts-bulkpanel-copy">
            Compila solo i campi che vuoi aggiornare sui contatti selezionati.
          </div>
          <div className="contacts-bulkpanel-grid">
            <select
              className="filter-select"
              value={bulkUpdate.status}
              onChange={(event) => setBulkUpdate((previous) => ({ ...previous, status: event.target.value }))}
            >
              <option value="">Stato: non cambiare</option>
              {stages.map((stage) => (
                <option key={stage.id} value={stage.name}>
                  {statusLabel(stage.name)}
                </option>
              ))}
            </select>
            <select
              className="filter-select"
              value={bulkUpdate.priority}
              onChange={(event) => setBulkUpdate((previous) => ({ ...previous, priority: event.target.value }))}
            >
              <option value="">Priorità: non cambiare</option>
              <option value="3">Alta</option>
              <option value="2">Media</option>
              <option value="1">Bassa</option>
              <option value="0">Nessuna</option>
            </select>
            <select
              className="filter-select"
              value={bulkUpdate.responsible}
              onChange={(event) => setBulkUpdate((previous) => ({ ...previous, responsible: event.target.value }))}
            >
              <option value="">Assegnato: non cambiare</option>
              {assignees.map((assignee) => (
                <option key={assignee} value={assignee}>
                  {assignee}
                </option>
              ))}
              <option value="__unassigned__">— Rimuovi assegnazione —</option>
            </select>
            <input
              className="form-input"
              placeholder="Origine"
              value={bulkUpdate.source}
              onChange={(event) => setBulkUpdate((previous) => ({ ...previous, source: event.target.value }))}
            />
            <input
              className="form-input"
              placeholder="Lista"
              value={bulkUpdate.list_name}
              onChange={(event) => setBulkUpdate((previous) => ({ ...previous, list_name: event.target.value }))}
            />
            <input
              className="form-input"
              placeholder="Tag evento"
              value={bulkUpdate.event_tag}
              onChange={(event) => setBulkUpdate((previous) => ({ ...previous, event_tag: event.target.value }))}
            />
            <input
              className="form-input"
              placeholder="Azienda"
              value={bulkUpdate.company}
              onChange={(event) => setBulkUpdate((previous) => ({ ...previous, company: event.target.value }))}
            />
          </div>
          <div className="contacts-bulkpanel-actions">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={bulkSaving}
              onClick={async () => {
                const patch: Record<string, unknown> = {}
                if (bulkUpdate.status) patch.status = bulkUpdate.status
                if (bulkUpdate.priority) patch.priority = Number(bulkUpdate.priority)
                if (bulkUpdate.responsible) patch.responsible = bulkUpdate.responsible === '__unassigned__' ? '' : bulkUpdate.responsible
                if (bulkUpdate.source.trim()) patch.source = bulkUpdate.source
                if (bulkUpdate.list_name.trim()) patch.list_name = bulkUpdate.list_name
                if (bulkUpdate.event_tag.trim()) patch.event_tag = bulkUpdate.event_tag
                if (bulkUpdate.company.trim()) patch.company = bulkUpdate.company

                if (!Object.keys(patch).length) {
                  window.alert('Compila almeno un campo da aggiornare')
                  return
                }

                await runBulkUpdate(patch, 'Contatti aggiornati')
                setBulkUpdate({
                  responsible: '',
                  status: '',
                  source: '',
                  priority: '',
                  list_name: '',
                  event_tag: '',
                  company: '',
                })
                setBulkEditOpen(false)
              }}
            >
              {bulkSaving ? 'Aggiornamento…' : 'Salva update dati'}
            </button>
          </div>
        </div>
      )}

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
            const isToday = toLocalDateKey(call?.due_at) === todayKey
            const isClosed = isClosedStatus(contact.status)
            return (
              <div
                key={contact.id}
                className="contacts-row"
                onClick={() => openDrawer(contact.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') openDrawer(contact.id) }}
              >
                <label
                  className="contacts-row-check"
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(contact.id)}
                    onChange={() => toggleSelection(contact.id)}
                  />
                </label>
                <div className="contacts-row-main">
                  <div className="contacts-row-name">
                    <strong>{contact.name}</strong>
                    {contact.company && <span className="contacts-row-company">· {contact.company}</span>}
                  </div>
                  <div className="contacts-row-meta">
                    {contact.email ? <span>{contact.email}</span> : <span className="contacts-missing">Senza email</span>}
                    {contact.phone ? <span>{contact.phone}</span> : <span className="contacts-missing">Senza telefono</span>}
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
                  {!isClosed && (
                    isToday ? (
                      <span className="btn btn-ghost btn-xs contacts-row-action" style={{ opacity: 0.45, pointerEvents: 'none' }}>
                        ✓ Oggi
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs contacts-row-action"
                        title="Sposta il follow-up ad oggi"
                        onClick={async (e) => {
                          e.stopPropagation()
                          const due = todayAt9am()
                          const existingTask = call?.task as TaskWithContact | null
                          if (existingTask) {
                            await updateTask(existingTask.id, { due_date: due })
                          } else {
                            await addTask(contact.id, { type: 'follow-up', due_date: due })
                          }
                          showToast(`${contact.name} → ricontatto aggiunto per oggi`)
                        }}
                      >
                        📞 Oggi
                      </button>
                    )
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>

      <ContactDrawer
        contactId={urlId}
        onClose={closeDrawer}
        onEdit={(id) => {
          const target = contacts.find((contact) => contact.id === id) || null
          setEditingContact(target)
          setModalOpen(true)
        }}
      />

      <ContactModal
        open={modalOpen}
        title={editingContact ? 'Modifica contatto' : 'Nuovo contatto'}
        stages={stages}
        teamMembers={teamMembers}
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
