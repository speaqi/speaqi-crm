'use client'
import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { apiFetch } from '@/lib/api'
import {
  estimateCrawlCost,
  COST_ASSUMPTIONS,
  type SiteSource,
  type PoiCandidate
} from '@/lib/tourism-research'
import type { TourismEntity, Evidence } from '@/lib/tourism'
import { TARGET_LABELS } from '@/lib/tourism-site-qualification'
import s from './research.module.css'

const PoiPreview = dynamic(() => import('./PoiPreview'), { ssr: false })
const endpoint = '/api/tourism/research'
const post = <T,>(body: unknown) =>
  apiFetch<T>(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
const number = (n: number) => new Intl.NumberFormat('it-IT').format(n)
const when = (v: string | null) =>
  v ? new Date(v).toLocaleString('it-IT') : 'Mai'
const download = (
  value: string,
  name: string,
  type = 'text/csv;charset=utf-8'
) => {
  const u = URL.createObjectURL(new Blob([value], { type })),
    a = document.createElement('a')
  a.href = u
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(u), 1000)
}
type Overview = {
  qualification_pending?: number
  qualification_checked?: number
  worker_available: boolean
  sources: number
  enabled: number
  scanned: number
  destination_confirmed: number
  poi_candidates: number
  geocoded: number
  approved_poi: number
  requests_last_30_days: number
  opportunities: number
  stages: Record<string, number>
  project_statuses: Record<string, number>
  coverage: {
    country_code: string
    organizations: number
    verified: number
    with_website: number
    nto: number
    rto: number
    local_destinations: number
    dmc: number
    ota: number
    official_denominator: null
  }[]
}
type Poi = PoiCandidate & {
  id: string
  state: string
  reuse_status: string
  reuse_url: string | null
}
type SourceDetail = {
  source: SiteSource
  scans: {
    id: string
    state: string
    finished_at: string
    requests: number
    changes: { baseline: boolean; added: number; not_observed_again?: number }
  }[]
  pois: Poi[]
  total: number
  page: number
}
type ReviewEntity = TourismEntity & { evidence: Evidence[] }
type Opportunity = {
  id: string
  entity_id: string
  title: string
  project_kind: string
  stage: string
  responsible: string
  next_action: string
  source_url: string
  rationale: string
  project_status: string | null
  platform_project_url: string | null
  version: number
}
const STAGES: Record<string, string> = {
  research: 'Ricerca',
  meeting: 'Incontro',
  demo_prepared: 'Demo preparata',
  proposal: 'Proposta',
  won: 'Vinta',
  lost: 'Persa'
}
const PROJECTS: Record<string, string> = {
  destination_map: 'Mappa di destinazione',
  multilingual_guide: 'Guida multilingua',
  ai_concierge: 'AI Concierge',
  qr_network: 'Rete di QR'
}

