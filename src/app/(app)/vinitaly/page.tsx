'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { formatDateTime, isNeverContacted, priorityBadgeClass, priorityLabel, sourceLabel, statusLabel } from '@/lib/data'
import { useCRMContext } from '../layout'

export default function VinitalyPage() {
  const { holdingContacts } = useCRMContext()
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [contactStateFilter, setContactStateFilter] = useState('')

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
        !(contact.email || '').toLowerCase().includes(query) &&
        !(contact.note || '').toLowerCase().includes(query) &&
        !(contact.category || '').toLowerCase().includes(query)
      ) {
        return false
      }

      if (categoryFilter && contact.category !== categoryFilter) return false
      if (contactStateFilter === 'never' && !isNeverContacted(contact)) return false
      if (contactStateFilter === 'sent' && isNeverContacted(contact)) return false
      return true
    })
  }, [categoryFilter, contactStateFilter, holdingContacts, search])

  const emailedCount = useMemo(
    () => holdingContacts.filter((contact) => !!contact.last_contact_at).length,
    [holdingContacts]
  )

  const withoutEmailCount = useMemo(
    () => holdingContacts.filter((contact) => !contact.email).length,
    [holdingContacts]
  )

  return (
    <div className="dash-content">
      <div className="toolbar">
        <div className="search">
          <span style={{ color: 'var(--text3)' }}>🔍</span>
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Cerca azienda, email, categoria..."
          />
        </div>
        <select className="filter-select" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
          <option value="">Tutte le categorie</option>
          {categories.map((category) => (
            <option key={category} value={category || ''}>
              {category}
            </option>
          ))}
        </select>
        <select className="filter-select" value={contactStateFilter} onChange={(event) => setContactStateFilter(event.target.value)}>
          <option value="">Tutto il Vinitaly</option>
          <option value="never">Mai contattati</option>
          <option value="sent">Email già inviata / lavorati</option>
        </select>
        <Link href="/import" className="btn btn-primary btn-sm" style={{ marginLeft: 'auto' }}>
          Importa CSV
        </Link>
      </div>

      <div className="dash-meta-grid" style={{ marginBottom: 20 }}>
        <div className="meta-card meta-card-strong">
          <strong>{holdingContacts.length}</strong>
          <span>contatti in lista separata</span>
        </div>
        <div className="meta-card">
          <strong>{emailedCount}</strong>
          <span>già toccati via email o attività</span>
        </div>
        <div className="meta-card">
          <strong>{Math.max(holdingContacts.length - emailedCount, 0)}</strong>
          <span>ancora da contattare</span>
        </div>
        <div className="meta-card">
          <strong>{withoutEmailCount}</strong>
          <span>senza email disponibile</span>
        </div>
      </div>

      <div className="dash-card" style={{ marginBottom: 20 }}>
        <div className="dash-card-title">Regola Vinitaly</div>
        <p style={{ color: 'var(--text2)', fontSize: 14, lineHeight: 1.6, margin: 0 }}>
          Questi contatti restano fuori da pipeline, calendario e follow-up automatici. Quando una reply email viene sincronizzata,
          il lead viene promosso automaticamente nel CRM operativo.
        </p>
      </div>

      <div className="contacts-content" style={{ padding: 0 }}>
        <div className="contacts-grid">
          {filtered.length === 0 ? (
            <p style={{ color: 'var(--text3)' }}>Nessun contatto Vinitaly trovato.</p>
          ) : (
            filtered.map((contact) => (
              <div key={contact.id} className="contact-card contact-card-rich">
                <Link href={`/contacts/${contact.id}`} className="contact-card-link">
                  <div className="contact-name">{contact.name}</div>
                  <div className="contact-meta">{contact.email || 'Email non disponibile'}</div>
                  <div className="contact-meta">Origine: {sourceLabel(contact.source)}</div>
                  <div className="contact-meta">Categoria: {contact.category || 'Non assegnata'}</div>
                  <div className="contact-meta">Ultimo tocco: {formatDateTime(contact.last_contact_at)}</div>
                  <div className="contact-tags">
                    <span className="ctag ctag-speaqi">Lista separata</span>
                    <span className="ctag ctag-contattato">{statusLabel(contact.status)}</span>
                    <span className={`ctag ${priorityBadgeClass(contact.priority)}`}>{priorityLabel(contact.priority)}</span>
                    {isNeverContacted(contact) && <span className="ctag ctag-dacontattare">Mai contattato</span>}
                  </div>
                </Link>
                <div className="card-actions-row">
                  <Link href={`/contacts/${contact.id}`} className="btn btn-primary btn-sm">
                    Apri scheda
                  </Link>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
