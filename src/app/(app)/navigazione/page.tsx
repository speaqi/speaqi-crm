'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useCRMContext } from '../layout'
import { apiFetch } from '@/lib/api'
import {
  matchesShippingPortFilter,
  SHIPPING_KIND_LABELS,
  SHIPPING_KINDS,
  SHIPPING_SEGMENT_LABELS,
  ShippingCompany,
  shippingContactPriority,
  shippingHeadquarters,
  ShippingKind,
  ShippingPortFilter,
  summarizeShipping,
} from '@/lib/shipping-companies'

// Compagnie di navigazione passeggeri: a chi vendere Speaqi Maps come azienda.
// La domanda che conta e' una sola — le sue navi arrivano a Napoli o a Roma? —
// quindi gli scali sono il primo filtro e il primo ordinamento.

type PortKey = 'calls_naples' | 'calls_civitavecchia'

const PORT_FILTERS: Array<{ key: ShippingPortFilter; label: string }> = [
  { key: 'all', label: 'Tutte' },
  { key: 'either', label: 'Napoli o Roma' },
  { key: 'naples', label: 'Napoli' },
  { key: 'civitavecchia', label: 'Civitavecchia' },
  { key: 'both', label: 'Entrambi' },
  { key: 'unknown', label: 'Da verificare' },
]

function nextPortValue(value: boolean | null) {
  if (value === null) return true
  if (value === true) return false
  return null
}

function portTitle(port: string, value: boolean | null) {
  if (value === true) return `Arriva a ${port}. Clic: segna che non ci arriva`
  if (value === false) return `Non arriva a ${port}. Clic: da verificare`
  return `${port} da verificare. Clic: segna che ci arriva`
}