export function EntityPicker({
  label,
  onSelect
}: {
  label: string
  onSelect: (e: TourismEntity) => void
}) {
  const [query, setQuery] = useState(''),
    [rows, setRows] = useState<TourismEntity[]>([]),
    [error, setError] = useState('')
  useEffect(() => {
    let live = true
    const t = setTimeout(() => {
      if (query.trim().length < 2) {
        setRows([])
        return
      }
      apiFetch<{ entities: TourismEntity[] }>(
        '/api/tourism?kind=organization&q=' + encodeURIComponent(query)
      )
        .then((r) => {
          if (live) {
            setRows(r.entities.slice(0, 10))
            setError('')
          }
        })
        .catch((e) => {
          if (live) setError(e.message)
        })
    }, 300)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [query])
  return (
    <div>
      <label>
        {label}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Cerca nel catalogo…"
        />
      </label>
      {error && <small role="alert">{error}</small>}
      {rows.length > 0 && (
        <div className={s.picker}>
          {rows.map((e) => (
            <button
              type="button"
              key={e.id}
              onClick={() => {
                onSelect(e)
                setQuery(e.name)
                setRows([])
              }}
            >
              {e.name} · {e.country_code}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function TourismResearch({
  onOpen,
  onCountry
}: {
  onOpen: (id: string) => void
  onCountry: (code: string) => void
}) {
  const [tab, setTab] = useState('sites'),
    [reload, setReload] = useState(0),
    [overview, setOverview] = useState<Overview | null>(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false)
  const [sources, setSources] = useState<SiteSource[]>([]),
    [total, setTotal] = useState(0),
    [page, setPage] = useState(0),
    [country, setCountry] = useState(''),
    [sourceAvailability, setSourceAvailability] = useState('active'),
    [query, setQuery] = useState(''),
    [sourceId, setSourceId] = useState(''),
    [detail, setDetail] = useState<SourceDetail | null>(null),
    [poiPage, setPoiPage] = useState(0)
  const [review, setReview] = useState<ReviewEntity[]>([]),
    [reviewTotal, setReviewTotal] = useState(0),
    [reviewPage, setReviewPage] = useState(0),
    [selection, setSelection] = useState<Record<string, string>>({}),
    [attested, setAttested] = useState(false)
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]),
    [canonical, setCanonical] = useState<
      {
        id: string
        duplicate_id: string
        canonical_id: string
        reason: string
      }[]
    >([]),
    [duplicate, setDuplicate] = useState<TourismEntity | null>(null),
    [canonicalEntity, setCanonicalEntity] = useState<TourismEntity | null>(null)
  const refresh = () => setReload((n) => n + 1)
  const act = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await fn()
      refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Operazione fallita')
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    let live = true
    apiFetch<Overview>(endpoint + '?view=overview')
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
    if (!overview?.qualification_pending) return
    const timer = setInterval(() => {
      apiFetch<Overview>(endpoint + '?view=overview')
        .then(setOverview)
        .catch(() => {})
    }, 30000)
    return () => clearInterval(timer)
  }, [overview?.qualification_pending])
  useEffect(() => {
    if (tab !== 'sites') return
    let live = true
    apiFetch<{ sources: SiteSource[]; total: number }>(
      endpoint +
        '?' +
        new URLSearchParams({
          page: String(page),
          country,
          q: query,
          availability: sourceAvailability
        })
    )
      .then((r) => {
        if (live) {
          setSources(r.sources)
          setTotal(r.total)
        }
      })
      .catch((e) => {
        if (live) setError(e.message)
      })
    return () => {
      live = false
    }
  }, [tab, page, country, query, sourceAvailability, reload])
  useEffect(() => {
    if (!sourceId) {
      setDetail(null)
      return
    }
    let live = true
    setDetail(null)
    apiFetch<SourceDetail>(endpoint + `?source_id=${sourceId}&page=${poiPage}`)
      .then((r) => {
        if (live) setDetail(r)
      })
      .catch((e) => {
        if (live) setError(e.message)
      })
    return () => {
      live = false
    }
  }, [sourceId, poiPage, reload])
  useEffect(() => {
    if (tab !== 'review') return
    let live = true
    apiFetch<{ entities: ReviewEntity[]; total: number }>(
      endpoint +
        '?' +
        new URLSearchParams({
          view: 'review',
          page: String(reviewPage),
          country
        })
    )
      .then((r) => {
        if (live) {
          setReview(r.entities)
          setReviewTotal(r.total)
          setSelection({})
          setAttested(false)
        }
      })
      .catch((e) => {
        if (live) setError(e.message)
      })
    apiFetch<{ rows: typeof canonical }>(endpoint + '?view=canonical')
      .then((r) => {
        if (live) setCanonical(r.rows)
      })
      .catch((e) => {
        if (live) setError(e.message)
      })
    return () => {
      live = false
    }
  }, [tab, reviewPage, country, reload])
  useEffect(() => {
    if (tab !== 'opportunities') return
    let live = true
    apiFetch<{ rows: Opportunity[] }>(endpoint + '?view=opportunities')
      .then((r) => {
        if (live) setOpportunities(r.rows)
      })
      .catch((e) => {
        if (live) setError(e.message)
      })
    return () => {
      live = false
    }
  }, [tab, reload])
  return (
    <section className={s.workspace}>
      <div className={s.intro}>
        <div>
          <small>RICERCA E SVILUPPO COMMERCIALE</small>
          <h2>Dai portali turistici ai progetti Speaqi</h2>
          <p>
            Conferma le destinazioni, misura i cataloghi e prepara mappe e guide
            con fonti documentate.
          </p>
        </div>
        <button
          disabled={busy}
          onClick={() =>
            act(async () => {
              const r = await apiFetch<{ csv: string }>(
                endpoint + '?view=export'
              )
              download(r.csv, 'siti-destinazioni.csv')
            })
          }
        >
          Esporta elenco siti
        </button>
      </div>
      {overview && (
        <div className={s.stats}>
          {[
            [overview.sources, 'Siti nel registro'],
            [overview.scanned, 'Siti analizzati'],
            [overview.destination_confirmed, 'Destinazioni confermate'],
            [overview.poi_candidates, 'Schede candidate'],
            [overview.geocoded, 'Con coordinate'],
            [overview.approved_poi, 'Schede approvate']
          ].map(([v, l]) => (
            <div key={String(l)}>
              <strong>{number(Number(v))}</strong>
              <span>{l}</span>
            </div>
          ))}
        </div>
      )}
      <nav className={s.tabs} aria-label="Ricerca destinazioni">
        {[
          ['sites', 'Siti e mappe'],
          ['review', 'Verifiche e duplicati'],
          ['coverage', 'Lacune territoriali'],
          ['opportunities', 'Progetti e attività'],
          ['costs', 'Volumi e costi']
        ].map(([key, label]) => (
          <button
            aria-current={tab === key ? 'page' : undefined}
            className={tab === key ? s.active : ''}
            key={key}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </nav>
      {error && (
        <div className={s.error} role="alert">
          {error}
        </div>
      )}
      {overview && !overview.worker_available && (
        <p className={s.error}>
          I controlli periodici non sono disponibili su questo server. Puoi
          eseguire le analisi manuali.
        </p>
      )}
      {notice && (
        <div className={s.notice} role="status">
          {notice}
        </div>
      )}
      {tab === 'sites' && (
        <>
          <div className={s.toolbar}>
            <input
              aria-label="Cerca sito"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setPage(0)
              }}
              placeholder="Cerca una destinazione…"
            />
            <Country
              value={country}
              onChange={(v) => {
                setCountry(v)
                setPage(0)
              }}
              overview={overview}
            />
            <button
              disabled={busy}
              onClick={() =>
                act(async () => {
                  const r = await post<{ added: number; queued: number }>({
                    action: 'register_candidates'
                  })
                  setNotice(
                    `${r.added} nuovi URL registrati; ${r.queued} controlli sitemap in coda. Le esclusioni manuali vengono rispettate.`
                  )
                })
              }
            >
              Controlla tutti gli URL
            </button>
            <button onClick={refresh}>Aggiorna esiti</button>
            <select
              aria-label="Disponibilità dei siti"
              value={sourceAvailability}
              onChange={(e) => {
                setSourceAvailability(e.target.value)
                setPage(0)
              }}
            >
              <option value="active">Siti attivi</option>
              <option value="disabled">Siti disabilitati</option>
            </select>
          </div>
          <p>
            Controllo sitemap: {number(overview?.qualification_checked || 0)}{' '}
            siti controllati · {number(overview?.qualification_pending || 0)} in
            coda. Il controllo comprende anche i siti classificati DMC, incoming
            e OTA.
          </p>
          <p className={s.muted}>
            Le categorie del catalogo generano candidati: il ruolo ufficiale e
            la natura di destinazione richiedono conferma. I conteggi degli URL
            non equivalgono al numero di luoghi.
          </p>
          <div className={s.table}>
            <table>
              <thead>
                <tr>
                  <th>Destinazione / sito</th>
                  <th>Paese</th>
                  <th>Identità</th>
                  <th>Ultimo controllo</th>
                  <th>Sitemap e destinazione</th>
                  <th>Osservato</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sources.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.label}</strong>
                      <a href={r.url} target="_blank" rel="noreferrer">
                        {new URL(r.url).hostname}
                      </a>
                    </td>
                    <td>{r.country_code}</td>
                    <td>
                      {r.official_status === 'confirmed' &&
                      r.destination_status === 'confirmed'
                        ? 'Confermata'
                        : r.destination_status === 'rejected'
                          ? 'Esclusa'
                          : 'Da verificare'}
                    </td>
                    <td>
                      {when(r.last_scanned_at)}
                      <small>
                        {r.last_state || 'Non analizzato'} ·{' '}
                        {r.qualification_pending
                          ? 'Controllo XML in coda'
                          : r.enabled
                            ? 'Periodico attivo'
                            : 'Controllo singolo'}
                      </small>
                    </td>
                    <td>
                      {r.latest_report?.target_check
                        ? TARGET_LABELS[
                            r.latest_report.target_check.classification
                          ]
                        : 'Non controllato'}
                      <small>
                        {r.latest_report?.sitemap?.status === 'found'
                          ? r.latest_report.sitemap.enumeration_complete
                            ? 'Sitemap letta'
                            : 'Sitemap parziale'
                          : r.latest_report?.sitemap?.status === 'unavailable'
                            ? 'Non accessibile'
                            : r.latest_report?.sitemap?.status === 'not_found'
                              ? 'XML non trovata'
                              : ''}
                      </small>
                    </td>
                    <td>
                      {r.latest_report
                        ? `${r.latest_report.candidates.length} schede · ${r.latest_report.geocoded_candidates} coordinate`
                        : '—'}
                    </td>
                    <td>
                      <button
                        onClick={() => {
                          setSourceId(r.id)
                          setPoiPage(0)
                        }}
                      >
                        Analizza
                      </button>
                      <button
                        disabled={busy}
                        onClick={() =>
                          act(async () => {
                            await post({
                              action: 'source_settings',
                              id: r.id,
                              version: r.version,
                              excluded: !r.excluded
                            })
                            setNotice(
                              r.excluded
                                ? 'Sito riattivato.'
                                : 'Sito disabilitato; dati e storico conservati.'
                            )
                          })
                        }
                      >
                        {r.excluded ? 'Riattiva sito' : 'Disabilita sito'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!sources.length && (
              <p>
                Nessun sito in questa selezione. Usa “Controlla tutti gli URL”
                per preparare il registro.
              </p>
            )}
          </div>
          <Pager page={page} size={50} total={total} onChange={setPage} />
          <details className={s.card}>
            <summary>Aggiungi un portale pubblico</summary>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                const f = new FormData(e.currentTarget)
                act(async () => {
                  const r = await post<{ source: SiteSource }>({
                    action: 'register',
                    label: f.get('label'),
                    url: f.get('url'),
                    country_code: String(f.get('country')).toUpperCase()
                  })
                  setSourceId(r.source.id)
                  setNotice('Sito candidato aggiunto.')
                })
              }}
            >
              <div className={s.formGrid}>
                <label>
                  Nome
                  <input name="label" required minLength={2} />
                </label>
                <label>
                  URL
                  <input name="url" type="url" required />
                </label>
                <label>
                  Paese ISO
                  <input
                    name="country"
                    required
                    pattern="[A-Za-z]{2}"
                    maxLength={2}
                  />
                </label>
              </div>
              <button disabled={busy}>Registra candidato</button>
            </form>
          </details>
          {detail && (
            <SourcePanel
              key={
                detail.source.id + ':' + detail.source.version + ':' + poiPage
              }
              detail={detail}
              busy={busy}
              act={act}
              notice={setNotice}
              onOpen={onOpen}
              onPage={setPoiPage}
            />
          )}
        </>
      )}
      {tab === 'review' && (
        <>
          <div className={s.toolbar}>
            <h3>Verifica delle identità</h3>
            <Country
              value={country}
              onChange={(v) => {
                setCountry(v)
                setReviewPage(0)
              }}
              overview={overview}
            />
          </div>
          <p>
            Apri ogni fonte e controlla nome, paese e categoria. Seleziona
            soltanto i casi accertati; le ambiguità richiedono la scheda
            individuale.
          </p>
          <div className={s.table}>
            <table>
              <thead>
                <tr>
                  <th>Seleziona</th>
                  <th>Organizzazione</th>
                  <th>Fonte da attestare</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {review.map((e) => {
                  const evidence = e.evidence.filter(
                      (v) =>
                        v.status !== 'REJECTED' &&
                        ['name', 'country_code', 'type_code'].every((k) =>
                          v.fields.includes(k)
                        )
                    ),
                    ambiguous = Boolean(
                      e.details.scope_requires_review ||
                        e.details.identity_requires_review
                    )
                  return (
                    <tr key={e.id}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={'Verifica ' + e.name}
                          checked={Boolean(selection[e.id])}
                          disabled={ambiguous || !evidence.length || busy}
                          onChange={(v) =>
                            setSelection((prev) => {
                              const next = { ...prev }
                              if (v.target.checked) next[e.id] = evidence[0].id
                              else delete next[e.id]
                              return next
                            })
                          }
                        />
                      </td>
                      <td>
                        <strong>{e.name}</strong>
                        <small>
                          {e.country_code} · {e.type_code}
                          {ambiguous ? ' · Identità ambigua' : ''}
                        </small>
                      </td>
                      <td>
                        {evidence.map((v) => (
                          <div key={v.id}>
                            <a
                              href={v.source_url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {v.title}
                            </a>
                            {selection[e.id] && (
                              <input
                                aria-label={'Usa fonte ' + v.title}
                                type="radio"
                                checked={selection[e.id] === v.id}
                                onChange={() =>
                                  setSelection((prev) => ({
                                    ...prev,
                                    [e.id]: v.id
                                  }))
                                }
                              />
                            )}
                          </div>
                        ))}
                      </td>
                      <td>
                        <button onClick={() => onOpen(e.id)}>
                          Apri scheda
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <Pager
            page={reviewPage}
            size={25}
            total={reviewTotal}
            onChange={setReviewPage}
          />
          <label className={s.check}>
            <input
              type="checkbox"
              checked={attested}
              onChange={(e) => setAttested(e.target.checked)}
            />
            Ho controllato le fonti e l’identità delle organizzazioni
            selezionate.
          </label>
          <button
            disabled={busy || !attested || !Object.keys(selection).length}
            onClick={() =>
              act(async () => {
                const items = review
                  .filter((e) => selection[e.id])
                  .map((e) => ({
                    id: e.id,
                    evidence_id: selection[e.id],
                    version: e.version
                  }))
                await post({ action: 'bulk_review', confirmed: true, items })
                setNotice(
                  `${items.length} identità verificate. Nessun contatto CRM creato.`
                )
              })
            }
          >
            Conferma {Object.keys(selection).length} verifiche
          </button>
          <div className={s.card}>
            <h3>Consolida un duplicato</h3>
            <p>
              Conserva entrambe le schede e tutte le fonti. La scheda duplicata
              viene marcata e collegata a quella canonica; l’operazione è
              annullabile se la scheda non cambia.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                const f = new FormData(e.currentTarget)
                if (!duplicate || !canonicalEntity) return
                act(async () => {
                  await post({
                    action: 'canonical',
                    duplicate_id: duplicate.id,
                    canonical_id: canonicalEntity.id,
                    duplicate_version: duplicate.version,
                    canonical_version: canonicalEntity.version,
                    reason: f.get('reason')
                  })
                  setNotice('Identità consolidate; fonti e dati conservati.')
                })
              }}
            >
              <div className={s.formGrid}>
                <EntityPicker
                  label="Scheda duplicata"
                  onSelect={setDuplicate}
                />
                <EntityPicker
                  label="Scheda canonica"
                  onSelect={setCanonicalEntity}
                />
              </div>
              <p>
                {duplicate?.name || '—'} → {canonicalEntity?.name || '—'}
              </p>
              <label>
                Motivazione verificata
                <textarea name="reason" required minLength={10} />
              </label>
              <button
                disabled={
                  busy ||
                  !duplicate ||
                  !canonicalEntity ||
                  duplicate.id === canonicalEntity.id
                }
              >
                Conferma collegamento canonico
              </button>
            </form>
            {canonical.map((l) => (
              <div key={l.id} className={s.toolbar}>
                <button onClick={() => onOpen(l.duplicate_id)}>
                  Apri duplicato
                </button>
                <button onClick={() => onOpen(l.canonical_id)}>
                  Apri canonica
                </button>
                <span>{l.reason}</span>
                <button
                  disabled={busy}
                  onClick={() =>
                    act(async () => {
                      await post({ action: 'undo_canonical', id: l.id })
                      setNotice('Collegamento annullato.')
                    })
                  }
                >
                  Annulla consolidamento
                </button>
              </div>
            ))}
          </div>
        </>
      )}
      {tab === 'coverage' && (
        <>
          <h3>Dove approfondire il catalogo</h3>
          <p>
            Presenza e profondità del censimento per categoria. L’assenza di
            record indica una lacuna del nostro catalogo; la completezza resta
            non misurata senza un elenco ufficiale di riferimento.
          </p>
          <div className={s.table}>
            <table>
              <thead>
                <tr>
                  <th>Paese</th>
                  <th>Organizzazioni</th>
                  <th>Verificate</th>
                  <th>Con sito</th>
                  <th>NTO</th>
                  <th>RTO</th>
                  <th>Destinazioni locali</th>
                  <th>DMC</th>
                  <th>OTA</th>
                  <th>Completezza</th>
                </tr>
              </thead>
              <tbody>
                {overview?.coverage.map((c) => (
                  <tr key={c.country_code}>
                    <td>
                      <button onClick={() => onCountry(c.country_code)}>
                        {c.country_code}
                      </button>
                    </td>
                    {[
                      c.organizations,
                      c.verified,
                      c.with_website,
                      c.nto,
                      c.rto,
                      c.local_destinations,
                      c.dmc,
                      c.ota
                    ].map((n, i) => (
                      <td key={i}>{number(n)}</td>
                    ))}
                    <td>Non misurata</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {tab === 'opportunities' && (
        <>
          <h3>Dal dossier al prossimo passo</h3>
          <p>
            Ogni riga rappresenta un progetto proposto. Le fasi commerciali sono
            separate dagli stati del progetto sulla piattaforma. Per avanzare
            oltre la ricerca servono identità verificata e collegamento al CRM.
          </p>
          {overview && (
            <div className={s.toolbar}>
              {Object.entries(STAGES).map(([k, v]) => (
                <span className={s.chip} key={k}>
                  {v}: {overview.stages[k] || 0}
                </span>
              ))}
              <span className={s.chip}>
                Progetti active documentati:{' '}
                {overview.project_statuses.active || 0}
              </span>
            </div>
          )}
          <OpportunityForm busy={busy} act={act} notice={setNotice} />
          {opportunities.map((o) => (
            <OpportunityCard
              key={o.id + ':' + o.version}
              opportunity={o}
              busy={busy}
              act={act}
              notice={setNotice}
              onOpen={onOpen}
            />
          ))}
        </>
      )}
      {tab === 'costs' && (
        <CostPanel
          sites={overview?.sources || 651}
          requests={overview?.requests_last_30_days || 0}
          enabled={overview?.enabled || 0}
        />
      )}
    </section>
  )
}

function Country({
  value,
  onChange,
  overview
}: {
  value: string
  onChange: (v: string) => void
  overview: Overview | null
}) {
  return (
    <select
      aria-label="Paese della ricerca"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">Tutti i paesi</option>
      {overview?.coverage.map((c) => (
        <option key={c.country_code} value={c.country_code}>
          {c.country_code}
        </option>
      ))}
    </select>
  )
}
function Pager({
  page,
  size,
  total,
  onChange
}: {
  page: number
  size: number
  total: number
  onChange: (p: number) => void
}) {
  return (
    <div className={s.toolbar}>
      <span>
        {number(total)} risultati · pagina {page + 1}
      </span>
      <button disabled={!page} onClick={() => onChange(page - 1)}>
        Precedenti
      </button>
      <button
        disabled={(page + 1) * size >= total}
        onClick={() => onChange(page + 1)}
      >
        Successivi
      </button>
    </div>
  )
}
type Actions = {
  busy: boolean
  act: (fn: () => Promise<void>) => Promise<void>
  notice: (s: string) => void
}
function SourcePanel({
  detail,
  busy,
  act,
  notice,
  onOpen,
  onPage
}: Actions & {
  detail: SourceDetail
  onOpen: (id: string) => void
  onPage: (p: number) => void
}) {
  const source = detail.source,
    report = source.latest_report
  const [official, setOfficial] = useState(source.official_status),
    [destination, setDestination] = useState(source.destination_status),
    [poiId, setPoiId] = useState('')
  return (
    <article className={s.card}>
      <div className={s.toolbar}>
        <h3>{source.label}</h3>
        <a href={source.url} target="_blank" rel="noreferrer">
          Apri portale ↗
        </a>
        {source.entity_id && (
          <button onClick={() => onOpen(source.entity_id!)}>
            Organizzazione
          </button>
        )}
        <button
          disabled={busy}
          onClick={() =>
            act(async () => {
              const r = await post<{
                skipped?: boolean
                reason?: string
                report?: { state: string }
              }>({ action: 'scan', id: source.id })
              notice(
                r.skipped
                  ? r.reason!
                  : `Analisi ${r.report?.state}: risultati salvati come candidati.`
              )
            })
          }
        >
          {busy ? 'Operazione in corso…' : 'Esegui analisi limitata'}
        </button>
      </div>
      {report ? (
        <>
          <p>{report.title}</p>
          <div className={s.stats}>
            {[
              [report.sitemap_urls_seen, 'URL osservati nelle sitemap'],
              [report.place_url_candidates, 'URL candidati luoghi'],
              [report.restaurant_url_candidates, 'URL candidati ristoranti'],
              [report.candidates.length, 'Schede estratte nel campione'],
              [report.geocoded_candidates, 'Con coordinate']
            ].map(([n, l]) => (
              <div key={String(l)}>
                <strong>{number(Number(n))}</strong>
                <span>{l}</span>
              </div>
            ))}
          </div>
          <p className={s.muted}>{report.count_note}</p>
          {report.sitemap && (
            <div className={s.card}>
              <h4>Verifica sitemap XML</h4>
              <p>
                {report.sitemap.status === 'found'
                  ? 'Sitemap XML trovata'
                  : report.sitemap.status === 'unavailable'
                    ? 'Sitemap non verificabile per un blocco di accesso'
                    : 'Sitemap XML non trovata nei percorsi controllati'}
                .{' '}
                {report.sitemap.enumeration_complete
                  ? 'Letti tutti i file XML raggiungibili scoperti.'
                  : 'Enumerazione parziale o non disponibile.'}{' '}
                La sitemap non garantisce che siano elencate tutte le pagine del
                sito.
              </p>
              <p>
                {report.sitemap.documents.length} file XML letti ·{' '}
                {report.sitemap.pending_documents} ancora da leggere ·{' '}
                {report.sitemap.sampled_catalogue_links_missing ?? '—'} URL di
                catalogo osservati non presenti nelle sitemap lette.
              </p>
              {report.sitemap.documents.map((d) => (
                <p key={d.url}>
                  <a href={d.url} target="_blank" rel="noreferrer">
                    {d.url}
                  </a>{' '}
                  · {d.kind} · {d.urls} voci
                </p>
              ))}
            </div>
          )}
          {report.target_check && (
            <div className={s.card}>
              <h4>{TARGET_LABELS[report.target_check.classification]}</h4>
              <p>{report.target_check.note}</p>
              {report.target_check.evidence.map((e, i) => (
                <p key={i}>
                  <a href={e.url} target="_blank" rel="noreferrer">
                    Fonte
                  </a>{' '}
                  · {e.signal}
                </p>
              ))}
            </div>
          )}
          <p>
            {report.requests} richieste · {(report.bytes / 1e6).toFixed(2)} MB ·{' '}
            {(report.duration_ms / 1000).toFixed(1)} secondi · Lingue osservate:{' '}
            {report.languages.join(', ') || 'non rilevate'}. Mappa esistente:{' '}
            {report.map_detected ? 'rilevata' : 'non accertata'}.
          </p>
          <ul>
            {report.destination_signals.map((v) => (
              <li key={v}>{v}</li>
            ))}
          </ul>
          {report.declared_lists.map((v, i) => (
            <p key={i}>
              Totale dichiarato per “{v.label}”: {number(v.count)} ·{' '}
              <a href={v.url} target="_blank" rel="noreferrer">
                fonte
              </a>
              . Non certifica il totale del sito.
            </p>
          ))}
          {report.errors.length > 0 && (
            <div className={s.error}>
              {report.errors.map((e, i) => (
                <p key={i}>
                  {e.url}: {e.message}
                </p>
              ))}
            </div>
          )}
          <details>
            <summary>
              Sezioni di catalogo individuate ({report.catalogue_pages.length})
            </summary>
            <ul>
              {report.catalogue_pages.map((l) => (
                <li key={l.url}>
                  <a href={l.url} target="_blank" rel="noreferrer">
                    {l.label || l.url}
                  </a>{' '}
                  · {l.category}
                </li>
              ))}
            </ul>
          </details>
          {report.geocoded_candidates > 0 && (
            <>
              <h4>Anteprima interna della mappa</h4>
              <p>
                Posizioni candidate, da verificare prima dell’utilizzo in un
                progetto.
              </p>
              <PoiPreview points={report.candidates} />
            </>
          )}
        </>
      ) : (
        <p>Questo sito non è ancora stato analizzato.</p>
      )}
      <details className={s.card}>
        <summary>Identità del portale e controllo periodico</summary>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            const f = new FormData(e.currentTarget)
            act(async () => {
              await post({
                action: 'source_settings',
                id: source.id,
                version: source.version,
                official_status: official,
                destination_status: destination,
                review_url: f.get('review_url'),
                review_note: f.get('review_note'),
                enabled: f.get('enabled') === 'on',
                interval_days: Number(f.get('interval')),
                max_requests: Number(f.get('limit'))
              })
              notice('Verifica del portale e frequenza salvate.')
            })
          }}
        >
          <div className={s.formGrid}>
            <label>
              Portale ufficiale
              <select
                value={official}
                onChange={(e) => setOfficial(e.target.value as typeof official)}
              >
                <option value="candidate">Da confermare</option>
                <option value="confirmed">Confermato da fonte</option>
                <option value="rejected">Escluso</option>
              </select>
            </label>
            <label>
              È una destinazione
              <select
                value={destination}
                onChange={(e) =>
                  setDestination(e.target.value as typeof destination)
                }
              >
                <option value="candidate">Da confermare</option>
                <option value="confirmed">Promuove un territorio</option>
                <option value="rejected">Non è una destinazione</option>
              </select>
            </label>
            <label>
              Fonte dell’identità
              <input
                name="review_url"
                type="url"
                required
                defaultValue={source.review_url || source.url}
              />
            </label>
            <label>
              Motivazione
              <textarea
                name="review_note"
                required
                minLength={10}
                defaultValue={source.review_note}
              />
            </label>
            <label>
              Intervallo (giorni)
              <input
                name="interval"
                type="number"
                min={7}
                max={365}
                defaultValue={source.interval_days}
              />
            </label>
            <label>
              Richieste massime per controllo
              <input
                name="limit"
                type="number"
                min={3}
                max={40}
                defaultValue={source.max_requests}
              />
            </label>
          </div>
          <label className={s.check}>
            <input
              name="enabled"
              type="checkbox"
              defaultChecked={source.enabled}
            />
            Abilita i controlli periodici di questo sito
          </label>
          <button disabled={busy}>Salva decisione e frequenza</button>
        </form>
      </details>
      <h4>Schede estratte da verificare</h4>
      <div className={s.table}>
        <table>
          <thead>
            <tr>
              <th>Nome / fonte</th>
              <th>Categoria</th>
              <th>Coordinate</th>
              <th>Revisione / riuso</th>
            </tr>
          </thead>
          <tbody>
            {detail.pois.map((p) => (
              <tr key={p.id}>
                <td>
                  <a href={p.source_url} target="_blank" rel="noreferrer">
                    {p.name}
                  </a>
                </td>
                <td>{p.category}</td>
                <td>
                  {p.latitude !== null
                    ? `${p.latitude}, ${p.longitude}`
                    : 'Da acquisire'}
                </td>
                <td>
                  <button onClick={() => setPoiId(p.id)}>
                    {p.state} · {p.reuse_status}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager
        page={detail.page}
        size={100}
        total={detail.total}
        onChange={onPage}
      />
      {poiId && (
        <form
          className={s.card}
          onSubmit={(e) => {
            e.preventDefault()
            const f = new FormData(e.currentTarget)
            act(async () => {
              await post({
                action: 'review_poi',
                id: poiId,
                state: f.get('state'),
                reuse_status: f.get('reuse_status'),
                reuse_url: f.get('reuse_url'),
                review_note: f.get('review_note')
              })
              notice('Revisione della scheda salvata.')
              setPoiId('')
            })
          }}
        >
          <h4>Revisione della scheda selezionata</h4>
          <div className={s.formGrid}>
            <label>
              Decisione
              <select name="state">
                <option value="approved">Approva scheda</option>
                <option value="rejected">Scarta scheda</option>
              </select>
            </label>
            <label>
              Riuso documentato
              <select name="reuse_status">
                <option value="unknown">Non accertato</option>
                <option value="authorized">Autorizzato dal titolare</option>
                <option value="open">Licenza aperta</option>
              </select>
            </label>
            <label>
              Fonte della licenza / autorizzazione
              <input name="reuse_url" type="url" />
            </label>
            <label>
              Note di verifica
              <textarea name="review_note" required minLength={10} />
            </label>
          </div>
          <button disabled={busy}>Salva revisione</button>
        </form>
      )}
      <button
        disabled={
          busy ||
          source.official_status !== 'confirmed' ||
          source.destination_status !== 'confirmed'
        }
        onClick={() =>
          act(async () => {
            const r = await apiFetch<{ geojson: unknown }>(
              endpoint + `?source_id=${source.id}&format=geojson`
            )
            download(
              JSON.stringify(r.geojson, null, 2),
              'luoghi-approvati.geojson',
              'application/geo+json'
            )
            notice(
              'Esportate solo schede approvate, geolocalizzate e con riuso documentato.'
            )
          })
        }
      >
        Esporta GeoJSON approvato
      </button>
      <details className={s.card}>
        <summary>Dossier per un progetto Speaqi</summary>
        <p>
          Proposta da valutare:{' '}
          {report?.geocoded_candidates
            ? 'mappa di destinazione con schede geolocalizzate'
            : report?.catalogue_pages.length
              ? 'mappa di destinazione, con acquisizione e verifica delle schede'
              : 'ricerca del catalogo territoriale prima di proporre una mappa'}
          . La presenza di servizi digitali non dimostra un bisogno commerciale.
        </p>
        <OpportunityForm
          busy={busy}
          act={act}
          notice={notice}
          source={source}
        />
      </details>
      <details>
        <summary>Storico dei controlli</summary>
        {detail.scans.map((v) => (
          <p key={v.id}>
            {when(v.finished_at)} · {v.state} · {v.requests} richieste ·{' '}
            {v.changes.baseline
              ? 'Prima rilevazione'
              : `${v.changes.added} schede osservate per la prima volta; ${v.changes.not_observed_again || 0} non riosservate nel campione`}
          </p>
        ))}
      </details>
    </article>
  )
}

function OpportunityForm({
  busy,
  act,
  notice,
  source
}: Actions & { source?: SiteSource }) {
  const [entity, setEntity] = useState<{ id: string; name: string } | null>(
    source?.entity_id ? { id: source.entity_id, name: source.label } : null
  )
  return (
    <form
      className={s.card}
      onSubmit={(e) => {
        e.preventDefault()
        if (!entity) return
        const f = new FormData(e.currentTarget)
        act(async () => {
          await post({
            action: 'opportunity',
            entity_id: entity.id,
            title: f.get('title'),
            project_kind: f.get('kind'),
            source_url: f.get('source_url'),
            rationale: f.get('rationale'),
            responsible: f.get('responsible'),
            next_action: f.get('next_action')
          })
          notice('Dossier di progetto salvato in ricerca.')
        })
      }}
    >
      <h4>Nuovo progetto proposto</h4>
      <EntityPicker label="Organizzazione del catalogo" onSelect={setEntity} />
      <p>{entity?.name || 'Seleziona un’organizzazione'}</p>
      <div className={s.formGrid}>
        <label>
          Progetto
          <input
            name="title"
            required
            minLength={3}
            defaultValue={source ? 'Mappa multilingua · ' + source.label : ''}
          />
        </label>
        <label>
          Tipo
          <select name="kind">
            {Object.entries(PROJECTS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          Fonte
          <input
            name="source_url"
            type="url"
            required
            defaultValue={source?.url}
          />
        </label>
        <label>
          Responsabile
          <input name="responsible" />
        </label>
        <label>
          Motivazione basata su dati
          <textarea
            name="rationale"
            required
            minLength={10}
            defaultValue={
              source?.latest_report
                ? `Nel campione del ${source.latest_report.fetched_at.slice(0, 10)} sono state estratte ${source.latest_report.candidates.length} schede, di cui ${source.latest_report.geocoded_candidates} con coordinate. Identità, riuso e interesse commerciale da verificare.`
                : ''
            }
          />
        </label>
        <label>
          Prossimo passo
          <textarea name="next_action" />
        </label>
      </div>
      <button disabled={busy || !entity}>Salva dossier in ricerca</button>
    </form>
  )
}
function OpportunityCard({
  opportunity: o,
  busy,
  act,
  notice,
  onOpen
}: Actions & { opportunity: Opportunity; onOpen: (id: string) => void }) {
  const [stage, setStage] = useState(o.stage),
    [status, setStatus] = useState(o.project_status || ''),
    [taskKey] = useState(() => crypto.randomUUID())
  return (
    <article className={s.card}>
      <div className={s.toolbar}>
        <h4>{o.title}</h4>
        <button onClick={() => onOpen(o.entity_id)}>
          Apri organizzazione e CRM
        </button>
      </div>
      <p>{o.rationale}</p>
      <a href={o.source_url} target="_blank" rel="noreferrer">
        Fonte del dossier
      </a>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          const f = new FormData(e.currentTarget)
          act(async () => {
            await post({
              action: 'opportunity_update',
              id: o.id,
              version: o.version,
              stage,
              responsible: f.get('responsible'),
              next_action: f.get('next_action'),
              project_status: status,
              platform_project_url: f.get('project_url')
            })
            notice('Progetto proposto aggiornato.')
          })
        }}
      >
        <div className={s.formGrid}>
          <label>
            Fase commerciale
            <select value={stage} onChange={(e) => setStage(e.target.value)}>
              {Object.entries(STAGES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            Stato del progetto sulla piattaforma
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Non ancora collegato</option>
              {['demo', 'trial', 'active', 'suspended', 'archived'].map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </label>
          <label>
            URL del progetto sulla piattaforma
            <input
              name="project_url"
              type="url"
              required={!!status}
              defaultValue={o.platform_project_url || ''}
            />
          </label>
          <label>
            Responsabile
            <input name="responsible" defaultValue={o.responsible} />
          </label>
          <label>
            Prossimo passo
            <textarea name="next_action" defaultValue={o.next_action} />
          </label>
        </div>
        <button disabled={busy}>Salva avanzamento</button>
      </form>
      <details>
        <summary>Crea attività nel CRM</summary>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            const f = new FormData(e.currentTarget)
            act(async () => {
              await post({
                action: 'task',
                entity_id: o.entity_id,
                request_id: taskKey,
                due_at: new Date(String(f.get('due'))).toISOString(),
                note: f.get('note')
              })
              notice('Attività creata nel CRM senza inviare messaggi.')
            })
          }}
        >
          <label>
            Scadenza
            <input name="due" type="datetime-local" required />
          </label>
          <label>
            Attività
            <textarea
              name="note"
              required
              minLength={10}
              defaultValue={o.next_action}
            />
          </label>
          <button disabled={busy}>Crea attività</button>
        </form>
      </details>
    </article>
  )
}
function CostPanel({
  sites,
  requests,
  enabled
}: {
  sites: number
  requests: number
  enabled: number
}) {
  const [n, setN] = useState(sites),
    [pages, setPages] = useState(1000),
    [browser, setBrowser] = useState(20),
    [ai, setAi] = useState(0),
    [changed, setChanged] = useState(10)
  const first = estimateCrawlCost(n, pages, browser / 100, ai / 100),
    refresh = estimateCrawlCost(
      n,
      pages,
      browser / 100,
      ai / 100,
      changed / 100
    ),
    inventory = estimateCrawlCost(n, 20)
  const range = (x: ReturnType<typeof estimateCrawlCost>) =>
    `${x.low_eur.toLocaleString('it-IT')}–${x.high_eur.toLocaleString('it-IT')} €`
  return (
    <>
      <h3>Stima modificabile dei volumi e del costo a consumo</h3>
      <p>{COST_ASSUMPTIONS.note}</p>
      <div className={s.formGrid}>
        <label>
          Siti
          <input
            type="number"
            min={0}
            max={100000}
            value={n}
            onChange={(e) =>
              setN(Math.min(100000, Math.max(0, Number(e.target.value))))
            }
          />
        </label>
        <label>
          Richieste per sito
          <input
            type="number"
            min={1}
            max={100000}
            value={pages}
            onChange={(e) =>
              setPages(Math.min(100000, Math.max(1, Number(e.target.value))))
            }
          />
        </label>
        <label>
          Pagine con browser (%)
          <input
            type="number"
            min={0}
            max={100}
            value={browser}
            onChange={(e) =>
              setBrowser(Math.min(100, Math.max(0, Number(e.target.value))))
            }
          />
        </label>
        <label>
          Pagine con AI (%)
          <input
            type="number"
            min={0}
            max={100}
            value={ai}
            onChange={(e) =>
              setAi(Math.min(100, Math.max(0, Number(e.target.value))))
            }
          />
        </label>
        <label>
          Quota da riscaricare (%)
          <input
            type="number"
            min={0}
            max={100}
            value={changed}
            onChange={(e) =>
              setChanged(Math.min(100, Math.max(0, Number(e.target.value))))
            }
          />
        </label>
      </div>
      <div className={s.stats}>
        {[
          [range(inventory), 'Censimento da 20 richieste/sito'],
          [range(first), 'Prima estrazione nello scenario'],
          [range(refresh), 'Aggiornamento selettivo ipotizzato']
        ].map(([v, l]) => (
          <div key={l}>
            <strong>{v}</strong>
            <span>{l}</span>
          </div>
        ))}
      </div>
      <p>
        Scenario: {number(first.requests)} richieste iniziali;{' '}
        {number(refresh.requests)} per ogni aggiornamento, a cui aggiungere
        sitemap, paginazione, controllo delle modifiche e tentativi falliti. Un
        controllo HTTP condizionale può comunque consumare una richiesta.
      </p>
      <p>
        Il motore attuale ripete un censimento limitato. Lo scenario selettivo
        richiede adattatori incrementali per i singoli portali e non descrive un
        risparmio già misurato.
      </p>
      <p>
        Ipotesi per 1.000 richieste: HTML{' '}
        {COST_ASSUMPTIONS.http_per_1000.join('–')} €, browser{' '}
        {COST_ASSUMPTIONS.browser_per_1000.join('–')} €, AI opzionale aggiuntiva{' '}
        {COST_ASSUMPTIONS.optional_ai_per_1000.join('–')} €. Non sono preventivi
        di fornitori.
      </p>
      <p>
        Attualmente: {enabled} siti abilitati e {number(requests)} richieste
        registrate negli ultimi 30 giorni. Il motore implementato usa HTTP e
        parsing locale, senza browser a pagamento o chiamate AI. Limite globale:
        120 richieste al giorno per workspace; un solo sito per esecuzione
        automatica.
      </p>
      <p>
        Frequenza iniziale consigliata: censimento mensile, nuove schede e
        modifiche settimanali solo per destinazioni prioritarie. Il numero
        mondiale di luoghi resta sconosciuto: questo simulatore esprime scenari,
        non una previsione misurata.
      </p>
    </>
  )
}
