'use client'

import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode
} from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/api'
import { createClient } from '@/lib/supabase'
import {
  ENTITY_STATUSES,
  ENTITY_KINDS,
  TOURISM_TYPES,
  STATUS_LABELS,
  KIND_LABELS,
  RELATION_LABELS,
  SCORE_FACTORS,
  opportunityScore,
  duplicateHints,
  exportCsv,
  type TourismEntity,
  type Evidence,
  type Relation,
  type ImportRecord,
  type DiscoveryJob,
  type FactorKey
} from '@/lib/tourism'
import { TARGET_LABELS } from '@/lib/tourism-site-qualification'
import s from './tourism.module.css'
import TourismResearch, { EntityPicker } from './TourismResearch'
import TourismDecks from './deck/TourismDecks'
import DeckWizard from './deck/DeckWizard'

const WorldMap = dynamic(() => import('./WorldMap'), {
  ssr: false,
  loading: () => <div className={s.mapLoading}>Caricamento mappa…</div>
})
const acquisitionSourceLabel = (source: string) =>
  source.startsWith('wikidata:')
    ? 'Wikidata'
    : (
        {
          'wtm:london': 'WTM London',
          'wtm:atm': 'Arabian Travel Market',
          'wtm:latin-america': 'WTM Latin America',
          'official:un-tourism': 'UN Tourism',
          'official:etc': 'European Travel Commission',
          'official:cto': 'Caribbean Tourism Organization',
          'official:ota': 'Siti ufficiali OTA',
          'wikipedia:ota-discovery': 'Wikipedia · scoperta OTA',
          'ttg:2026-cached':
            'TTG Travel Experience 2026 · elenco già acquisito',
          'official:national-sites': 'Siti istituzionali e degli enti'
        } as Record<string, string>
      )[source] || source
type Row = TourismEntity & {
  evidence: Evidence[]
  crm: { contact_id: string }[]
  matches?: { contact_id: string; score: number; state: string }[]
}
type Coverage = {
  reference_countries: number
  countries_with_organizations: number
  countries_without_organizations: number
  matched_organizations: number
  by_country: {
    country_code: string
    name: string
    total: number
    verified: number
  }[]
  runs: {
    id: string
    run_key: string
    state: string
    started_at: string
    completed_at: string | null
    sources: { source: string; rows: number }[]
    stats: { organizations?: number; raw_exhibitors?: number }
  }[]
}
type Overview = {
  organizations: number
  countries: number
  places: number
  verified: number
  review: number
  new_week: number
  contacts: number
  crm: number
  by_country: { country_code: string; total: number; verified: number }[]
}
type Detail = {
  entity: TourismEntity
  evidence: Evidence[]
  relations: Relation[]
  relationEvidence?: Evidence[]
  neighbors: TourismEntity[]
  revisions: {
    id: number
    table_name: string
    operation: string
    actor_id: string
    created_at: string
  }[]
  contact: {
    id: string
    name: string
    company: string
    email: string | null
    phone: string | null
    status: string
  } | null
  matches?: {
    id: string
    contact_id: string
    rule: string
    score: number
    matched_at: string
    contact: {
      id: string
      name: string
      company: string
      country: string | null
      status: string
    } | null
  }[]
}
type Graph = {
  entities: TourismEntity[]
  relations: Relation[]
  evidence: Evidence[]
  limit: number
}
type Filters = {
  availability: string
  outreach: string
  target: string
  q: string
  country: string
  type: string
  status: string
  kind: string
  sort: string
  crm: string
}
const INITIAL: Filters = {
  availability: 'active',
  outreach: '',
  target: '',
  q: '',
  country: '',
  type: '',
  status: '',
  kind: 'organization',
  sort: 'name',
  crm: ''
}
const OUTREACH_LABELS: Record<1 | 2 | 3, string> = {
  1: 'Top · contattare prima',
  2: '2ª ondata',
  3: '3ª ondata'
}
const DialogFeedback = createContext('')
const fmt = (v: number) => new Intl.NumberFormat('it-IT').format(v)
const date = (v: string | null) =>
  v
    ? new Date(v).toLocaleString('it-IT', {
        timeZone: 'Europe/Rome',
        dateStyle: 'short',
        timeStyle: 'short'
      })
    : 'Non verificata'
