'use client'

import { apiFetch } from '@/lib/api'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { MouseEvent, Suspense, useEffect, useMemo, useState } from 'react'
import { ContactDrawer } from '@/components/crm/ContactDrawer'
import { ContactModal } from '@/components/crm/ContactModal'
import {
  contactIsUnassigned,
  contactMatchesAssigneeName,
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

const FOLLOWUP_MONTH_OPTIONS = [
  { value: '1', label: 'Tra 1 mese' },
  { value: '2', label: 'Tra 2 mesi' },
  { value: '3', label: 'Tra 3 mesi' },
]

function monthOffsetAt9am(months: number) {
  const target = new Date()
  target.setMonth(target.getMonth() + months)
  target.setHours(9, 0, 0, 0)
  return target.toISOString()
}

type BulkUpdateDraft = {
  responsible: string
  status: string
  source: string
  priority: string
  list_name: string
  event_tag: string
  company: string
  next_followup_months: string
}

function ContactsPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const {
    contacts,
    scheduledCalls,
    stages,
    holdingContacts,
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
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null)
  const [rangeStart, setRangeStart] = useState('')
  const [rangeEnd, setRangeEnd] = useState('')
  const [bulkAssignee, setBulkAssignee] = useState('')
  const [bulkStatusQuick, setBulkStatusQuick] = useState('')
  const [bulkFollowupMonths, setBulkFollowupMonths] = useState('')
  const [bulkFolderName, setBulkFolderName] = useState('')
  const [bulkSaving, setBulkSaving] = useState(false)
  const [bulkDraftNote, setBulkDraftNote] = useState('')
  const [bulkDraftGenerating, setBulkDraftGenerating] = useState(false)
  const [bulkEditOpen, setBulkEditOpen] = useState(false)
  const [repairingNames, setRepairingNames] = useState(false)
  const [bulkUpdate, setBulkUpdate] = useState<BulkUpdateDraft>({
    responsible: '',
    status: '',
    source: '',
    priority: '',
    list_name: '',
    event_tag: '',
    company: '',
    next_followup_months: '',
  })

  const [modalOpen, setModalOpen] = useState(urlNew === '1')
  const [editingContact, setEditingContact] = useState<CRMContact | null>(null)
  const [drawerAnchor, setDrawerAnchor] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    setListFilter(urlList)
  }, [urlList])

  useEffect(() => {
    if (urlNew === '1') {
      setEditingContact(null)
      setModalOpen(true)
    }
  }, [urlNew])

  useEffect(() => {
    if (!urlId) setDrawerAnchor(null)
  }, [urlId])

  function openDrawer(id: string, anchor?: { x: number; y: number } | null) {
    setDrawerAnchor(anchor || null)
    const params = new URLSearchParams(searchParams.toString())
    params.set('id', id)
    router.replace(`/contacts?${params.toString()}`, { scroll: false })
  }

  function closeDrawer() {
    setDrawerAnchor(null)
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

  const folderOptions = useMemo(
    () => Array.from(new Set(holdingContacts.map((contact) => holdingListLabel(contact)).filter(Boolean))).sort(),
    [holdingContacts]
  )

  const folderSummary = useMemo(() => {
    const grouped = new Map<string, number>()
    holdingContacts.forEach((contact) => {
      const folderName = holdingListLabel(contact)
      grouped.set(folderName, (grouped.get(folderName) || 0) + 1)
    })
    return Array.from(grouped.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
  }, [holdingContacts])

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
          if (!contactIsUnassigned(contact)) return false
        } else if (!contactMatchesAssigneeName(contact, assigneeFilter)) {
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
  const selectedContacts = useMemo(
    () => contacts.filter((contact) => selectedIds.includes(contact.id)),
    [contacts, selectedIds]
  )
  const selectedWithEmailCount = selectedContacts.filter((contact) => Boolean(contact.email?.trim())).length
  const canRemoveSelectedFromList = selectedContacts.some((contact) => Boolean(contact.list_name?.trim()))

  useEffect(() => {
    setSelectedIds((previous) => previous.filter((id) => filteredIds.includes(id)))
  }, [filteredIds])

  useEffect(() => {
    if (lastSelectedId && !filteredIds.includes(lastSelectedId)) {
      setLastSelectedId(null)
    }
  }, [filteredIds, lastSelectedId])

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

  function toggleSelection(contactId: string, shiftKey = false) {
    setSelectedIds((previous) => {
      const shouldSelect = !previous.includes(contactId)

      if (shiftKey && lastSelectedId && lastSelectedId !== contactId) {
        const startIndex = filteredIds.indexOf(lastSelectedId)
        const endIndex = filteredIds.indexOf(contactId)

        if (startIndex !== -1 && endIndex !== -1) {
          const [from, to] = startIndex < endIndex ? [startIndex, endIndex] : [endIndex, startIndex]
          const rangeIds = filteredIds.slice(from, to + 1)

          if (shouldSelect) {
            return Array.from(new Set([...previous, ...rangeIds]))
          }

          return previous.filter((id) => !rangeIds.includes(id))
        }
      }

      return shouldSelect
        ? [...previous, contactId]
        : previous.filter((id) => id !== contactId)
    })
    setLastSelectedId(contactId)
  }

  function toggleSelectAllFiltered() {
    setSelectedIds((previous) => {
      if (allFilteredSelected) return previous.filter((id) => !filteredIds.includes(id))
      return Array.from(new Set([...previous, ...filteredIds]))
    })
    setLastSelectedId(filteredIds[0] || null)
  }

  function handleCheckboxClick(contactId: string, event: MouseEvent<HTMLInputElement>) {
    event.stopPropagation()
    toggleSelection(contactId, event.shiftKey)
  }

  function applyRangeSelection() {
    const start = Number(rangeStart)
    const end = Number(rangeEnd)

    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < 1) {
      window.alert('Inserisci due numeri validi (es. 1 e 10)')
      return
    }
    if (!filteredIds.length) return

    const from = Math.max(1, Math.min(start, end))
    const to = Math.min(filteredIds.length, Math.max(start, end))
    const rangeIds = filteredIds.slice(from - 1, to)
    if (!rangeIds.length) {
      window.alert('Intervallo fuori dalla lista filtrata')
      return
    }

    setSelectedIds(rangeIds)
    setLastSelectedId(rangeIds[rangeIds.length - 1] || null)
    showToast(`Selezionati contatti da ${from} a ${to}`)
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

  async function generateBulkDrafts() {
    const draftsPayload = selectedContacts
      .filter((contact) => contact.email?.trim())
      .map((contact) => ({
        contact_id: contact.id,
        note: contact.email_draft_note || undefined,
      }))

    if (!draftsPayload.length) {
      showToast('Nessun contatto selezionato con email')
      return
    }

    setBulkDraftGenerating(true)
    try {
      const result = await apiFetch<{ created: number; failed: number }>('/api/ai/generate-drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          drafts: draftsPayload,
          common_note: bulkDraftNote || undefined,
        }),
      })
      showToast(`${result.created} bozze create in Gmail${result.failed ? ` · ${result.failed} fallite` : ''}`)
      if (result.created > 0) setBulkDraftNote('')
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Generazione bozze non riuscita')
    } finally {
      setBulkDraftGenerating(false)
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
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={repairingNames}
          onClick={async () => {
            if (!window.confirm('Correggo i nomi generici derivati da email tipo info@dominio?')) return
            setRepairingNames(true)
            try {
              const result = await apiFetch<{ updated: number }>('/api/contacts/repair-names', {
                method: 'POST',
              })
              await refresh()
              showToast(
                result.updated > 0
                  ? `${result.updated} nomi corretti da email`
                  : 'Nessun nome da correggere'
              )
            } catch (error) {
              window.alert(error instanceof Error ? error.message : 'Riparazione nomi non riuscita')
            } finally {
              setRepairingNames(false)
            }
          }}
        >
          {repairingNames ? 'Correzione…' : 'Correggi nomi email'}
        </button>
        <select
          className="filter-select"
          value={assigneeFilter}
          onChange={(event) => setAssigneeFilter(event.target.value)}
          aria-label="Filtra per assegnatario"
        >
          <option value="">Assegnato: tutti</option>
          {assignees.map((assignee) => (
            <option key={assignee} value={assignee}>
              👤 {assignee}
            </option>
          ))}
          <option value="__unassigned__">— Non assegnato a nessuno —</option>
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

      {folderSummary.length > 0 && (
        <div className="contacts-folders">
          <div className="contacts-folders-head">
            <strong>📁 Cartelle</strong>
            <span>I contatti dentro una cartella non compaiono nella lista Contatti.</span>
          </div>
          <div className="contacts-folders-list">
            {folderSummary.map((folder) => (
              <Link
                key={folder.name}
                href={`/vinitaly?list=${encodeURIComponent(folder.name)}`}
                className="contacts-folder-chip"
              >
                <span>{folder.name}</span>
                <strong>{folder.count}</strong>
              </Link>
            ))}
          </div>
        </div>
      )}

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
        <div className="contacts-summary-range">
          <span>Intervallo</span>
          <input
            type="number"
            min={1}
            className="contacts-range-input"
            value={rangeStart}
            onChange={(event) => setRangeStart(event.target.value)}
            placeholder="Da"
          />
          <input
            type="number"
            min={1}
            className="contacts-range-input"
            value={rangeEnd}
            onChange={(event) => setRangeEnd(event.target.value)}
            placeholder="A"
          />
          <button type="button" className="btn btn-ghost btn-xs" onClick={applyRangeSelection}>
            Seleziona
          </button>
        </div>
        <span className="contacts-summary-chip">Shift+click: selezione da primo a ultimo</span>
        {hasSelected && <span className="contacts-summary-chip">{selectedIds.length} selezionati</span>}
        {listFilter && (
          <span className="contacts-summary-chip">
            📁 {listFilter}
            <button type="button" onClick={() => setListFilter('')} aria-label="Rimuovi lista">
              ×
            </button>
          </span>
        )}
        {dataCompletenessFilter === 'missing_phone' && (
          <span className="contacts-summary-chip">
            📞 Senza telefono
            <button type="button" onClick={() => setDataCompletenessFilter('')} aria-label="Rimuovi filtro telefono">
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
            <span>Puoi assegnarli, aggiornare i dati o creare bozze Gmail in blocco.</span>
          </div>
          <div className="contacts-bulkbar-actions">
            <input
              className="form-input contacts-bulk-draft-note"
              value={bulkDraftNote}
              onChange={(event) => setBulkDraftNote(event.target.value)}
              placeholder="Contesto comune bozze Gmail"
            />
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={bulkDraftGenerating || selectedWithEmailCount === 0}
              onClick={generateBulkDrafts}
            >
              {bulkDraftGenerating ? 'Generazione…' : `Bozze Gmail (${selectedWithEmailCount})`}
            </button>
            {canRemoveSelectedFromList && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={bulkSaving}
                onClick={async () => {
                  await runBulkUpdate(
                    { list_name: '' },
                    listFilter
                      ? `Lista "${listFilter}" rimossa dai contatti selezionati`
                      : 'Lista rimossa dai contatti selezionati'
                  )
                }}
              >
                Togli da lista
              </button>
            )}
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
            <select
              className="filter-select"
              value={bulkStatusQuick}
              onChange={(event) => setBulkStatusQuick(event.target.value)}
            >
              <option value="">Sposta pipeline…</option>
              {stages.map((stage) => (
                <option key={`quick-stage-${stage.id}`} value={stage.name}>
                  {statusLabel(stage.name)}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={bulkSaving || !bulkStatusQuick}
              onClick={async () => {
                await runBulkUpdate({ status: bulkStatusQuick }, 'Stato pipeline aggiornato')
                setBulkStatusQuick('')
              }}
            >
              Sposta
            </button>
            <select
              className="filter-select"
              value={bulkFollowupMonths}
              onChange={(event) => setBulkFollowupMonths(event.target.value)}
            >
              <option value="">Ricontatta…</option>
              {FOLLOWUP_MONTH_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={bulkSaving || !bulkFollowupMonths}
              onClick={async () => {
                const months = Number(bulkFollowupMonths)
                await runBulkUpdate(
                  { next_followup_at: monthOffsetAt9am(months) },
                  `Ricontatto pianificato ${months === 1 ? 'tra 1 mese' : `tra ${months} mesi`}`
                )
                setBulkFollowupMonths('')
              }}
            >
              Pianifica
            </button>
            <input
              className="form-input contacts-folder-input"
              list="folder-options"
              value={bulkFolderName}
              onChange={(event) => setBulkFolderName(event.target.value)}
              placeholder="Sposta in cartella..."
            />
            <datalist id="folder-options">
              {folderOptions.map((folderName) => (
                <option key={folderName} value={folderName} />
              ))}
            </datalist>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={bulkSaving || !bulkFolderName.trim()}
              onClick={async () => {
                const folderName = bulkFolderName.trim()
                await runBulkUpdate(
                  { contact_scope: 'holding', list_name: folderName },
                  `Spostati in cartella "${folderName}"`
                )
                setBulkFolderName('')
              }}
            >
              Sposta in cartella
            </button>
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
            <select
              className="filter-select"
              value={bulkUpdate.next_followup_months}
              onChange={(event) =>
                setBulkUpdate((previous) => ({ ...previous, next_followup_months: event.target.value }))
              }
            >
              <option value="">Ricontatto: non cambiare</option>
              {FOLLOWUP_MONTH_OPTIONS.map((option) => (
                <option key={`bulk-${option.value}`} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
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
                if (bulkUpdate.next_followup_months) {
                  patch.next_followup_at = monthOffsetAt9am(Number(bulkUpdate.next_followup_months))
                }

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
                  next_followup_months: '',
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
                onClick={(e) => openDrawer(contact.id, { x: e.clientX, y: e.clientY })}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') openDrawer(contact.id, null) }}
              >
                <label
                  className="contacts-row-check"
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(contact.id)}
                    onClick={(event) => handleCheckboxClick(contact.id, event)}
                    onChange={() => {}}
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
                    {(contact.email_open_count || contact.email_click_count) ? (
                      <span>
                        Engagement: {contact.email_open_count || 0} aperture · {contact.email_click_count || 0} click
                      </span>
                    ) : null}
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
        anchorPoint={drawerAnchor}
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
