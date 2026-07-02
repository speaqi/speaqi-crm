'use client'

import { apiFetch } from '@/lib/api'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { MouseEvent, Suspense, useEffect, useMemo, useState } from 'react'
import { ContactDrawer } from '@/components/crm/ContactDrawer'
import { ContactModal } from '@/components/crm/ContactModal'
import { QuickDismissMenu } from '@/components/crm/QuickDismissMenu'
import {
  contactIsUnassigned,
  contactMatchesAssigneeName,
  formatDateTime,
  holdingListLabel,
  isClosedStatus,
  isHoldingContact,
  isPartnerContact,
  isNeverContacted,
  personalSectionLabel,
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

type ScopeTab = 'crm' | 'holding' | 'inbound' | 'personal' | 'partner' | 'all'

const SCOPE_TABS: Array<{ key: ScopeTab; label: string }> = [
  { key: 'crm', label: 'CRM' },
  { key: 'holding', label: 'Liste separate' },
  { key: 'inbound', label: 'Inbound' },
  { key: 'personal', label: 'Personali' },
  { key: 'partner', label: 'Partner' },
  { key: 'all', label: 'Tutti' },
]

function parseScopeTab(value?: string | null): ScopeTab {
  switch ((value || '').toLowerCase()) {
    case 'holding':
      return 'holding'
    case 'inbound':
      return 'inbound'
    case 'personal':
      return 'personal'
    case 'partner':
      return 'partner'
    case 'all':
      return 'all'
    default:
      return 'crm'
  }
}

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
    allContacts,
    contacts,
    scheduledCalls,
    stages,
    holdingContacts,
    personalContacts,
    partnerContacts,
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
  const [showHidden, setShowHidden] = useState(false)
  const [scope, setScope] = useState<ScopeTab>(() => parseScopeTab(searchParams.get('scope')))
  const [sectionFilter, setSectionFilter] = useState('')
  const [bulkHoldingStatus, setBulkHoldingStatus] = useState('')
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

  const showAllContactsSearch = scope === 'all'

  useEffect(() => {
    setListFilter(urlList)
  }, [urlList])

  useEffect(() => {
    setScope(parseScopeTab(searchParams.get('scope')))
  }, [searchParams])

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

  function selectScope(next: ScopeTab) {
    setScope(next)
    setSelectedIds([])
    if (next !== 'personal') setSectionFilter('')
    if (next !== 'holding') setListFilter('')
    const params = new URLSearchParams(searchParams.toString())
    if (next === 'crm') params.delete('scope')
    else params.set('scope', next)
    params.delete('id')
    if (next !== 'holding') params.delete('list')
    const query = params.toString()
    router.replace(query ? `/contacts?${query}` : '/contacts', { scroll: false })
  }

  async function handleDismiss(contactId: string, status: string, nextFollowupAt: string | null) {
    try {
      await updateContact(contactId, {
        status,
        next_followup_at: nextFollowupAt,
      })
      const label = status === 'Lost' ? 'Perso' : 'In attesa'
      showToast(`${label} ✓`)
    } catch (error) {
      showToast(`Errore: ${error instanceof Error ? error.message : 'operazione'}`)
    }
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

  const searchableContacts = useMemo(() => {
    switch (scope) {
      case 'holding':
        return holdingContacts
      case 'inbound':
        return contacts.filter((contact) => contact.source === 'speaqi')
      case 'personal':
        return personalContacts
      case 'partner':
        return partnerContacts
      case 'all':
        return allContacts.filter((contact) => (contact.contact_scope || 'crm') !== 'personal')
      case 'crm':
      default:
        return contacts
    }
  }, [scope, holdingContacts, contacts, personalContacts, partnerContacts, allContacts])

  const contactSearchStats = useMemo(() => {
    const scopeOf = (contact: CRMContact) => contact.contact_scope || 'crm'
    return {
      all: allContacts.filter((contact) => scopeOf(contact) !== 'personal').length,
      crm: allContacts.filter((contact) => scopeOf(contact) === 'crm').length,
      holding: allContacts.filter((contact) => scopeOf(contact) === 'holding').length,
      inbound: allContacts.filter(
        (contact) => scopeOf(contact) === 'crm' && contact.source === 'speaqi'
      ).length,
      personal: allContacts.filter((contact) => scopeOf(contact) === 'personal').length,
      partner: allContacts.filter((contact) => scopeOf(contact) === 'partner').length,
    }
  }, [allContacts])

  const scopeCount = (key: ScopeTab) => {
    switch (key) {
      case 'all':
        return contactSearchStats.all
      case 'holding':
        return contactSearchStats.holding
      case 'inbound':
        return contactSearchStats.inbound
      case 'personal':
        return contactSearchStats.personal
      case 'partner':
        return contactSearchStats.partner
      default:
        return contactSearchStats.crm
    }
  }

  const lists = useMemo(
    () =>
      Array.from(
        new Set(
          searchableContacts
            .map((contact) => contact.list_name?.trim())
            .filter((name): name is string => Boolean(name))
        )
      ).sort(),
    [searchableContacts]
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
        new Set(searchableContacts.map((contact) => contact.source).filter((source): source is string => Boolean(source)))
      ).sort(),
    [searchableContacts]
  )

  const sectionOptions = useMemo(
    () =>
      Array.from(new Set(personalContacts.map((contact) => personalSectionLabel(contact)).filter(Boolean))).sort(),
    [personalContacts]
  )

  const assignees = useMemo(
    () => teamMembers.map((member) => member.name).sort(),
    [teamMembers]
  )

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return searchableContacts.filter((contact) => {
          const call = scheduledCallsByContactId.get(contact.id) || null
          if (query) {
            const haystack = [
              contact.name,
              contact.company,
              contact.billing_tax_id,
              contact.billing_pec,
              contact.billing_sdi,
              contact.billing_address,
              contact.billing_zip,
              contact.billing_city,
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
      if (scope === 'personal' && sectionFilter && personalSectionLabel(contact) !== sectionFilter) return false
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
      if (!showAllContactsSearch && !showHidden && contact.hidden) return false
      return true
    })
  }, [
    assigneeFilter,
    focusFilter,
    listFilter,
    priorityFilter,
    dataCompletenessFilter,
    scheduledCallsByContactId,
    search,
    sourceFilter,
    statusFilter,
    searchableContacts,
    scope,
    sectionFilter,
    todayKey,
    tomorrowKey,
    urlTag,
    showAllContactsSearch,
    showHidden,
  ])

  const activeFilterCount =
    (listFilter ? 1 : 0) +
    (statusFilter ? 1 : 0) +
    (assigneeFilter ? 1 : 0) +
    (sourceFilter ? 1 : 0) +
    (priorityFilter ? 1 : 0) +
    (dataCompletenessFilter ? 1 : 0) +
    (focusFilter ? 1 : 0) +
    (showHidden && !showAllContactsSearch ? 1 : 0) +
    (urlTag ? 1 : 0)

  const filteredIds = useMemo(() => filtered.map((contact) => contact.id), [filtered])
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedIds.includes(id))
  const hasSelected = selectedIds.length > 0
  const selectedContacts = useMemo(
    () => searchableContacts.filter((contact) => selectedIds.includes(contact.id)),
    [searchableContacts, selectedIds]
  )
  const selectedWithEmailCount = selectedContacts.filter((contact) => Boolean(contact.email?.trim())).length
  const canRemoveSelectedFromList = selectedContacts.some((contact) => Boolean(contact.list_name?.trim()))
  const canShowSelectedInPipeline = selectedContacts.some((contact) => Boolean(contact.hidden))

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
    setSectionFilter('')
    setShowHidden(false)
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
      <div className="contacts-command">
        <div className="contacts-command-main">
          <div className="contacts-view-switch" aria-label="Ambito contatti">
            {SCOPE_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                className={scope === tab.key ? 'active' : ''}
                onClick={() => {
                  if (tab.key === 'all') setShowHidden(false)
                  selectScope(tab.key)
                }}
              >
                {tab.label}
                <span className="contacts-view-count">{scopeCount(tab.key)}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="contacts-command-searchrow">
          <div className="contacts-search contacts-search-large">
            <svg
              className="contacts-search-icon"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <line x1="21" y1="21" x2="16.2" y2="16.2" />
            </svg>
            <input
              type="text"
              placeholder={
                showAllContactsSearch
                  ? 'Cerca ovunque: CRM, cartelle, partner, nascosti...'
                  : 'Cerca nella pipeline CRM: nome, azienda, email...'
              }
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <button
            type="button"
            className="btn btn-primary btn-sm contacts-toolbar-cta"
            onClick={() => {
              setEditingContact(null)
              setModalOpen(true)
            }}
          >
            + Nuovo contatto
          </button>
        </div>

        <div className="contacts-toolbar">
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
                {list}
              </option>
            ))}
          </select>
          {scope === 'personal' && sectionOptions.length > 0 && (
            <select
              className="filter-select"
              value={sectionFilter}
              onChange={(event) => setSectionFilter(event.target.value)}
              aria-label="Filtra per sezione"
            >
              <option value="">Sezione: tutte</option>
              {sectionOptions.map((section) => (
                <option key={section} value={section}>
                  {section}
                </option>
              ))}
            </select>
          )}
          <select
            className="filter-select"
            value={assigneeFilter}
            onChange={(event) => setAssigneeFilter(event.target.value)}
            aria-label="Filtra per assegnatario"
          >
            <option value="">Assegnato: tutti</option>
            {assignees.map((assignee) => (
              <option key={assignee} value={assignee}>
                {assignee}
              </option>
            ))}
            <option value="__unassigned__">— Non assegnato a nessuno —</option>
          </select>
          <button
            type="button"
            className={`filter-chip ${showHidden ? 'active' : ''}`}
            onClick={() => setShowHidden((v) => !v)}
            disabled={showAllContactsSearch}
          >
            {showAllContactsSearch ? 'Nascosti inclusi' : 'Nascosti'}
          </button>
          <button
            type="button"
            className={`filter-chip ${showMore ? 'active' : ''}`}
            onClick={() => setShowMore((value) => !value)}
          >
            Altri filtri {activeFilterCount > 1 && `(${activeFilterCount})`}
          </button>
          {activeFilterCount > 0 && (
            <button type="button" className="filter-chip" onClick={resetFilters}>
              Azzera
            </button>
          )}
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
            <button
              type="button"
              className="btn btn-ghost btn-sm contacts-repair-btn"
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
          </div>
        )}

        {scope !== 'holding' && folderSummary.length > 0 && (
          <div className="contacts-folders">
            <span
              className="contacts-folders-label"
              title="Apri una cartella nella vista Liste separate. Restano fuori dalla pipeline CRM."
            >
              Cartelle
            </span>
            {folderSummary.map((folder) => (
              <Link
                key={folder.name}
                href={`/contacts?scope=holding&list=${encodeURIComponent(folder.name)}`}
                className="contacts-folder-chip"
              >
                <span>{folder.name}</span>
                <strong>{folder.count}</strong>
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="contacts-summary">
        <span>
          <strong>{filtered.length}</strong> contatti
          {showAllContactsSearch ? ' in tutti gli archivi' : ' in pipeline'}
        </span>
        {showAllContactsSearch && (
          <span className="contacts-summary-chip contacts-summary-chip-strong">
            Tutti i contatti
            <button
              type="button"
              onClick={() => selectScope('crm')}
              aria-label="Torna alla pipeline CRM"
            >
              ×
            </button>
          </span>
        )}
        <label
          className="contacts-summary-selectall"
          title="Shift+click su una riga: selezione dal primo all'ultimo"
        >
          <input
            type="checkbox"
            checked={allFilteredSelected}
            onChange={toggleSelectAllFiltered}
          />
          <span>Seleziona tutti</span>
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
        {listFilter && (
          <span className="contacts-summary-chip">
            {listFilter}
            <button type="button" onClick={() => setListFilter('')} aria-label="Rimuovi lista">
              ×
            </button>
          </span>
        )}
        {dataCompletenessFilter === 'missing_phone' && (
          <span className="contacts-summary-chip">
            Senza telefono
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
          <div className="contacts-bulkbar-head">
            <strong>{selectedIds.length} selezionati</strong>
            <button
              type="button"
              className="contacts-bulkbar-clear"
              onClick={() => setSelectedIds([])}
            >
              Deseleziona
            </button>
          </div>
          <div className="contacts-bulkbar-actions">
            {scope === 'holding' && (
              <div className="contacts-bulk-group">
                <select
                  className="filter-select"
                  value={bulkHoldingStatus}
                  onChange={(event) => setBulkHoldingStatus(event.target.value)}
                >
                  <option value="">Manda in CRM con stato…</option>
                  {stages.map((stage) => (
                    <option key={`holding-stage-${stage.id}`} value={stage.name}>
                      {statusLabel(stage.name)}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={bulkSaving || !bulkHoldingStatus}
                  onClick={async () => {
                    await runBulkUpdate(
                      { contact_scope: 'crm', status: bulkHoldingStatus },
                      'Contatti spostati nel CRM'
                    )
                    setBulkHoldingStatus('')
                  }}
                >
                  Manda in CRM
                </button>
              </div>
            )}
            {assignees.length > 0 && (
              <div className="contacts-bulk-group">
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
              </div>
            )}
            <div className="contacts-bulk-group">
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
            </div>
            <div className="contacts-bulk-group">
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
            </div>
            <div className="contacts-bulk-group">
              <input
                className="form-input contacts-folder-input"
                list="folder-options"
                value={bulkFolderName}
                onChange={(event) => setBulkFolderName(event.target.value)}
                placeholder="Sposta in cartella…"
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
                Sposta
              </button>
            </div>
            <div className="contacts-bulk-group">
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
            </div>
            <div className="contacts-bulk-group">
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
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={bulkSaving}
                onClick={async () => {
                  if (!window.confirm(`Nascondere ${selectedIds.length} contatti dalla pipeline? Resteranno visibili con il toggle "Nascosti".`)) return
                  await runBulkUpdate(
                    { hidden: true },
                    'Contatti nascosti dalla pipeline'
                  )
                }}
              >
                Nascondi
              </button>
              {canShowSelectedInPipeline && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={bulkSaving}
                  onClick={async () => {
                    if (!window.confirm(`Riportare ${selectedIds.length} contatti nella pipeline?`)) return
                    await runBulkUpdate(
                      { hidden: false },
                      'Contatti riportati in pipeline'
                    )
                  }}
                >
                  In pipeline
                </button>
              )}
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setBulkEditOpen((value) => !value)}
              >
                {bulkEditOpen ? 'Chiudi update dati' : 'Update dati'}
              </button>
            </div>
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
            {search || activeFilterCount > 0 || showAllContactsSearch ? (
              <>
                <p>Nessun contatto corrisponde alla ricerca o ai filtri.</p>
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
            const billingLocation = [
              contact.billing_address,
              [contact.billing_zip, contact.billing_city].filter(Boolean).join(' '),
            ]
              .filter(Boolean)
              .join(', ')
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
                    {contact.hidden && (
                      <span className="contacts-hidden-tag" title="Nascosto dalla pipeline">
                        Nascosto
                      </span>
                    )}
                  </div>
                  <div className="contacts-row-meta">
                    {contact.email ? <span>{contact.email}</span> : <span className="contacts-missing">Senza email</span>}
                    {contact.phone ? <span>{contact.phone}</span> : <span className="contacts-missing">Senza telefono</span>}
                    {billingLocation && (
                      <span className="contacts-row-billing" title="Indirizzo sede">
                        Sede: {billingLocation}
                      </span>
                    )}
                    {contact.billing_tax_id && (
                      <span className="contacts-row-billing" title="Partita IVA / Codice fiscale">
                        P.IVA/CF: {contact.billing_tax_id}
                      </span>
                    )}
                    {contact.billing_pec && (
                      <span className="contacts-row-billing" title="PEC">
                        PEC: {contact.billing_pec}
                      </span>
                    )}
                    {contact.billing_sdi && (
                      <span className="contacts-row-billing" title="Codice SDI">
                        SDI: {contact.billing_sdi}
                      </span>
                    )}
                    {holdingTag && <span className="contacts-meta-tag" title="Cartella">{holdingTag}</span>}
                    {contact.list_name && !holdingTag && (
                      <span className="contacts-meta-tag" title="Cartella">{contact.list_name}</span>
                    )}
                    {contact.responsible && (
                      <span className="contacts-meta-tag" title="Assegnato a">{contact.responsible}</span>
                    )}
                    {(contact.email_open_count || contact.email_click_count) ? (
                      <span>
                        {contact.email_open_count || 0} aperture · {contact.email_click_count || 0} click
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="contacts-row-side">
                  <button
                    type="button"
                    className={`contacts-star-action ${contact.status === 'Supertop' ? 'active' : ''}`}
                    title="Manda in pipeline Supertop"
                    aria-label="Manda in pipeline Supertop"
                    disabled={bulkSaving || contact.status === 'Supertop'}
                    onClick={async (e) => {
                      e.stopPropagation()
                      setBulkSaving(true)
                      try {
                        await apiFetch('/api/contacts/bulk', {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            contact_ids: [contact.id],
                            patch: { status: 'Supertop' },
                          }),
                        })
                        await refresh()
                        showToast(`${contact.name} spostato in Supertop`)
                      } catch (error) {
                        window.alert(error instanceof Error ? error.message : 'Spostamento in Supertop non riuscito')
                      } finally {
                        setBulkSaving(false)
                      }
                    }}
                  >
                    ★
                  </button>
                  <button
                    type="button"
                    className={`contacts-star-action contacts-partner-action ${isPartnerContact(contact) ? 'active' : ''}`}
                    title="Sposta nei Partner"
                    aria-label="Sposta nei Partner"
                    disabled={bulkSaving || isPartnerContact(contact)}
                    onClick={async (e) => {
                      e.stopPropagation()
                      setBulkSaving(true)
                      try {
                        await apiFetch('/api/contacts/bulk', {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            contact_ids: [contact.id],
                            patch: { contact_scope: 'partner' },
                          }),
                        })
                        await refresh()
                        showToast(`${contact.name} spostato nei Partner`)
                      } catch (error) {
                        window.alert(error instanceof Error ? error.message : 'Spostamento nei Partner non riuscito')
                      } finally {
                        setBulkSaving(false)
                      }
                    }}
                  >
                    🤝
                  </button>
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
                        Chiama oggi
                      </button>
                    )
                  )}
                  {!isClosed && (
                    <QuickDismissMenu
                      contactId={contact.id}
                      contactName={contact.name}
                      onDismiss={handleDismiss}
                    />
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
          const target = allContacts.find((contact) => contact.id === id) || null
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
        defaultSource={scope === 'inbound' ? 'speaqi' : undefined}
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
            const normalized = { ...payload }
            if (scope === 'holding') normalized.contact_scope = 'holding'
            if (scope === 'personal') normalized.contact_scope = 'personal'
            if (scope === 'partner') normalized.contact_scope = 'partner'
            if (scope === 'inbound') normalized.source = normalized.source || 'speaqi'
            await createContact(normalized)
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