function countryName(code: string) {
  try {
    return new Intl.DisplayNames(['it'], { type: 'region' }).of(code) || code
  } catch {
    return code
  }
}
async function post<T>(body: unknown, path = '/api/tourism') {
  return apiFetch<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
}
function Icon({
  name
}: {
  name: 'globe' | 'search' | 'arrow' | 'spark' | 'grid' | 'link' | 'upload'
}) {
  const paths = {
    globe: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3c-5 5-5 13 0 18 5-5 5-13 0-18Z" />
      </>
    ),
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 5 5" />
      </>
    ),
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    spark: (
      <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z" />
    ),
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </>
    ),
    link: (
      <>
        <path d="m10 13 4-4m-6 7-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m0 2 1-1a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0" />
      </>
    ),
    upload: <path d="M12 16V3m-5 5 5-5 5 5M3 15v6h18v-6" />
  }
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  )
}
function Badge({ status }: { status: string }) {
  return (
    <span
      className={`${s.badge} ${status === 'VERIFIED' ? s.verified : status === 'INACTIVE' ? s.inactive : s.pending}`}
    >
      <i />
      {STATUS_LABELS[status] || status}
    </span>
  )
}
function Empty({ children }: { children: ReactNode }) {
  return (
    <div className={s.empty}>
      <Icon name="globe" />
      <h3>La prossima destinazione inizia qui</h3>
      <p>{children}</p>
    </div>
  )
}
function Dialog({
  title,
  onClose,
  children
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const error = useContext(DialogFeedback)
  useEffect(() => {
    const el = ref.current
    el?.showModal()
    return () => el?.close()
  }, [])
  return (
    <dialog
      className={s.dialog}
      ref={ref}
      onCancel={onClose}
      aria-label={title}
    >
      <header>
        <h2>{title}</h2>
        <button
          className={s.iconButton}
          onClick={onClose}
          aria-label="Chiudi finestra"
        >
          ×
        </button>
      </header>
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
      {children}
    </dialog>
  )
}

export default function TourismWorkspace() {
  const router = useRouter()
  const [deckFor, setDeckFor] = useState<TourismEntity | null>(null)
  const [tab, setTab] = useState('overview'),
    [overview, setOverview] = useState<Overview | null>(null),
    [coverage, setCoverage] = useState<Coverage | null>(null),
    [rows, setRows] = useState<Row[]>([]),
    [total, setTotal] = useState(0),
    [page, setPage] = useState(0),
    [filters, setFilters] = useState<Filters>(INITIAL),
    [query, setQuery] = useState(''),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [reload, setReload] = useState(0)
  const [selected, setSelected] = useState<string[]>([]),
    [detailId, setDetailId] = useState<string | null>(null),
    [detail, setDetail] = useState<Detail | null>(null),
    [graph, setGraph] = useState<Graph | null>(null),
    [graphFocus, setGraphFocus] = useState(''),
    [modal, setModal] = useState<'import' | 'new' | 'edit' | null>(null)
  const [importText, setImportText] = useState(''),
    [preview, setPreview] = useState<{
      records: ImportRecord[]
      errors: { row: number; message: string }[]
      total: number
    } | null>(null),
    [saved, setSaved] = useState<{ name: string; filters: Filters }[]>([]),
    [storageKey, setStorageKey] = useState('')
  const [jobs, setJobs] = useState<DiscoveryJob[]>([]),
    [configured, setConfigured] = useState(false),
    [discoveryQuery, setDiscoveryQuery] = useState(''),
    [candidateSelection, setCandidateSelection] = useState<
      Record<string, number[]>
    >({}),
    [confirmation, setConfirmation] = useState<{
      label: string
      run: () => Promise<void>
    } | null>(null)
  const [weights, setWeights] = useState<Partial<Record<FactorKey, number>>>({})
  const notify = (message: string) => {
    setNotice(message)
    setError('')
  }
  const refresh = () => setReload((r) => r + 1)
  const act = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Operazione fallita')
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    const t = setTimeout(() => {
      setFilters((f) => ({ ...f, q: query }))
      setPage(0)
    }, 300)
    return () => clearTimeout(t)
  }, [query])
  useEffect(() => {
    let live = true
    createClient()
      .auth.getSession()
      .then(({ data: { session } }) => {
        if (!live || !session) return
        const key = `speaqi-tourism-views:${session.user.id}`
        setStorageKey(key)
        try {
          const value = JSON.parse(localStorage.getItem(key) || '[]')
          if (Array.isArray(value)) setSaved(value.slice(0, 10))
        } catch {}
      })
    return () => {
      live = false
    }
  }, [])
  useEffect(() => {
    let live = true
    apiFetch<Overview>('/api/tourism?view=overview')
      .then((r) => {
        if (live) setOverview(r)
      })
      .catch((e) => {
        if (live) setError(e.message)
      })
    return () => {
      live = false
    }
  }, [reload])
  useEffect(() => {
    let live = true
    apiFetch<Coverage>('/api/tourism?view=coverage')
      .then((data) => {
        if (live) setCoverage(data)
      })
      .catch((error) => {
        if (live) setError(error.message)
      })
    return () => {
      live = false
    }
  }, [reload])
  useEffect(() => {
    let live = true
    setLoading(true)
    const params = new URLSearchParams({ ...filters, page: String(page) })
    apiFetch<{ entities: Row[]; total: number }>(`/api/tourism?${params}`)
      .then((r) => {
        if (live) {
          setRows(r.entities)
          setTotal(r.total)
          setSelected([])
        }
      })
      .catch((e) => {
        if (live) setError(e.message)
      })
      .finally(() => {
        if (live) setLoading(false)
      })
    return () => {
      live = false
    }
  }, [filters, page, reload])
  useEffect(() => {
    if (!detailId) {
      setDetail(null)
      return
    }
    let live = true
    setDetail(null)
    apiFetch<Detail>(`/api/tourism?id=${detailId}`)
      .then((r) => {
        if (live) setDetail(r)
      })
      .catch((e) => {
        if (live) setError(e.message)
      })
    return () => {
      live = false
    }
  }, [detailId, reload])
  useEffect(() => {
    if (tab !== 'explorer') return
    let live = true
    apiFetch<Graph>(
      '/api/tourism?view=graph' +
        (graphFocus ? '&focus=' + encodeURIComponent(graphFocus) : '')
    )
      .then((r) => {
        if (live) setGraph(r)
      })
      .catch((e) => {
        if (live) setError(e.message)
      })
    return () => {
      live = false
    }
  }, [tab, graphFocus, reload])
  useEffect(() => {
    if (tab !== 'discovery') return
    let live = true
    apiFetch<{ jobs: DiscoveryJob[]; configured: boolean }>(
      '/api/tourism/discovery'
    )
      .then((r) => {
        if (live) {
          setJobs(r.jobs)
          setConfigured(r.configured)
        }
      })
      .catch((e) => {
        if (live) setError(e.message)
      })
    return () => {
      live = false
    }
  }, [tab, reload])
  const setFilter = (key: keyof Filters, value: string) => {
    setFilters((f) => ({ ...f, [key]: value }))
    setPage(0)
  }
  const selectCountry = useCallback((country: string) => {
    setFilters({ ...INITIAL, country })
    setQuery('')
    setPage(0)
    setTab('directory')
  }, [])
  const exportSelection = () => {
    const chosen = rows.filter((r) => selected.includes(r.id))
    if (!chosen.length) return
    const url = URL.createObjectURL(
      new Blob(['\uFEFF' + exportCsv(chosen)], {
        type: 'text/csv;charset=utf-8'
      })
    )
    const a = document.createElement('a')
    a.href = url
    a.download = 'speaqi-tourism-selection.csv'
    a.click()
    URL.revokeObjectURL(url)
  }
  const loadView = (value: string) => {
    const view = saved[Number(value)]
    if (view) {
      setFilters({ ...INITIAL, ...view.filters })
      setQuery(view.filters.q)
      setPage(0)
    }
  }
  const saveView = (name: string) => {
    if (!storageKey || !name.trim()) return
    const views = [
      { name: name.trim().slice(0, 60), filters },
      ...saved.filter((v) => v.name !== name.trim())
    ].slice(0, 10)
    localStorage.setItem(storageKey, JSON.stringify(views))
    setSaved(views)
    notify('Vista salvata per questo utente e browser')
  }

  return (
    <DialogFeedback.Provider value={error}>
      <div className={s.workspace} data-tourism-workspace>
        <div className={s.eyebrow}>
          <span className={s.brandMark}>S</span>SPEAQI <span>/</span> GLOBAL
          INTELLIGENCE <span className={s.pilot}>CENSIMENTO GLOBALE</span>
        </div>
        <header className={s.heading}>
          <div>
            <h1>
              Global Tourism Intelligence<span>.</span>
            </h1>
            <p>
              Conosci le organizzazioni. Connetti i territori. Scopri nuove
              opportunità.
            </p>
          </div>
          <div className={s.actions}>
            <Link className={s.secondary} href="/tourism-lavoro">Il mio lavoro · Assegnazioni</Link>
            <button
              className={s.secondary}
              onClick={() => {
                setPreview(null)
                setModal('import')
              }}
            >
              <Icon name="upload" />
              Importa dati
            </button>
            <button className={s.primary} onClick={() => setModal('new')}>
              ＋ Nuova organizzazione
            </button>
          </div>
        </header>
        <nav className={s.tabs} aria-label="Viste Tourism Intelligence">
          {[
            { key: 'overview', label: 'Panoramica', icon: 'grid' },
            { key: 'directory', label: 'Directory', icon: 'search' },
            { key: 'explorer', label: 'Territori e relazioni', icon: 'link' },
            { key: 'discovery', label: 'AI Discovery', icon: 'spark' },
            { key: 'research', label: 'Ricerca siti e progetti', icon: 'globe' },
            { key: 'decks', label: 'Presentazioni', icon: 'spark' }
          ].map((t) => (
            <button
              key={t.key}
              className={tab === t.key ? s.activeTab : ''}
              onClick={() => setTab(t.key)}
              aria-current={tab === t.key ? 'page' : undefined}
            >
              <Icon name={t.icon as 'grid'} />
              {t.label}
              {t.key === 'directory' && overview && (
                <span>{fmt(overview.organizations)}</span>
              )}
            </button>
          ))}
        </nav>
        {error && (
          <div className={s.error} role="alert">
            {error}
            <button
              onClick={() => {
                setError('')
                refresh()
              }}
            >
              Riprova
            </button>
          </div>
        )}
        {notice && (
          <div className={s.notice} role="status">
            {notice}
            <button onClick={() => setNotice('')} aria-label="Chiudi notifica">
              ×
            </button>
          </div>
        )}
        {tab === 'overview' && (
          <>
            <div className={s.stats}>
              {[
                {
                  label: 'Organizzazioni censite',
                  value: overview?.organizations,
                  sub: 'Identità distinte nel catalogo'
                },
                {
                  label: 'Paesi con organizzazioni',
                  value: overview?.countries,
                  sub: coverage?.reference_countries
                    ? `Su ${fmt(coverage.reference_countries)} paesi e territori in anagrafica`
                    : 'Copertura progressiva delle fonti'
                },
                {
                  label: 'Identità verificate',
                  value: overview?.verified,
                  sub: `${overview?.review ?? '—'} da revisionare`,
                  green: true
                },
                {
                  label: 'Collegate al CRM',
                  value: overview?.crm,
                  sub: 'Selezionate dal team commerciale'
                }
              ].map((c) => (
                <article key={c.label} className={s.stat}>
                  <span>{c.label}</span>
                  <strong className={c.green ? s.green : ''}>
                    {c.value === undefined ? '—' : fmt(c.value)}
                  </strong>
                  <small>{c.sub}</small>
                </article>
              ))}
            </div>
            {coverage && coverage.runs.length > 0 && (
              <section
                className={`${s.panel} ${s.coverageCard}`}
                aria-label="Acquisizione e copertura"
              >
                <div className={s.panelHeading}>
                  <div>
                    <span className={s.eyebrow}>FONTI E COPERTURA</span>
                    <h2>Il catalogo cresce per acquisizioni documentate</h2>
                  </div>
                  <span>
                    {fmt(coverage.matched_organizations)} organizzazioni con
                    corrispondenze CRM
                  </span>
                </div>
                <p>
                  {fmt(coverage.countries_without_organizations)} paesi e
                  territori non hanno ancora organizzazioni censite. La presenza
                  di record in un paese non indica un censimento completo.
                </p>
                {coverage.runs.slice(0, 3).map((run) => (
                  <div
                    className={`${s.relationRow} ${s.sourceRun}`}
                    key={run.id}
                  >
                    <span>{date(run.completed_at || run.started_at)}</span>
                    <strong>
                      {[
                        ...new Set(
                          run.sources.map((source) =>
                            acquisitionSourceLabel(source.source)
                          )
                        )
                      ].join(' · ')}
                    </strong>
                    <small>
                      {run.state === 'completed'
                        ? 'Acquisizione registrata'
                        : run.state === 'running'
                          ? 'Acquisizione in corso'
                          : 'Acquisizione parziale'}
                    </small>
                  </div>
                ))}
                <details>
                  <summary>Copertura per paese e territorio</summary>
                  <div className={`${s.tableWrap} ${s.coverageTable}`}>
                    <table className={s.table}>
                      <thead>
                        <tr>
                          <th>Paese / territorio</th>
                          <th>Organizzazioni</th>
                          <th>Verificate</th>
                        </tr>
                      </thead>
                      <tbody>
                        {coverage.by_country.map((country) => (
                          <tr key={country.country_code}>
                            <td>
                              <button
                                className={s.textButton}
                                onClick={() =>
                                  selectCountry(country.country_code)
                                }
                              >
                                {countryName(country.country_code)}
                              </button>
                            </td>
                            <td>{fmt(country.total)}</td>
                            <td>{fmt(country.verified)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </section>
            )}
            <div className={s.overviewGrid}>
              <section className={s.panel}>
                <div className={s.panelHeading}>
                  <div>
                    <span className={s.eyebrow}>GLOBAL EXPLORER</span>
                    <h2>Una prospettiva globale</h2>
                  </div>
                  <span className={s.live}>
                    <i />
                    Copertura del catalogo
                  </span>
                </div>
                <WorldMap
                  countries={overview?.by_country || []}
                  onSelect={selectCountry}
                />
                <div className={s.mapFooter}>
                  <span>
                    <i />
                    Organizzazioni censite per paese
                  </span>
                  <small>
                    Posizioni indicative nazionali, non sedi degli enti
                  </small>
                </div>
              </section>
              <section className={s.panel}>
                <div className={s.panelHeading}>
                  <div>
                    <span className={s.eyebrow}>DATA QUALITY</span>
                    <h2>La fiducia parte dalle fonti</h2>
                  </div>
                  <span className={s.qualityIcon}>✓</span>
                </div>
                <div className={s.qualityNumber}>
                  {overview?.organizations
                    ? Math.round(
                        (overview.verified / overview.organizations) * 100
                      )
                    : 0}
                  <span>%</span>
                </div>
                <p className={s.muted}>Identità revisionate nel workspace</p>
                <div className={s.progress}>
                  <div
                    style={{
                      width: `${overview?.organizations ? (overview.verified / overview.organizations) * 100 : 0}%`
                    }}
                  />
                </div>
                <dl className={s.qualityList}>
                  <div>
                    <dt>In attesa di revisione</dt>
                    <dd>{overview?.review ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>Territori catalogati</dt>
                    <dd>{overview?.places ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>Recapiti istituzionali presenti</dt>
                    <dd>{overview?.contacts ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>Nuove organizzazioni · 7 giorni</dt>
                    <dd>{overview?.new_week ?? '—'}</dd>
                  </div>
                </dl>
                <button
                  className={s.textButton}
                  onClick={() => {
                    setFilters({ ...INITIAL, status: 'UNVERIFIED' })
                    setQuery('')
                    setPage(0)
                    setTab('directory')
                  }}
                >
                  Apri la coda di verifica <Icon name="arrow" />
                </button>
              </section>
            </div>
            <div className={s.bottomGrid}>
              <section className={s.panel}>
                <div className={s.panelHeading}>
                  <div>
                    <span className={s.eyebrow}>MARKET COVERAGE</span>
                    <h2>Esplora i mercati</h2>
                  </div>
                  <span className={s.muted}>
                    {overview?.countries ?? 0} paesi
                  </span>
                </div>
                {overview?.by_country.length ? (
                  overview.by_country.map((c) => (
                    <button
                      key={c.country_code}
                      className={s.countryRow}
                      onClick={() => selectCountry(c.country_code)}
                    >
                      <span className={s.countryCode}>{c.country_code}</span>
                      <span>
                        <strong>{countryName(c.country_code)}</strong>
                        <small>{c.verified} identità verificate</small>
                      </span>
                      <b>{fmt(c.total)}</b>
                      <Icon name="arrow" />
                    </button>
                  ))
                ) : (
                  <p className={s.muted}>
                    Il catalogo non contiene ancora organizzazioni.
                  </p>
                )}
              </section>
              <section className={s.discoveryCard}>
                <span className={s.eyebrow}>
                  <Icon name="spark" /> ASSISTED DISCOVERY
                </span>
                <h2>
                  Il prossimo interlocutore,
                  <br />
                  ancora da scoprire.
                </h2>
                <p>
                  Parti da un paese o una destinazione. Raccogli candidati e
                  fonti, poi scegli cosa aggiungere al catalogo.
                </p>
                <button onClick={() => setTab('discovery')}>
                  Esplora con AI Discovery <Icon name="arrow" />
                </button>
                <div className={s.orbit} aria-hidden="true">
                  <span>◎</span>
                </div>
              </section>
            </div>
            {overview?.organizations === 0 && (
              <section className={s.pilotBanner}>
                <div>
                  <h3>Inizia dal campione italiano</h3>
                  <p>
                    8 organizzazioni reali, territori e fonti ufficiali. Tutti i
                    record richiedono la tua revisione.
                  </p>
                </div>
                <button
                  className={s.primary}
                  disabled={busy}
                  onClick={() =>
                    act(async () => {
                      const r = await post<{
                        created: number
                        duplicates: number
                      }>({ action: 'pilot' })
                      notify(
                        `Pilota importato: ${r.created} entità nuove, ${r.duplicates} già presenti`
                      )
                      refresh()
                    })
                  }
                >
                  Importa il pilota Italia
                </button>
              </section>
            )}
          </>
        )}
        {tab === 'directory' && (
          <section className={s.panel}>
            <div className={s.panelHeading}>
              <div>
                <h2>Organization directory</h2>
                <p className={s.muted}>
                  {fmt(total)} risultati · organizzazioni e dati verificabili
                </p>
              </div>
              <div className={s.actions}>
                <select
                  aria-label="Viste salvate"
                  onChange={(e) => loadView(e.target.value)}
                  defaultValue=""
                >
                  <option value="">Viste salvate</option>
                  {saved.map((v, i) => (
                    <option key={v.name} value={i}>
                      {v.name}
                    </option>
                  ))}
                </select>
                <button
                  className={s.secondary}
                  onClick={() =>
                    saveView(
                      [
                        filters.country
                          ? countryName(filters.country)
                          : 'Tutti i paesi',
                        filters.type || 'tutte le categorie',
                        filters.status || 'tutti gli stati',
                        filters.q
                      ]
                        .filter(Boolean)
                        .join(' · ')
                    )
                  }
                >
                  Salva vista
                </button>
              </div>
            </div>
            <div className={s.filters}>
              <label className={s.search}>
                <Icon name="search" />
                <input
                  aria-label="Cerca organizzazioni"
                  placeholder="Cerca per nome o sito…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <select
                aria-label="Paese"
                value={filters.country}
                onChange={(e) => setFilter('country', e.target.value)}
              >
                <option value="">Tutti i paesi</option>
                {overview?.by_country.map((c) => (
                  <option key={c.country_code} value={c.country_code}>
                    {countryName(c.country_code)}
                  </option>
                ))}
              </select>
              <select
                aria-label="Categoria"
                value={filters.type}
                onChange={(e) => setFilter('type', e.target.value)}
              >
                <option value="">Tutte le categorie</option>
                {Object.entries(TOURISM_TYPES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              <select
                aria-label="Verifica"
                value={filters.status}
                onChange={(e) => setFilter('status', e.target.value)}
              >
                <option value="">Ogni stato</option>
                {ENTITY_STATUSES.map((k) => (
                  <option key={k} value={k}>
                    {STATUS_LABELS[k]}
                  </option>
                ))}
              </select>
            </div>
            <div className={s.directoryTools}>
              <select
                aria-label="Disponibilità nel catalogo"
                value={filters.availability || 'active'}
                onChange={(e) => setFilter('availability', e.target.value)}
              >
                <option value="active">Attive</option>
                <option value="disabled">Disabilitate</option>
                <option value="all">Attive e disabilitate</option>
              </select>
              <select
                aria-label="Ordine di contatto"
                value={filters.outreach || ''}
                onChange={(e) => setFilter('outreach', e.target.value)}
              >
                <option value="">Tutte, in lista o no</option>
                <option value="top">Top: da contattare prima</option>
                <option value="listed">Lista destinazioni (1ª–3ª ondata)</option>
              </select>
              <select
                aria-label="Controllo del sito"
                value={filters.target || ''}
                onChange={(e) => setFilter('target', e.target.value)}
              >
                <option value="">Tutti gli esiti dei siti</option>
                {Object.entries(TARGET_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
              <select
                aria-label="Corrispondenze CRM"
                value={filters.crm || ''}
                onChange={(event) => setFilter('crm', event.target.value)}
              >
                <option value="">Tutti gli stati CRM</option>
                <option value="matched">Corrispondenze da confermare</option>
              </select>
              <select
                aria-label="Tipo di entità"
                value={filters.kind}
                onChange={(e) => setFilter('kind', e.target.value)}
              >
                {ENTITY_KINDS.filter((k) => k !== 'person').map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABELS[k]}
                  </option>
                ))}
              </select>
              <select
                aria-label="Ordina risultati"
                value={filters.sort}
                onChange={(e) => setFilter('sort', e.target.value)}
              >
                <option value="name">Nome A–Z</option>
                <option value="recent">Aggiunte di recente</option>
                <option value="outreach">Da contattare prima</option>
              </select>
              <span className={s.muted}>
                {selected.length} selezionate in questa pagina
              </span>
              <button
                className={s.textButton}
                disabled={!selected.length}
                onClick={exportSelection}
              >
                Esporta selezione
              </button>
              <button
                className={s.textButton}
                disabled={!selected.length || busy}
                onClick={() =>
                  setConfirmation({
                    label: `Archiviare ${selected.length} entità selezionate? Le fonti e lo storico saranno conservati.`,
                    run: async () => {
                      const outcomes = await Promise.allSettled(
                        rows
                          .filter((r) => selected.includes(r.id))
                          .map((r) =>
                            apiFetch('/api/tourism', {
                              method: 'PATCH',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                id: r.id,
                                version: r.version,
                                status: 'INACTIVE'
                              })
                            })
                          )
                      )
                      const failed = outcomes.filter(
                        (r) => r.status === 'rejected'
                      ).length
                      refresh()
                      notify(
                        `${outcomes.length - failed} archiviate${failed ? `, ${failed} non aggiornate: ricaricare e riprovare` : ''}`
                      )
                    }
                  })
                }
              >
                Archivia selezione
              </button>
            </div>
            {selected.length > 0 && <div className={s.actions}><Link className={s.primary} href={`/tourism-lavoro?entities=${selected.join(',')}`}>Assegna {selected.length} schede al team</Link></div>}
            <div className={s.tableWrap}>
              <table className={s.table}>
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        aria-label="Seleziona tutta la pagina"
                        checked={
                          rows.length > 0 && selected.length === rows.length
                        }
                        onChange={(e) =>
                          setSelected(
                            e.target.checked ? rows.map((r) => r.id) : []
                          )
                        }
                      />
                    </th>
                    <th>Organizzazione / entità</th>
                    <th>Sito internet</th>
                    <th>Paese</th>
                    <th>Categoria</th>
                    <th>Verifica</th>
                    <th>Opportunity score</th>
                    <th>CRM</th>
                    <th>Controllo destinazione</th>
                    <th>Contatto</th>
                    <th>Disponibilità</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const score = opportunityScore(r, r.evidence || [])
                    return (
                      <tr key={r.id}>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Seleziona ${r.name}`}
                            checked={selected.includes(r.id)}
                            onChange={(e) =>
                              setSelected((ids) =>
                                e.target.checked
                                  ? [...ids, r.id]
                                  : ids.filter((id) => id !== r.id)
                              )
                            }
                          />
                        </td>
                        <td>
                          <button
                            className={s.entityName}
                            onClick={() => setDetailId(r.id)}
                          >
                            <span className={s.avatar}>
                              {r.name.slice(0, 1)}
                            </span>
                            <span>
                              <strong>{r.name}</strong>
                              <small>
                                {r.website
                                  ? new URL(r.website).hostname
                                  : KIND_LABELS[r.kind]}
                              </small>
                            </span>
                          </button>
                        </td>
                        <td>
                          {r.website ? (
                            <a
                              href={r.website}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label={`Apri sito di ${r.name}`}
                            >
                              Apri sito ↗
                            </a>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td>
                          <span className={s.countryPill}>
                            {r.country_code || 'Mondo'}
                          </span>
                        </td>
                        <td>
                          {r.type_code
                            ? TOURISM_TYPES[r.type_code]
                            : KIND_LABELS[r.kind]}
                        </td>
                        <td>
                          <Badge status={r.status} />
                        </td>
                        <td>
                          <strong className={s.score}>
                            {score.score ?? '—'}
                          </strong>
                          <small className={s.scoreSub}>
                            {score.coverage}% documentato
                          </small>
                        </td>
                        <td>
                          <span className={r.crm?.length ? s.linked : s.muted}>
                            {r.crm?.length
                              ? 'Collegata'
                              : r.matches?.some(
                                    (match) => match.state === 'candidate'
                                  )
                                ? 'Corrispondenza da confermare'
                                : 'Da qualificare'}
                          </span>
                        </td>
                        <td>
                          {r.site_qualification?.classification
                            ? TARGET_LABELS[r.site_qualification.classification]
                            : 'Non controllato'}
                          <small className={s.scoreSub}>
                            {r.site_qualification?.sitemap_status === 'found'
                              ? r.site_qualification.sitemap_enumerated
                                ? 'Sitemap letta'
                                : 'Sitemap parziale'
                              : r.site_qualification?.sitemap_status ===
                                  'unavailable'
                                ? 'Sito non accessibile'
                                : r.site_qualification?.sitemap_status ===
                                    'not_found'
                                  ? 'Sitemap XML non trovata'
                                  : ''}
                          </small>
                        </td>
                        <td>
                          <select
                            aria-label={`Ordine di contatto di ${r.name}`}
                            title={r.outreach_note || undefined}
                            value={r.outreach_priority ?? ''}
                            disabled={busy}
                            onChange={(e) =>
                              act(async () => {
                                const priority = e.target.value
                                  ? (Number(e.target.value) as 1 | 2 | 3)
                                  : null
                                await post({
                                  action: 'set_outreach',
                                  id: r.id,
                                  version: r.version,
                                  priority
                                })
                                refresh()
                                notify(
                                  priority
                                    ? `${r.name}: ${OUTREACH_LABELS[priority]}.`
                                    : `${r.name} tolta dalla lista contatti.`
                                )
                              })
                            }
                          >
                            <option value="">Fuori lista</option>
                            {([1, 2, 3] as const).map((p) => (
                              <option key={p} value={p}>
                                {OUTREACH_LABELS[p]}
                              </option>
                            ))}
                          </select>
                          {r.outreach_note && (
                            <small className={s.scoreSub}>
                              {r.outreach_note}
                            </small>
                          )}
                        </td>
                        <td>
                          <button
                            className={s.secondary}
                            disabled={busy}
                            aria-label={`${r.disabled ? 'Riattiva' : 'Disabilita'} ${r.name}`}
                            onClick={() =>
                              act(async () => {
                                await post({
                                  action: 'set_disabled',
                                  id: r.id,
                                  version: r.version,
                                  disabled: !r.disabled
                                })
                                refresh()
                                notify(
                                  r.disabled
                                    ? 'Organizzazione riattivata.'
                                    : 'Organizzazione disabilitata; dati e storico conservati.'
                                )
                              })
                            }
                          >
                            {r.disabled ? 'Riattiva' : 'Disabilita'}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {loading && (
              <p className={s.muted} role="status">
                Caricamento risultati…
              </p>
            )}
            {!loading && !rows.length && (
              <Empty>
                Importa il campione italiano, aggiungi un’organizzazione o
                modifica i filtri.
              </Empty>
            )}
            <footer className={s.pagination}>
              <span>
                {total
                  ? `${page * 50 + 1}–${Math.min(total, (page + 1) * 50)} di ${fmt(total)}`
                  : '0 risultati'}
              </span>
              <button
                className={s.secondary}
                disabled={page === 0 || loading}
                onClick={() => setPage((p) => p - 1)}
              >
                ← Precedente
              </button>
              <button
                className={s.secondary}
                disabled={(page + 1) * 50 >= total || loading}
                onClick={() => setPage((p) => p + 1)}
              >
                Successiva →
              </button>
            </footer>
          </section>
        )}
        {tab === 'decks' && <TourismDecks />}
        {tab === 'research' && (
          <TourismResearch
            onOpen={setDetailId}
            onCountry={(code) => {
              setTab('directory')
              setFilter('country', code)
            }}
          />
        )}
        {tab === 'explorer' && (
          <section className={s.panel}>
            <div className={s.panelHeading}>
              <div>
                <span className={s.eyebrow}>RELATIONSHIP EXPLORER</span>
                <h2>Territori, organizzazioni e connessioni</h2>
                <p className={s.muted}>
                  Ogni collegamento conserva la propria fonte. Le coperture
                  possono sovrapporsi.
                </p>
              </div>
              <EntityPicker
                label="Cerca un’organizzazione nel grafo"
                onSelect={(entity) => setGraphFocus(entity.id)}
              />
              <select
                aria-label="Entità al centro del grafo"
                value={graphFocus}
                onChange={(e) => setGraphFocus(e.target.value)}
              >
                <option value="">Seleziona un’entità</option>
                {graph?.entities.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} · {KIND_LABELS[e.kind]}
                  </option>
                ))}
              </select>
            </div>
            {graph && graphFocus ? (
              <RelationshipGraph
                graph={graph}
                focus={graphFocus}
                onFocus={setGraphFocus}
                onOpen={setDetailId}
              />
            ) : (
              <div className={s.territoryGrid}>
                {graph?.entities
                  .filter((e) => e.kind === 'place')
                  .map((e) => (
                    <button
                      className={s.territoryCard}
                      key={e.id}
                      onClick={() => setGraphFocus(e.id)}
                    >
                      <Icon name="globe" />
                      <span>{e.name}</span>
                      <small>
                        {
                          graph.relations.filter(
                            (r) => r.to_id === e.id || r.from_id === e.id
                          ).length
                        }{' '}
                        connessioni nel campione visualizzato
                      </small>
                      <Icon name="arrow" />
                    </button>
                  ))}
              </div>
            )}
            {graph && !graph.entities.length && (
              <Empty>
                Il catalogo non contiene ancora territori o relazioni.
              </Empty>
            )}
            <p className={s.caption}>
              Seleziona un territorio o cerca un’organizzazione: vengono
              caricate le sue relazioni, fino a 200 per volta. I territori di
              ingresso e il vicinato selezionato sono viste parziali; le
              evidenze non caricate non vengono indicate come verificate.
            </p>
          </section>
        )}
        {tab === 'discovery' && (
          <>
            <section className={s.discoveryIntro}>
              <div className={s.sparkBox}>
                <Icon name="spark" />
              </div>
              <span className={s.eyebrow}>AI DISCOVERY CONSOLE</span>
              <h2>
                Da una domanda,
                <br />a nuove connessioni.
              </h2>
              <p>
                Descrivi il territorio e le organizzazioni da cercare.
                <br />
                Rivedi le fonti e approva i candidati prima dell’importazione.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  act(async () => {
                    const { job } = await post<{ job: DiscoveryJob }>(
                      { action: 'create', query: discoveryQuery },
                      '/api/tourism/discovery'
                    )
                    setDiscoveryQuery('')
                    refresh()
                    if (configured) {
                      try {
                        await post(
                          { action: 'run', id: job.id },
                          '/api/tourism/discovery'
                        )
                      } finally {
                        refresh()
                      }
                    } else
                      notify(
                        'Ricerca salvata in coda. Configurare il provider AI per eseguirla.'
                      )
                  })
                }}
              >
                <input
                  aria-label="Richiesta AI Discovery"
                  value={discoveryQuery}
                  onChange={(e) => setDiscoveryQuery(e.target.value)}
                  placeholder="Trova le DMO della Toscana e le rispettive fonti ufficiali…"
                  minLength={5}
                  maxLength={1000}
                  required
                />
                <button className={s.primary} disabled={busy}>
                  <Icon name="spark" />
                  {busy ? 'Ricerca in corso…' : 'Avvia ricerca'}
                </button>
              </form>
              <div className={s.prompts}>
                {[
                  'Organizzazioni turistiche regionali in Francia',
                  'DMC e DMO della Croazia',
                  'GAL e consorzi turistici della Campania'
                ].map((q) => (
                  <button key={q} onClick={() => setDiscoveryQuery(q)}>
                    {q} ↗
                  </button>
                ))}
              </div>
              {!configured && (
                <p className={s.configuration}>
                  Provider AI da configurare. Le richieste possono essere
                  salvate in coda; nessun risultato viene simulato.
                </p>
              )}
            </section>
            <section className={s.panel}>
              <div className={s.panelHeading}>
                <h2>Ricerche e candidati</h2>
                <button className={s.textButton} onClick={refresh}>
                  Aggiorna stato
                </button>
              </div>
              {!jobs.length && (
                <Empty>
                  Le tue ricerche e i candidati da approvare compariranno qui.
                </Empty>
              )}
              {jobs.map((job) => (
                <article key={job.id} className={s.job}>
                  <div className={s.panelHeading}>
                    <div>
                      <h3>{job.query}</h3>
                      <small className={s.muted}>
                        {date(job.created_at)} · {job.state} · tentativo{' '}
                        {job.attempts}/3
                      </small>
                    </div>
                    {job.state !== 'succeeded' && job.attempts < 3 && (
                      <button
                        className={s.secondary}
                        disabled={
                          busy ||
                          !configured ||
                          (job.state === 'running' &&
                            new Date(job.lease_until || 0) > new Date())
                        }
                        onClick={() =>
                          act(async () => {
                            try {
                              await post(
                                { action: 'run', id: job.id },
                                '/api/tourism/discovery'
                              )
                            } finally {
                              refresh()
                            }
                          })
                        }
                      >
                        Esegui / riprendi
                      </button>
                    )}
                  </div>
                  {job.error && <p className={s.configuration}>{job.error}</p>}
                  {job.result?.map((r, i) => (
                    <label className={s.candidate} key={`${r.name}-${i}`}>
                      <input
                        type="checkbox"
                        checked={(candidateSelection[job.id] || []).includes(i)}
                        onChange={(e) =>
                          setCandidateSelection((sel) => ({
                            ...sel,
                            [job.id]: e.target.checked
                              ? [...(sel[job.id] || []), i]
                              : (sel[job.id] || []).filter((v) => v !== i)
                          }))
                        }
                      />
                      <span>
                        <strong>{r.name}</strong>
                        <small>
                          {r.country_code} · {r.type_code} · candidato AI non
                          verificato
                        </small>
                        <a
                          href={r.evidence.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {r.evidence.title} ↗
                        </a>
                        <p>{r.evidence.excerpt}</p>
                      </span>
                    </label>
                  ))}
                  {job.state === 'succeeded' && (
                    <div className={s.actions}>
                      <span className={s.muted}>
                        {job.result.length} candidati ·{' '}
                        {String(job.usage.input_tokens ?? 'n/d')} token input ·{' '}
                        {String(job.usage.output_tokens ?? 'n/d')} output ·{' '}
                        {String(job.usage.web_search_calls || 0)} ricerche web
                      </span>
                      <button
                        className={s.primary}
                        disabled={
                          busy || !(candidateSelection[job.id] || []).length
                        }
                        onClick={() =>
                          act(async () => {
                            const r = await post<{
                              created: number
                              duplicates: number
                            }>(
                              {
                                action: 'approve',
                                id: job.id,
                                indices: candidateSelection[job.id]
                              },
                              '/api/tourism/discovery'
                            )
                            notify(
                              `${r.created} entità importate da verificare; ${r.duplicates} già presenti`
                            )
                            setCandidateSelection((sel) => ({
                              ...sel,
                              [job.id]: []
                            }))
                            refresh()
                          })
                        }
                      >
                        Approva e importa selezione
                      </button>
                    </div>
                  )}
                </article>
              ))}
            </section>
          </>
        )}
        {deckFor && (
          <DeckWizard
            entity={deckFor}
            onClose={() => setDeckFor(null)}
            onCreated={(id) => router.push(`/tourism/presentazioni/${id}`)}
          />
        )}
        <footer className={s.workspaceFooter}>
          <span>SPEAQI INTELLIGENCE</span>
          <span>
            Fonti tracciate · Revisione umana · Passaggio al CRM su approvazione
          </span>
        </footer>

        {detailId && (
          <Dialog
            title={detail?.entity.name || 'Caricamento scheda…'}
            onClose={() => setDetailId(null)}
          >
            {detail ? (
              <>
                <div className={s.detailMeta}>
                  <Badge status={detail.entity.status} />
                  <span>
                    {KIND_LABELS[detail.entity.kind]} ·{' '}
                    {countryName(detail.entity.country_code || 'IT')} · versione{' '}
                    {detail.entity.version}
                  </span>
                </div>
                <small className={s.muted}>
                  {detail.evidence.some(
                    (e) =>
                      e.status === 'VERIFIED' &&
                      e.fields.includes('description')
                  )
                    ? 'Descrizione verificata'
                    : 'Descrizione non verificata'}
                  {detail.evidence.some((e) => e.method === 'ai')
                    ? ' · estrazione AI'
                    : ''}
                </small>
                <p className={s.description}>
                  {detail.entity.details.description ||
                    'Descrizione da completare con una fonte.'}
                </p>
                <div className={s.actions}>
                  <Link className={s.secondary} href={`/tourism-lavoro?entities=${detail.entity.id}`}>Assegna al team</Link>
                  <button
                    className={s.secondary}
                    onClick={() => setModal('edit')}
                  >
                    Modifica scheda
                  </button>
                  {detail.entity.kind === 'organization' && (
                    <button
                      className={s.primary}
                      onClick={() => setDeckFor(detail.entity)}
                    >
                      Crea la presentazione
                    </button>
                  )}
                  <button
                    className={s.secondary}
                    disabled={busy}
                    onClick={() =>
                      act(async () => {
                        await apiFetch('/api/tourism', {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            id: detail.entity.id,
                            version: detail.entity.version,
                            status: 'INACTIVE'
                          })
                        })
                        refresh()
                        notify('Entità archiviata; storico conservato')
                      })
                    }
                  >
                    Archivia
                  </button>
                  {detail.entity.kind === 'organization' && !detail.contact && (
                    <button
                      className={s.primary}
                      disabled={
                        busy ||
                        detail.entity.status !== 'VERIFIED' ||
                        Boolean(detail.matches?.length)
                      }
                      onClick={() =>
                        setConfirmation({
                          label: `Aggiungere ${detail.entity.name} al CRM? Il sistema cercherà un’identità esistente e registrerà la provenienza.`,
                          run: async () => {
                            const r = await post<{ created: boolean }>({
                              action: 'promote',
                              id: detail.entity.id
                            })
                            refresh()
                            notify(
                              r.created
                                ? 'Contatto aziendale creato nel CRM'
                                : 'Contatto CRM esistente collegato'
                            )
                          }
                        })
                      }
                    >
                      Add to CRM <Icon name="arrow" />
                    </button>
                  )}
                </div>
                {!detail.contact && Boolean(detail.matches?.length) && (
                  <section className={s.detailSection}>
                    <h3>Corrispondenze nel CRM da confermare</h3>
                    <p>
                      Il confronto usa denominazione, paese e dominio. Verifica
                      l’identità e scegli il contatto corretto prima di
                      collegarlo; i recapiti esistenti saranno conservati.
                    </p>
                    {detail.matches
                      ?.filter((match) => match.contact)
                      .map((match) => (
                        <div className={s.source} key={match.id}>
                          <Link href={`/contacts/${match.contact_id}`}>
                            {match.contact?.company || match.contact?.name} ↗
                          </Link>
                          <p>
                            {match.rule === 'name_country'
                              ? 'Stessa denominazione e paese'
                              : match.rule === 'name'
                                ? 'Stessa denominazione, paese da controllare'
                                : match.rule === 'website_domain'
                                  ? 'Stesso dominio del sito'
                                  : 'Dominio email corrispondente'}{' '}
                            · corrispondenza {match.score}/100
                          </p>
                          <div className={s.actions}>
                            <button
                              className={s.primary}
                              disabled={
                                busy || detail.entity.status !== 'VERIFIED'
                              }
                              onClick={() =>
                                setConfirmation({
                                  label: `Confermi che ${detail.entity.name} corrisponde al contatto CRM selezionato? Nessun recapito sarà sovrascritto.`,
                                  run: async () => {
                                    await post({
                                      action: 'link_existing',
                                      id: detail.entity.id,
                                      contact_id: match.contact_id,
                                      version: detail.entity.version
                                    })
                                    refresh()
                                    notify(
                                      'Contatto esistente collegato; nessun duplicato creato'
                                    )
                                  }
                                })
                              }
                            >
                              Conferma collegamento
                            </button>
                            <button
                              className={s.secondary}
                              disabled={busy}
                              onClick={() =>
                                act(async () => {
                                  await post({
                                    action: 'dismiss_match',
                                    id: detail.entity.id,
                                    contact_id: match.contact_id
                                  })
                                  refresh()
                                  notify('Corrispondenza esclusa')
                                })
                              }
                            >
                              Non corrisponde
                            </button>
                          </div>
                        </div>
                      ))}
                  </section>
                )}
                <section className={s.detailSection}>
                  <h3>Identità e presenza digitale</h3>
                  <dl className={s.identityGrid}>
                    {[
                      [
                        'Categoria',
                        detail.entity.type_code
                          ? TOURISM_TYPES[detail.entity.type_code]
                          : KIND_LABELS[detail.entity.kind]
                      ],
                      ['Sito', detail.entity.website],
                      ['Email istituzionale', detail.entity.email],
                      ['Telefono pubblico', detail.entity.phone]
                    ].map(([k, v]) => (
                      <div key={k}>
                        <dt>{k}</dt>
                        <dd>
                          {k === 'Sito' && v ? (
                            <a
                              href={v}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {v} ↗
                            </a>
                          ) : (
                            v || 'Non disponibile'
                          )}
                          {[
                            'Email istituzionale',
                            'Telefono pubblico',
                            'Sito'
                          ].includes(k || '') &&
                            v && (
                              <small>
                                {detail.evidence.some(
                                  (e) =>
                                    e.status === 'VERIFIED' &&
                                    e.fields.includes(
                                      k === 'Sito'
                                        ? 'website'
                                        : k === 'Telefono pubblico'
                                          ? 'phone'
                                          : 'email'
                                    )
                                )
                                  ? 'Attributo verificato'
                                  : 'Attributo non verificato'}
                              </small>
                            )}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
                <section className={s.detailSection}>
                  <h3>Speaqi Opportunity Score</h3>
                  <ScorePanel
                    entity={detail.entity}
                    evidence={detail.evidence}
                    weights={weights}
                    onWeights={setWeights}
                    busy={busy}
                    onSaveIndicator={(r) =>
                      act(async () => {
                        await post({
                          action: 'indicator',
                          id: detail.entity.id,
                          version: detail.entity.version,
                          ...r
                        })
                        refresh()
                        notify('Valutazione salvata con fonte da revisionare')
                      })
                    }
                  />
                  <p className={s.caption}>
                    Valutazione commerciale interna, distinta dai fatti
                    verificati. I dati assenti restano sconosciuti. I pesi
                    modificati valgono per questa sessione.
                  </p>
                </section>
                <section className={s.detailSection}>
                  <h3>Fonti e verifica degli attributi</h3>
                  <p className={s.muted}>
                    Apri la fonte e controlla gli attributi elencati prima di
                    confermare. Verificare l’identità non verifica
                    automaticamente tutti i dati.
                  </p>
                  {detail.evidence.map((e) => (
                    <article className={s.source} key={e.id}>
                      <div>
                        <a
                          href={e.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {e.title} ↗
                        </a>
                        <p>{e.excerpt}</p>
                        <small>
                          Attributi: {e.fields.join(', ')}
                          <br />
                          Acquisita {date(e.acquired_at)} · {e.method}
                          <br />
                          {e.status === 'VERIFIED'
                            ? `Verificata ${date(e.verified_at)} · attore ${e.verified_by}`
                            : e.status === 'REJECTED'
                              ? 'Fonte respinta'
                              : 'In attesa di revisione'}
                        </small>
                      </div>
                      <div className={s.actions}>
                        <button
                          className={s.secondary}
                          disabled={busy}
                          onClick={() =>
                            act(async () => {
                              await post({
                                action: 'review',
                                id: detail.entity.id,
                                evidence_id: e.id,
                                version: detail.entity.version,
                                approve: false
                              })
                              refresh()
                              notify('Fonte respinta')
                            })
                          }
                        >
                          Respingi
                        </button>
                        <button
                          className={s.primary}
                          disabled={busy || e.status === 'VERIFIED'}
                          onClick={() =>
                            setConfirmation({
                              label: `Confermi di aver verificato nella fonte “${e.title}” questi attributi: ${e.fields.join(', ')}?`,
                              run: async () => {
                                await post({
                                  action: 'review',
                                  id: detail.entity.id,
                                  evidence_id: e.id,
                                  version: detail.entity.version,
                                  approve: true
                                })
                                refresh()
                                notify(
                                  'Verifica registrata con fonte, attore e data'
                                )
                              }
                            })
                          }
                        >
                          Conferma verifica
                        </button>
                      </div>
                    </article>
                  ))}
                  <EvidenceForm
                    busy={busy}
                    onSave={(e) =>
                      act(async () => {
                        await post({
                          action: 'evidence',
                          id: detail.entity.id,
                          evidence: e
                        })
                        refresh()
                        notify('Fonte aggiunta come non verificata')
                      })
                    }
                  />
                </section>
                <section className={s.detailSection}>
                  <h3>Territori e organizzazioni collegate</h3>
                  {detail.relations.length ? (
                    detail.relations.map((r) => {
                      const other = detail.neighbors.find(
                        (e) =>
                          e.id ===
                          (r.from_id === detail.entity.id ? r.to_id : r.from_id)
                      )
                      const source = (
                        detail.relationEvidence || detail.evidence
                      ).find((e) => e.id === r.evidence_id)
                      return (
                        <div className={s.relationRow} key={r.id}>
                          <span>
                            {r.from_id === detail.entity.id
                              ? RELATION_LABELS[r.relation]
                              : '← ' + RELATION_LABELS[r.relation]}
                          </span>
                          <button
                            className={s.textButton}
                            onClick={() => setDetailId(other?.id || null)}
                          >
                            {other?.name || 'Entità non caricata'}
                          </button>
                          {source ? (
                            <a
                              href={source.source_url}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {source.status === 'VERIFIED'
                                ? 'Fonte verificata'
                                : 'Fonte da verificare'}{' '}
                              ↗
                            </a>
                          ) : (
                            <small>
                              Evidenza da aprire nella scheda collegata
                            </small>
                          )}
                        </div>
                      )
                    })
                  ) : (
                    <p className={s.muted}>Nessuna relazione documentata.</p>
                  )}
                  <RelationForm
                    entity={detail.entity}
                    evidence={detail.evidence}
                    busy={busy}
                    onSave={(r) =>
                      act(async () => {
                        await post({
                          action: 'relation',
                          id: detail.entity.id,
                          ...r
                        })
                        refresh()
                        notify('Relazione documentata aggiunta')
                      })
                    }
                  />
                </section>
                {detail.contact && (
                  <section className={s.detailSection}>
                    <h3>Collegamento CRM</h3>
                    <Link href={`/contacts/${detail.contact.id}`}>
                      {detail.contact.company || detail.contact.name} ↗
                    </Link>
                    <table className={s.compare}>
                      <thead>
                        <tr>
                          <th>Attributo</th>
                          <th>Catalogo</th>
                          <th>CRM</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>Email</td>
                          <td>{detail.entity.email || '—'}</td>
                          <td>{detail.contact.email || '—'}</td>
                        </tr>
                        <tr>
                          <td>Telefono</td>
                          <td>{detail.entity.phone || '—'}</td>
                          <td>{detail.contact.phone || '—'}</td>
                        </tr>
                      </tbody>
                    </table>
                    <div className={s.actions}>
                      {[
                        { direction: 'to_crm', label: 'Catalogo → CRM' },
                        { direction: 'from_crm', label: 'CRM → Catalogo' }
                      ].map((a) => (
                        <button
                          className={s.secondary}
                          key={a.direction}
                          disabled={busy}
                          onClick={() =>
                            setConfirmation({
                              label: `${a.label}: confermi la sostituzione di email e telefono nella destinazione con i valori mostrati? L’importazione dal CRM richiede una nuova verifica.`,
                              run: async () => {
                                await post({
                                  action: 'sync',
                                  id: detail.entity.id,
                                  version: detail.entity.version,
                                  direction: a.direction
                                })
                                refresh()
                                notify('Sincronizzazione esplicita registrata')
                              }
                            })
                          }
                        >
                          {a.label}
                        </button>
                      ))}
                    </div>
                  </section>
                )}
                <section className={s.detailSection}>
                  <h3>Possibili duplicati</h3>
                  <DuplicatePanel entity={detail.entity} />
                </section>
                <section className={s.detailSection}>
                  <h3>Storico delle revisioni</h3>
                  {detail.revisions.map((r) => (
                    <div className={s.revision} key={r.id}>
                      <i />
                      <span>
                        {r.operation === 'INSERT'
                          ? 'Creazione'
                          : 'Aggiornamento'}{' '}
                        · {r.table_name.replace('tourism_', '')}
                        <small>
                          {date(r.created_at)} · {r.actor_id}
                        </small>
                      </span>
                    </div>
                  ))}
                </section>
              </>
            ) : (
              <p role="status">Caricamento scheda e fonti…</p>
            )}
          </Dialog>
        )}
        {modal === 'import' && (
          <Dialog
            title="Importa organizzazioni e territori"
            onClose={() => setModal(null)}
          >
            <p className={s.muted}>
              CSV, TSV o JSON · massimo 200 record e 1 MB per batch. Le righe
              esistenti non vengono sovrascritte.
            </p>
            <p className={s.caption}>
              CSV: name, country_code, type_code, website, source_url,
              source_title, email, phone. Per Excel, esporta il foglio in CSV
              UTF-8.
            </p>
            <input
              type="file"
              aria-label="File da importare"
              accept=".csv,.tsv,.json"
              onChange={(e) => {
                const f = e.target.files?.[0]
                setPreview(null)
                if (f) {
                  if (f.size > 1_000_000)
                    setError('File troppo grande (massimo 1 MB)')
                  else f.text().then(setImportText)
                }
              }}
            />
            <textarea
              className={s.importArea}
              aria-label="Dati da importare"
              value={importText}
              onChange={(e) => {
                setImportText(e.target.value)
                setPreview(null)
              }}
              placeholder={
                'name,country_code,type_code,website,source_url\nOrganizzazione,IT,dmo,https://example.com,https://example.com/about'
              }
            />
            <div className={s.actions}>
              <button
                className={s.secondary}
                disabled={busy || !importText.trim()}
                onClick={() =>
                  act(async () => {
                    setPreview(
                      await post({ action: 'preview', text: importText })
                    )
                  })
                }
              >
                Controlla e mostra anteprima
              </button>
              <button
                className={s.primary}
                disabled={
                  busy || !preview?.records.length || !!preview.errors.length
                }
                onClick={() =>
                  act(async () => {
                    const r = await post<{
                      created: number
                      duplicates: number
                    }>({ action: 'import', records: preview!.records })
                    notify(
                      `${r.created} nuove entità, ${r.duplicates} duplicati esatti ignorati`
                    )
                    setModal(null)
                    setImportText('')
                    setPreview(null)
                    refresh()
                  })
                }
              >
                Approva importazione
              </button>
            </div>
            {preview && (
              <div className={s.importPreview}>
                <strong>
                  {preview.records.length} valide / {preview.total} righe
                </strong>
                {preview.errors.map((e) => (
                  <p key={e.row} className={s.error}>
                    Riga {e.row}: {e.message}
                  </p>
                ))}
                {preview.records.map((r, i) => (
                  <div key={i} className={s.previewRow}>
                    <strong>{r.name}</strong>
                    <span>
                      {r.country_code} · {r.type_code || r.kind}
                    </span>
                    <small>{r.evidence.source_url}</small>
                  </div>
                ))}
              </div>
            )}
          </Dialog>
        )}
        {(modal === 'new' || modal === 'edit') && (
          <Dialog
            title={
              modal === 'edit'
                ? 'Modifica organizzazione o entità'
                : 'Nuova organizzazione'
            }
            onClose={() => setModal(null)}
          >
            <EntityForm
              entity={modal === 'edit' ? detail?.entity : undefined}
              busy={busy}
              onSave={(record) =>
                act(async () => {
                  if (modal === 'edit' && detail) {
                    await apiFetch('/api/tourism', {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        id: detail.entity.id,
                        version: detail.entity.version,
                        record
                      })
                    })
                    notify(
                      'Modifica salvata. Le verifiche precedenti richiedono revisione.'
                    )
                  } else {
                    const r = await post<{ created: number }>({
                      action: 'create',
                      record
                    })
                    notify(
                      r.created
                        ? 'Organizzazione aggiunta da verificare'
                        : 'Identità già presente: nessun duplicato creato'
                    )
                  }
                  setModal(null)
                  refresh()
                })
              }
            />
          </Dialog>
        )}
        {confirmation && (
          <Dialog
            title="Conferma operazione"
            onClose={() => setConfirmation(null)}
          >
            <p className={s.description}>{confirmation.label}</p>
            <div className={s.actions}>
              <button
                className={s.secondary}
                onClick={() => setConfirmation(null)}
              >
                Annulla
              </button>
              <button
                className={s.primary}
                disabled={busy}
                onClick={() =>
                  act(async () => {
                    await confirmation.run()
                    setConfirmation(null)
                  })
                }
              >
                Conferma
              </button>
            </div>
          </Dialog>
        )}
      </div>
    </DialogFeedback.Provider>
  )
}

function EntityForm({
  entity,
  busy,
  onSave
}: {
  entity?: TourismEntity
  busy: boolean
  onSave: (r: unknown) => void
}) {
  const [name, setName] = useState(entity?.name || ''),
    [country, setCountry] = useState(entity?.country_code || 'IT'),
    [type, setType] = useState(entity?.type_code || 'dmo'),
    [website, setWebsite] = useState(entity?.website || ''),
    [email, setEmail] = useState(entity?.email || ''),
    [phone, setPhone] = useState(entity?.phone || ''),
    [description, setDescription] = useState(entity?.details.description || ''),
    [source, setSource] = useState(''),
    [sourceTitle, setSourceTitle] = useState('')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    onSave({
      kind: entity?.kind || 'organization',
      name,
      country_code: country,
      type_code: type,
      website: website || null,
      email: email || null,
      phone: phone || null,
      details: { ...entity?.details, description },
      aliases: entity?.aliases || [],
      external_ids: entity?.external_ids || {},
      evidence: {
        source_url: source,
        title: sourceTitle,
        excerpt: description,
        fields: [
          'name',
          'country_code',
          'type_code',
          ...(website ? ['website'] : []),
          ...(email ? ['email'] : []),
          ...(phone ? ['phone'] : [])
        ]
      }
    })
  }
  return (
    <form className={s.form} onSubmit={submit}>
      <label>
        Denominazione ufficiale
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={200}
        />
      </label>
      <div className={s.formGrid}>
        <label>
          Paese · codice ISO
          <input
            required
            value={country}
            onChange={(e) => setCountry(e.target.value.toUpperCase())}
            minLength={2}
            maxLength={2}
          />
        </label>
        <label>
          Categoria
          <select
            value={type}
            onChange={(e) => setType(e.target.value as 'dmo')}
          >
            {Object.entries(TOURISM_TYPES).map(([k, v]) => (
              <option value={k} key={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          Sito ufficiale
          <input
            type="url"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />
        </label>
        <label>
          Email istituzionale pubblica
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          Telefono pubblico
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            maxLength={80}
          />
        </label>
      </div>
      <label>
        Descrizione documentata
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={2000}
        />
      </label>
      {!entity && (
        <>
          <label>
            URL della fonte
            <input
              required
              type="url"
              value={source}
              onChange={(e) => setSource(e.target.value)}
            />
          </label>
          <label>
            Titolo della fonte
            <input
              required
              value={sourceTitle}
              onChange={(e) => setSourceTitle(e.target.value)}
              maxLength={300}
            />
          </label>
        </>
      )}
      <p className={s.caption}>
        {entity
          ? 'Una modifica invalida le attestazioni precedenti; aggiungi e verifica la fonte aggiornata dalla scheda.'
          : 'Inserisci solo recapiti istituzionali pubblici. I dati vengono salvati da verificare.'}
      </p>
      <button className={s.primary} disabled={busy}>
        Salva scheda
      </button>
    </form>
  )
}
function EvidenceForm({
  busy,
  onSave
}: {
  busy: boolean
  onSave: (r: unknown) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  return (
    <details
      className={s.inlineForm}
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>Aggiungi una fonte</summary>
      <form
        className={s.form}
        onSubmit={async (e) => {
          e.preventDefault()
          const form = e.currentTarget
          const f = new FormData(form)
          await onSave({
            source_url: f.get('url'),
            title: f.get('title'),
            excerpt: f.get('excerpt'),
            fields: String(f.get('fields') || '')
              .split(',')
              .map((v) => v.trim())
              .filter(Boolean)
          })
        }}
      >
        <label>
          URL pubblico
          <input name="url" type="url" required />
        </label>
        <label>
          Titolo
          <input name="title" required maxLength={300} />
        </label>
        <label>
          Attributi documentati · separati da virgola
          <input
            name="fields"
            required
            defaultValue="name,country_code,type_code"
          />
        </label>
        <small className={s.muted}>
          Attributi disponibili: name, country_code, type_code, website, email,
          phone, description, coverage, relationship, indicator:map_need (e gli
          altri fattori score).
        </small>
        <label>
          Nota di riscontro
          <textarea name="excerpt" maxLength={2000} />
        </label>
        <button className={s.secondary} disabled={busy}>
          Aggiungi fonte da verificare
        </button>
      </form>
    </details>
  )
}
function RelationForm({
  entity,
  evidence,
  busy,
  onSave
}: {
  entity: TourismEntity
  evidence: Evidence[]
  busy: boolean
  onSave: (r: Record<string, unknown>) => Promise<void>
}) {
  const [candidates, setCandidates] = useState<TourismEntity[]>([]),
    [search, setSearch] = useState('')
  useEffect(() => {
    let live = true
    const t = setTimeout(() => {
      if (search.length < 2) {
        setCandidates([])
        return
      }
      apiFetch<{ entities: TourismEntity[] }>(
        `/api/tourism?kind=place&q=${encodeURIComponent(search)}`
      )
        .then((r) => {
          if (live) setCandidates(r.entities.filter((c) => c.id !== entity.id))
        })
        .catch(() => {
          if (live) setCandidates([])
        })
    }, 300)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [search, entity.id])
  return (
    <details className={s.inlineForm}>
      <summary>Collega un territorio catalogato</summary>
      <form
        className={s.form}
        onSubmit={async (e) => {
          e.preventDefault()
          const form = e.currentTarget
          const f = new FormData(form)
          await onSave({
            to_id: f.get('to'),
            relation: f.get('relation'),
            evidence_id: f.get('evidence')
          })
          setSearch('')
        }}
      >
        <label>
          Cerca territorio
          <input value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <label>
          Territorio
          <select required name="to">
            <option value="">Scegli un risultato</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Relazione
          <select name="relation">
            {(entity.kind === 'place'
              ? ['PART_OF']
              : ['PROMOTES', 'MANAGES', 'COVERS']
            ).map((k) => (
              <option key={k} value={k}>
                {RELATION_LABELS[k as 'COVERS']}
              </option>
            ))}
          </select>
        </label>
        <label>
          Fonte della relazione
          <select required name="evidence">
            <option value="">
              Seleziona una fonte con coverage o relationship
            </option>
            {evidence
              .filter((e) =>
                e.fields.some((f) => ['coverage', 'relationship'].includes(f))
              )
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title} · {e.status}
                </option>
              ))}
          </select>
        </label>
        <button
          className={s.secondary}
          disabled={busy || !['place', 'organization'].includes(entity.kind)}
        >
          Collega territorio
        </button>
      </form>
    </details>
  )
}
function DuplicatePanel({ entity }: { entity: TourismEntity }) {
  const [hints, setHints] = useState<ReturnType<typeof duplicateHints>>([]),
    [loaded, setLoaded] = useState(false)
  useEffect(() => {
    let live = true
    apiFetch<Graph>('/api/tourism?view=graph')
      .then((g) => {
        if (live) {
          setHints(
            duplicateHints(
              entity,
              g.entities.filter(
                (e) => e.id !== entity.id && e.kind === entity.kind
              )
            )
          )
          setLoaded(true)
        }
      })
      .catch(() => {
        if (live) setLoaded(false)
      })
    return () => {
      live = false
    }
  }, [entity])
  return (
    <>
      {!loaded ? (
        <p className={s.muted}>Controllo non disponibile.</p>
      ) : hints.length ? (
        hints.map((h) => (
          <p className={s.muted} key={h.candidate.id}>
            <strong>{h.candidate.name}</strong> · {h.reasons.join(' · ')}
          </p>
        ))
      ) : (
        <p className={s.muted}>
          Nessuna corrispondenza tra le prime 500 entità. Nessuna fusione
          automatica per dominio o email condivisi.
        </p>
      )}
    </>
  )
}
function ScorePanel({
  entity,
  evidence,
  weights,
  onWeights,
  busy,
  onSaveIndicator
}: {
  entity: TourismEntity
  evidence: Evidence[]
  weights: Partial<Record<FactorKey, number>>
  onWeights: (v: Partial<Record<FactorKey, number>>) => void
  busy: boolean
  onSaveIndicator: (r: Record<string, unknown>) => Promise<void>
}) {
  const score = opportunityScore(entity, evidence, weights)
  return (
    <>
      <div className={s.scoreSummary}>
        <strong>
          {score.score ?? '—'}
          <small>/100</small>
        </strong>
        <span>
          {score.priority}
          <small>
            {score.coverage}% degli indicatori ponderati documentato · soglia
            minima 60%
          </small>
        </span>
      </div>
      <details className={s.inlineForm}>
        <summary>Fattori, fonti e pesi della valutazione</summary>
        {score.factors.map((f) => (
          <div className={s.factor} key={f.key}>
            <span>
              {f.label}
              <small>
                {f.value === null
                  ? 'Dato non verificato o assente'
                  : f.rationale}
              </small>
              {f.source_url && (
                <a
                  href={f.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Fonte ↗
                </a>
              )}
            </span>
            <b>{f.value ?? '—'}</b>
            <label>
              Peso{' '}
              <input
                aria-label={`Peso ${f.label}`}
                type="number"
                min={0}
                max={100}
                value={weights[f.key] ?? SCORE_FACTORS[f.key].weight}
                onChange={(e) =>
                  onWeights({
                    ...weights,
                    [f.key]: Math.max(0, Math.min(100, Number(e.target.value)))
                  })
                }
              />
            </label>
          </div>
        ))}
      </details>
      <details className={s.inlineForm}>
        <summary>Aggiungi una valutazione documentata</summary>
        <form
          className={s.form}
          onSubmit={(e) => {
            e.preventDefault()
            const data = new FormData(e.currentTarget)
            onSaveIndicator({
              factor: data.get('factor'),
              value: Number(data.get('value')),
              source_url: data.get('url'),
              rationale: data.get('rationale')
            })
          }}
        >
          <label>
            Fattore
            <select name="factor">
              {Object.entries(SCORE_FACTORS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Valutazione 0–100
            <input
              required
              name="value"
              type="number"
              min={0}
              max={100}
              step={1}
            />
          </label>
          <label>
            Fonte pubblica
            <input required name="url" type="url" />
          </label>
          <label>
            Motivazione verificabile
            <textarea required name="rationale" minLength={2} maxLength={500} />
          </label>
          <p className={s.caption}>
            100 indica maggiore opportunità per Speaqi. L’assenza di
            informazioni non documenta l’assenza di servizi. Il salvataggio
            richiede una nuova revisione delle fonti della scheda.
          </p>
          <button className={s.secondary} disabled={busy}>
            Salva valutazione da verificare
          </button>
        </form>
      </details>
    </>
  )
}
function RelationshipGraph({
  graph,
  focus,
  onFocus,
  onOpen
}: {
  graph: Graph
  focus: string
  onFocus: (id: string) => void
  onOpen: (id: string) => void
}) {
  const center = graph.entities.find((e) => e.id === focus)
  const edges = graph.relations
    .filter((r) => r.from_id === focus || r.to_id === focus)
    .slice(0, 12)
  if (!center) return <Empty>Entità non disponibile in questa vista.</Empty>
  return (
    <>
      <div className={s.graph}>
        <svg
          viewBox="0 0 900 430"
          role="img"
          aria-label={`Relazioni documentate di ${center.name}`}
        >
          <defs>
            <pattern
              id="tourism-dots"
              width="18"
              height="18"
              patternUnits="userSpaceOnUse"
            >
              <circle cx="1" cy="1" r="1" fill="#dbe5e1" />
            </pattern>
          </defs>
          <rect width="900" height="430" fill="url(#tourism-dots)" />
          {edges.map((r, i) => {
            const other = graph.entities.find(
              (e) => e.id === (r.from_id === focus ? r.to_id : r.from_id)
            )
            if (!other) return null
            const angle = (2 * Math.PI * i) / Math.max(1, edges.length)
            const x = 450 + 300 * Math.cos(angle),
              y = 215 + 155 * Math.sin(angle)
            const ev = graph.evidence.find((e) => e.id === r.evidence_id)
            return (
              <g key={r.id}>
                <line
                  x1="450"
                  y1="215"
                  x2={x}
                  y2={y}
                  stroke={ev?.status === 'VERIFIED' ? '#147d64' : '#90a5a0'}
                  strokeWidth="1.5"
                  strokeDasharray={ev?.status === 'VERIFIED' ? '' : '5 4'}
                />
                <g
                  role="button"
                  tabIndex={0}
                  aria-label={`Esplora ${other.name}`}
                  onClick={() => onFocus(other.id)}
                  onKeyDown={(e) => {
                    if (['Enter', ' '].includes(e.key)) {
                      e.preventDefault()
                      onFocus(other.id)
                    }
                  }}
                >
                  <rect
                    x={x - 100}
                    y={y - 25}
                    width="200"
                    height="50"
                    rx="10"
                    fill="white"
                    stroke="#dbe5e1"
                  />
                  <text
                    x={x}
                    y={y - 3}
                    textAnchor="middle"
                    fill="#173a31"
                    fontSize="12"
                  >
                    {other.name.length > 25
                      ? other.name.slice(0, 24) + '…'
                      : other.name}
                  </text>
                  <text
                    x={x}
                    y={y + 14}
                    textAnchor="middle"
                    fill="#697f78"
                    fontSize="10"
                  >
                    {RELATION_LABELS[r.relation]} ·{' '}
                    {ev?.status === 'VERIFIED' ? 'verificata' : 'da verificare'}
                  </text>
                </g>
              </g>
            )
          })}
          <rect
            x="310"
            y="180"
            width="280"
            height="70"
            rx="14"
            fill="#173e33"
          />
          <text x="450" y="210" fill="white" fontSize="14" textAnchor="middle">
            {center.name.length > 34
              ? center.name.slice(0, 33) + '…'
              : center.name}
          </text>
          <text
            x="450"
            y="231"
            fill="#b9d7ca"
            fontSize="11"
            textAnchor="middle"
          >
            {KIND_LABELS[center.kind]} · {center.country_code}
          </text>
        </svg>
      </div>
      <div className={s.actions}>
        <button className={s.primary} onClick={() => onOpen(focus)}>
          Apri scheda e fonti
        </button>
        <span className={s.muted}>
          Linea continua: fonte verificata · tratteggiata: da verificare
        </span>
      </div>
      {edges.map((r) => {
        const other = graph.entities.find(
          (e) => e.id === (r.from_id === focus ? r.to_id : r.from_id)
        )
        const evidence = graph.evidence.find((e) => e.id === r.evidence_id)
        return (
          <div className={s.relationRow} key={r.id}>
            <button
              className={s.textButton}
              onClick={() => onFocus(other?.id || focus)}
            >
              {other?.name || 'Entità oltre il limite della vista'}
            </button>
            <span>{RELATION_LABELS[r.relation]}</span>
            {evidence ? (
              <a
                href={evidence.source_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Fonte ↗
              </a>
            ) : (
              <small>Evidenza non caricata</small>
            )}
          </div>
        )
      })}
    </>
  )
}
