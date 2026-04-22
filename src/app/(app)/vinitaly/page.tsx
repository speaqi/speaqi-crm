'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { formatDateTime, holdingListLabel, isNeverContacted, priorityBadgeClass, priorityLabel, sourceLabel, statusLabel } from '@/lib/data'
import { useCRMContext } from '../layout'

export default function VinitalyPage() {
  const { holdingContacts, stages, refresh, showToast } = useCRMContext()
  const searchParams = useSearchParams()
  const [search, setSearch] = useState('')
  const [listFilter, setListFilter] = useState(searchParams.get('list') || '')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [contactStateFilter, setContactStateFilter] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [bulkStatus, setBulkStatus] = useState('')
  const [bulkSaving, setBulkSaving] = useState(false)

  useEffect(() => {
    setListFilter(searchParams.get('list') || '')
  }, [searchParams])

  const listOptions = useMemo(
    () => Array.from(new Set(holdingContacts.map((contact) => holdingListLabel(contact)).filter(Boolean))).sort(),
    [holdingContacts]
  )

  const categories = useMemo(
    () => Array.from(new Set(holdingContacts.map((contact) => contact.category).filter(Boolean))).sort(),
    [holdingContacts]
  )

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return holdingContacts.filter((contact) => {
      if (
        query &&
        !contact.name.toLowerCase().includes(query) &&
        !(contact.company || '').toLowerCase().includes(query) &&
        !(contact.email || '').toLowerCase().includes(query) &&
        !(contact.note || '').toLowerCase().includes(query) &&
        !(contact.category || '').toLowerCase().includes(query) &&
        !(contact.list_name || '').toLowerCase().includes(query) &&
        !(contact.event_tag || '').toLowerCase().includes(query)
      ) {
        return false
      }

      if (listFilter && holdingListLabel(contact) !== listFilter) return false
      if (categoryFilter && contact.category !== categoryFilter) return false
      if (contactStateFilter === 'never' && !isNeverContacted(contact)) return false
      if (contactStateFilter === 'sent' && isNeverContacted(contact)) return false
      return true
    })
  }, [categoryFilter, contactStateFilter, holdingContacts, listFilter, search])

  const filteredIds = useMemo(() => filtered.map((contact) => contact.id), [filtered])
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedIds.includes(id))
  const hasSelected = selectedIds.length > 0

  useEffect(() => {
    setSelectedIds((previous) => previous.filter((id) => filteredIds.includes(id)))
  }, [filteredIds])

  const scopedContacts = useMemo(
    () => holdingContacts.filter((contact) => !listFilter || holdingListLabel(contact) === listFilter),
    [holdingContacts, listFilter]
  )

  const emailedCount = useMemo(
    () => scopedContacts.filter((contact) => !!contact.last_contact_at).length,
    [scopedContacts]
  )

  const withoutEmailCount = useMemo(
    () => scopedContacts.filter((contact) => !contact.email).length,
    [scopedContacts]
  )

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
      setSelectedIds([])
      showToast(successMessage)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Aggiornamento non riuscito')
    } finally {
      setBulkSaving(false)
    }
  }

  return (
    <div className="dash-content">
      <div className="toolbar">
        <div className="search">
          <span style={{ color: 'var(--text3)' }}>🔍</span>
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Cerca nome, azienda, email, lista..."
          />
        </div>
        <select className="filter-select" value={listFilter} onChange={(event) => setListFilter(event.target.value)}>
          <option value="">Tutte le liste separate</option>
          {listOptions.map((listName) => (
            <option key={listName} value={listName}>
              {listName}
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
        <select className="filter-select" value={contactStateFilter} onChange={(event) => setContactStateFilter(event.target.value)}>
          <option value="">Tutte le liste separate</option>
          <option value="never">Mai contattati</option>
          <option value="sent">Email già inviata / lavorati</option>
        </select>
        <Link href="/import" className="btn btn-primary btn-sm" style={{ marginLeft: 'auto' }}>
          Importa CSV
        </Link>
      </div>

      <div className="contacts-summary" style={{ marginBottom: 16 }}>
        <label className="contacts-summary-selectall">
          <input
            type="checkbox"
            checked={allFilteredSelected}
            onChange={toggleSelectAllFiltered}
          />
          <span>Seleziona tutti i filtrati</span>
        </label>
        {hasSelected && <span className="contacts-summary-chip">{selectedIds.length} selezionati</span>}
      </div>

      {hasSelected && (
        <div className="contacts-bulkbar" style={{ marginBottom: 16 }}>
          <div className="contacts-bulkbar-copy">
            <strong>{selectedIds.length} contatti selezionati</strong>
            <span>Puoi mandarli nel CRM operativo con uno stato oppure toglierli dalla lista corrente.</span>
          </div>
          <div className="contacts-bulkbar-actions">
            <select
              className="filter-select"
              value={bulkStatus}
              onChange={(event) => setBulkStatus(event.target.value)}
            >
              <option value="">Sposta in CRM con stato…</option>
              {stages.map((stage) => (
                <option key={stage.id} value={stage.name}>
                  {statusLabel(stage.name)}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={bulkSaving || !bulkStatus}
              onClick={async () => {
                await runBulkUpdate(
                  { contact_scope: 'crm', status: bulkStatus },
                  'Contatti spostati nel CRM'
                )
                setBulkStatus('')
              }}
            >
              {bulkSaving ? 'Aggiornamento…' : 'Manda in CRM'}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={bulkSaving}
              onClick={async () => {
                await runBulkUpdate({ list_name: '' }, 'Lista rimossa dai contatti selezionati')
              }}
            >
              Togli da lista
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

      <div className="dash-meta-grid" style={{ marginBottom: 20 }}>
        <div className="meta-card meta-card-strong">
          <strong>{scopedContacts.length}</strong>
          <span>{listFilter ? 'contatti nella lista selezionata' : 'contatti in liste separate'}</span>
        </div>
        <div className="meta-card">
          <strong>{emailedCount}</strong>
          <span>già toccati via email o attività</span>
        </div>
        <div className="meta-card">
          <strong>{Math.max(scopedContacts.length - emailedCount, 0)}</strong>
          <span>ancora da contattare</span>
        </div>
        <div className="meta-card">
          <strong>{withoutEmailCount}</strong>
          <span>senza email disponibile</span>
        </div>
      </div>

      <div className="dash-card" style={{ marginBottom: 20 }}>
        <div className="dash-card-title">Liste separate</div>
        <p style={{ color: 'var(--text2)', fontSize: 14, lineHeight: 1.6, margin: 0 }}>
          Questi contatti restano fuori da pipeline, calendario e follow-up automatici. Quando una reply email viene sincronizzata,
          il lead viene promosso automaticamente nel CRM operativo. Vinitaly continua a finire qui, ma ora anche gli import CSV
          separati hanno un nome lista esplicito e filtrabile.
        </p>
      </div>

      <div className="contacts-content" style={{ padding: 0 }}>
        <div className="contacts-grid">
          {filtered.length === 0 ? (
            <p style={{ color: 'var(--text3)' }}>Nessun contatto trovato nelle liste separate.</p>
          ) : (
            filtered.map((contact) => (
              <div key={contact.id} className="contact-card contact-card-rich">
                <label
                  className="contacts-row-check"
                  style={{ alignSelf: 'flex-start' }}
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(contact.id)}
                    onChange={() => toggleSelection(contact.id)}
                  />
                </label>
                <Link href={`/contacts/${contact.id}`} className="contact-card-link">
                  <div className="contact-name">{contact.name}</div>
                  <div className="contact-meta">{contact.company || 'Azienda non disponibile'}</div>
                  <div className="contact-meta">{contact.email || 'Email non disponibile'}</div>
                  <div className="contact-meta">Lista: {holdingListLabel(contact)}</div>
                  <div className="contact-meta">Origine: {sourceLabel(contact.source)}</div>
                  <div className="contact-meta">Categoria: {contact.category || 'Non assegnata'}</div>
                  <div className="contact-meta">Ultimo tocco: {formatDateTime(contact.last_contact_at)}</div>
                  <div className="contact-tags">
                    <span className="ctag ctag-speaqi">Lista separata</span>
                    <span className="ctag ctag-event">{holdingListLabel(contact)}</span>
                    <span className="ctag ctag-contattato">{statusLabel(contact.status)}</span>
                    <span className={`ctag ${priorityBadgeClass(contact.priority)}`}>{priorityLabel(contact.priority)}</span>
                    {isNeverContacted(contact) && <span className="ctag ctag-dacontattare">Mai contattato</span>}
                  </div>
                </Link>
                <div className="card-actions-row">
                  <Link href={`/contacts/${contact.id}`} className="btn btn-primary btn-sm">
                    Apri scheda
                  </Link>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={async () => {
                      setBulkSaving(true)
                      try {
                        await apiFetch('/api/contacts/bulk', {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            contact_ids: [contact.id],
                            patch: { list_name: '' },
                          }),
                        })
                        await refresh()
                        showToast('Lista rimossa dal contatto')
                      } catch (error) {
                        window.alert(error instanceof Error ? error.message : 'Aggiornamento non riuscito')
                      } finally {
                        setBulkSaving(false)
                      }
                    }}
                    disabled={bulkSaving}
                  >
                    Togli da lista
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