function hostname(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function telHref(phone: string) {
  return `tel:${phone.replace(/[^\d+]/g, '')}`
}

function isUrl(value: string) {
  return /^https?:\/\//i.test(value)
}

function RefValue({ value }: { value: string }) {
  if (isUrl(value)) {
    return (
      <a href={value} target="_blank" rel="noreferrer">
        {hostname(value)}
      </a>
    )
  }
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return <a href={`mailto:${value}`}>{value}</a>
  if (/^[+\d(][\d\s().\-/]{5,}$/.test(value)) return <a href={telHref(value)}>{value}</a>
  return <>{value}</>
}

export default function NavigazionePage() {
  const { showToast } = useCRMContext()
  const [companies, setCompanies] = useState<ShippingCompany[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const [search, setSearch] = useState('')
  const [port, setPort] = useState<ShippingPortFilter>('either')
  const [kind, setKind] = useState<ShippingKind | 'all'>('all')
  const [country, setCountry] = useState('all')
  const [showInactive, setShowInactive] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const response = await apiFetch<{ companies: ShippingCompany[] }>('/api/shipping-companies')
      setCompanies(response.companies)
      setLoadError('')
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Impossibile caricare le compagnie')
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const active = useMemo(
    () => (companies || []).filter((company) => showInactive || company.active),
    [companies, showInactive]
  )
  const summary = useMemo(() => summarizeShipping(active), [active])

  const countries = useMemo(() => {
    const set = new Set<string>()
    for (const company of active) if (company.hq_country) set.add(company.hq_country)
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'it'))
  }, [active])

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase()
    return active
      .filter((company) => matchesShippingPortFilter(company, port))
      .filter((company) => kind === 'all' || company.kind === kind)
      .filter((company) => country === 'all' || company.hq_country === country)
      .filter((company) => {
        if (!query) return true
        return [company.name, company.parent_group, company.hq_city, company.hq_country, company.ports_note, ...company.ships]
          .some((value) => value && value.toLowerCase().includes(query))
      })
      .sort(
        (a, b) =>
          shippingContactPriority(b) - shippingContactPriority(a) || a.name.localeCompare(b.name, 'it')
      )
  }, [active, port, kind, country, search])

  async function togglePort(company: ShippingCompany, key: PortKey) {
    const value = nextPortValue(company[key])
    setBusyId(company.id)
    try {
      const response = await apiFetch<{ company: ShippingCompany }>('/api/shipping-companies', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: company.id, [key]: value }),
      })
      setCompanies((current) => (current || []).map((row) => (row.id === company.id ? response.company : row)))
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Impossibile aggiornare')
    } finally {
      setBusyId(null)
    }
  }

  function portButton(company: ShippingCompany, key: PortKey, label: string, port: string) {
    const value = company[key]
    const state = value === true ? 'is-yes' : value === false ? 'is-no' : 'is-unknown'
    return (
      <button
        type="button"
        className={`nv-port ${state}`}
        title={portTitle(port, value)}
        disabled={busyId === company.id}
        onClick={() => togglePort(company, key)}
      >
        <span aria-hidden="true">{value === true ? '✓' : value === false ? '✕' : '?'}</span>
        {label}
      </button>
    )
  }

  function renderDetails(company: ShippingCompany) {
    const office = company.italy_office
    return (
      <div className="nv-details">
        {company.hq_address ? (
          <div>
            <span className="nv-dt">Sede</span>
            {company.hq_address}
          </div>
        ) : null}
        {office ? (
          <div>
            <span className="nv-dt">Ufficio Italia</span>
            {[office.city, office.address].filter(Boolean).join(' — ')}
            {office.phone ? <> · <a href={telHref(office.phone)}>{office.phone}</a></> : null}
            {office.email ? <> · <a href={`mailto:${office.email}`}>{office.email}</a></> : null}
          </div>
        ) : null}
        {company.contacts.length ? (
          <div>
            <span className="nv-dt">Riferimenti</span>
            <ul className="nv-refs">
              {company.contacts.map((ref) => (
                <li key={`${ref.label}-${ref.value}`}>
                  <strong>{ref.label}:</strong> <RefValue value={ref.value} />
                  {ref.source ? (
                    <a className="nv-source" href={ref.source} target="_blank" rel="noreferrer" title="Fonte">
                      fonte
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {company.ports_note ? (
          <div>
            <span className="nv-dt">Scali</span>
            {company.ports_note}
            {company.ports_manual ? <em className="nv-manual"> · corretto a mano</em> : null}
          </div>
        ) : null}
        {company.ships.length ? (
          <div>
            <span className="nv-dt">Navi{company.fleet_size ? ` (${company.fleet_size})` : ''}</span>
            {company.ships.join(', ')}
          </div>
        ) : null}
        {company.sources.length ? (
          <div>
            <span className="nv-dt">Fonti</span>
            {company.sources.map((url, index) => (
              <span key={url}>
                {index ? ', ' : ''}
                <a href={url} target="_blank" rel="noreferrer">{hostname(url)}</a>
              </span>
            ))}
            {company.checked_at ? <em className="nv-manual"> · verificato il {company.checked_at}</em> : null}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className="page-container nv-page">
      <div className="page-header">
        <h1>Compagnie di navigazione</h1>
        <p className="page-subtitle">
          Crociere, expedition, fluviali e traghetti di tutto il mondo: sedi, riferimenti e chi arriva a Napoli o a
          Civitavecchia (Roma). A chi vendere Speaqi Maps come azienda.
        </p>
      </div>

      <div className="nv-stats">
        {[
          { key: 'all' as const, label: 'Compagnie', value: summary.total },
          { key: 'naples' as const, label: 'Arrivano a Napoli', value: summary.naples },
          { key: 'civitavecchia' as const, label: 'Arrivano a Civitavecchia', value: summary.civitavecchia },
          { key: 'both' as const, label: 'In entrambi', value: summary.both },
          { key: 'unknown' as const, label: 'Scali da verificare', value: summary.unknown },
        ].map((stat) => (
          <button
            key={stat.key}
            type="button"
            className={`nv-stat${port === stat.key ? ' is-active' : ''}`}
            onClick={() => setPort(stat.key)}
          >
            <strong>{stat.value}</strong>
            <span>{stat.label}</span>
          </button>
        ))}
      </div>

      <div className="nv-filters">
        <input
          className="fi nv-search"
          placeholder="Cerca compagnia, gruppo, città, nave…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <div className="nv-chips" role="group" aria-label="Scali">
          {PORT_FILTERS.map((filter) => (
            <button
              key={filter.key}
              type="button"
              className={`nv-chip${port === filter.key ? ' is-active' : ''}`}
              onClick={() => setPort(filter.key)}
            >
              {filter.label}
            </button>
          ))}
        </div>
        <select className="fi nv-select" value={kind} onChange={(event) => setKind(event.target.value as ShippingKind | 'all')}>
          <option value="all">Tutti i tipi</option>
          {SHIPPING_KINDS.map((value) => (
            <option key={value} value={value}>
              {SHIPPING_KIND_LABELS[value]} ({summary.byKind[value]})
            </option>
          ))}
        </select>
        <select className="fi nv-select" value={country} onChange={(event) => setCountry(event.target.value)}>
          <option value="all">Sede: tutti i paesi</option>
          {countries.map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
        <label className="nv-toggle">
          <input type="checkbox" checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} />
          Anche cessate
        </label>
      </div>

      {loadError ? <div className="inline-error">{loadError}</div> : null}
      {companies === null && !loadError ? <div className="nv-empty">Caricamento…</div> : null}
      {companies !== null && companies.length === 0 ? (
        <div className="nv-empty">
          Il catalogo è vuoto. Si carica con <code>npm run shipping:import -- --apply</code>.
        </div>
      ) : null}
      {companies !== null && companies.length > 0 && visible.length === 0 ? (
        <div className="nv-empty">Nessuna compagnia con questi filtri.</div>
      ) : null}

      {visible.length ? (
        <>
          <div className="nv-count">{visible.length === 1 ? '1 compagnia' : `${visible.length} compagnie`}</div>
          <ul className="nv-list">
            {visible.map((company) => {
              const open = openId === company.id
              const phone = company.italy_office?.phone || company.phone
              return (
                <li key={company.id} className={`nv-row${company.active ? '' : ' is-inactive'}`}>
                  <div className="nv-main">
                    <div className="nv-name">
                      {company.name}
                      {company.segment ? (
                        <span className={`nv-badge nv-seg-${company.segment}`}>{SHIPPING_SEGMENT_LABELS[company.segment]}</span>
                      ) : (
                        <span className="nv-badge">{SHIPPING_KIND_LABELS[company.kind]}</span>
                      )}
                      {!company.active ? <span className="nv-badge nv-badge-off">Cessata</span> : null}
                    </div>
                    <div className="nv-meta">
                      {[company.parent_group, shippingHeadquarters(company) ? `Sede: ${shippingHeadquarters(company)}` : null]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                    <div className="nv-contact">
                      {phone ? <a href={telHref(phone)}>📞 {phone}</a> : null}
                      {company.email ? <a href={`mailto:${company.email}`}>✉️ {company.email}</a> : null}
                      {company.website ? (
                        <a href={company.website} target="_blank" rel="noreferrer">🌐 {hostname(company.website)}</a>
                      ) : null}
                    </div>
                  </div>
                  <div className="nv-ports">
                    {portButton(company, 'calls_naples', 'Napoli', 'Napoli')}
                    {portButton(company, 'calls_civitavecchia', 'Roma', 'Civitavecchia (Roma)')}
                  </div>
                  <div className="nv-actions">
                    {company.contact_id ? (
                      <Link className="btn-mini" href={`/contacts/${company.contact_id}`}>
                        Scheda
                      </Link>
                    ) : null}
                    <button type="button" className="btn-mini" onClick={() => setOpenId(open ? null : company.id)}>
                      {open ? 'Chiudi' : 'Dettagli'}
                    </button>
                  </div>
                  {open ? renderDetails(company) : null}
                </li>
              )
            })}
          </ul>
        </>
      ) : null}
    </div>
  )
}
