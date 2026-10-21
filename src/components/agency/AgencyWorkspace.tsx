'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/api'
import {
  AGENCY_STAGES,
  AGENCY_STAGE_LABELS,
  PRESENTATION_STATUS_LABELS,
  formatMoney,
  type AgencySettings,
  type AgencyStage,
  type PresentationStatus,
  type ServiceCategory
} from '@/lib/agency'
import NewProposalDialog from './NewProposalDialog'
import TemplateTab from './TemplateTab'
import { day, errorText } from './client'
import s from './agency.module.css'

type ProjectRow = {
  id: string; title: string; client_name: string; contact_id: string | null; stage: AgencyStage; services: string[]
  updated_at: string; created_at: string; documents: number; presentations: number; approved: number; quotes: number; value: number | null; currency: string
}
type PresRow = { id: string; project_id: string; title: string; status: PresentationStatus; slide_count: number; todo: number; quote_id: string | null; updated_at: string; approved_at: string | null }
type QuoteRow = { id: string; agency_project_id: string; quote_number: string; title: string; status: string; total_amount: number; currency: string; created_at: string }
type Overview = { settings: AgencySettings; categories: (ServiceCategory & { id: string })[]; projects: ProjectRow[]; presentations: PresRow[]; quotes: QuoteRow[] }
type Doc = { id: string; kind: string; name: string; size: number; url: string | null; project_id: string; project_title: string; client_name: string; created_at?: string; source_url?: string }

const TABS = [
  ['dashboard', 'Dashboard'],
  ['opportunita', 'Progetti e opportunità'],
  ['clienti', 'Clienti'],
  ['studio', 'Presentation Studio'],
  ['preventivi', 'Preventivi'],
  ['documenti', 'Documenti'],
  ['template', 'Template']
] as const
type Tab = (typeof TABS)[number][0]
const OPEN: AgencyStage[] = ['brief', 'proposal', 'negotiation', 'on_hold']
const KIND_LABEL: Record<string, string> = { photo: 'Foto', logo: 'Logo', document: 'Documento', website: 'Sito' }

/** Speaqi Agency: la porta dell'area, con il cruscotto e le sezioni. */
export default function AgencyWorkspace() {
  const router = useRouter()
  const [tab, setTabState] = useState<Tab>('dashboard')
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState('')
  const [dialog, setDialog] = useState(false)
  const [stage, setStage] = useState<AgencyStage | 'open' | 'all'>('open')
  const [search, setSearch] = useState('')
  const [docs, setDocs] = useState<{ assets: Doc[]; presentations: any[] } | null>(null)

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab') as Tab | null
    if (t && TABS.some(([k]) => k === t)) setTabState(t)
    if (new URLSearchParams(window.location.search).get('new') === '1') setDialog(true)
  }, [])
  const setTab = (t: Tab) => {
    setTabState(t)
    const url = new URL(window.location.href)
    url.searchParams.set('tab', t)
    window.history.replaceState(null, '', url)
  }

  const load = useCallback(() => {
    apiFetch<Overview>('/api/agency/overview')
      .then((r) => { setData(r); setError('') })
      .catch((err) => setError(errorText(err, 'Speaqi Agency non caricata')))
  }, [])
  useEffect(load, [load])
  useEffect(() => {
    if (tab === 'documenti' && !docs) apiFetch<{ assets: Doc[]; presentations: any[] }>('/api/agency/documents').then(setDocs).catch((err) => setError(errorText(err)))
  }, [tab, docs])

  const projects = data?.projects || []
  const byId = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects])
  const catName = useMemo(() => new Map((data?.categories || []).map((c) => [c.slug, c.name])), [data])
  const open = projects.filter((p) => OPEN.includes(p.stage))
  const pipelineValue = open.reduce((sum, p) => sum + (p.value || 0), 0)
  const wonValue = projects.filter((p) => p.stage === 'won').reduce((sum, p) => sum + (p.value || 0), 0)
  const pres = data?.presentations || []
  const toReview = pres.filter((p) => p.status === 'ready' || p.status === 'failed' || p.status === 'draft')

  const filtered = projects.filter((p) => {
    if (stage === 'open' && !OPEN.includes(p.stage)) return false
    if (stage !== 'open' && stage !== 'all' && p.stage !== stage) return false
    const q = search.trim().toLowerCase()
    return !q || `${p.title} ${p.client_name}`.toLowerCase().includes(q)
  })
  const clients = useMemo(() => {
    const map = new Map<string, { key: string; contact_id: string | null; name: string; projects: ProjectRow[] }>()
    for (const p of projects) {
      const key = p.contact_id || `name:${p.client_name}`
      const entry = map.get(key) || { key, contact_id: p.contact_id, name: p.client_name, projects: [] }
      entry.projects.push(p)
      map.set(key, entry)
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'it'))
  }, [projects])

  const stageBadge = (st: AgencyStage) => <span className={s.badge} data-s={st}>{AGENCY_STAGE_LABELS[st]}</span>
  const presBadge = (st: PresentationStatus) => <span className={s.badge} data-s={st}>{st === 'generating' && <span className={s.spin} />} {PRESENTATION_STATUS_LABELS[st]}</span>
  const money = (v: number | null, c = 'EUR') => (v === null ? '—' : formatMoney(v, c))

  const projectTable = (rows: ProjectRow[]) =>
    rows.length ? (
      <table className={s.table}>
        <thead><tr><th>Cliente · Progetto</th><th>Servizi</th><th>Stato</th><th>Presentazioni</th><th>Preventivo</th><th>Aggiornato</th></tr></thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id}>
              <td><Link href={`/agency/${p.id}`}>{p.client_name}</Link><div className={s.help}>{p.title}</div></td>
              <td><div className={s.chips}>{p.services.slice(0, 3).map((sl) => <span key={sl} className={s.tag}>{catName.get(sl) || sl}</span>)}{p.services.length > 3 && <span className={s.tag}>+{p.services.length - 3}</span>}</div></td>
              <td>{stageBadge(p.stage)}</td>
              <td>{p.presentations}{p.approved ? <span className={s.help}> · {p.approved} approvate</span> : null}</td>
              <td>{money(p.value, p.currency)}</td>
              <td>{day(p.updated_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    ) : (
      <div className={s.empty}><strong>Nessuna opportunità qui</strong>Premi “Nuova proposta” e parti da un brief.</div>
    )

  return (
    <div className={s.ws}>
      <div className={s.top}>
        <div>
          <div className={s.brandline}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/deck/logo.png" alt="Speaqi" />
            <h1>Speaqi <span>Agency</span></h1>
          </div>
          <p className={s.sub}>Siti, branding, SEO e GEO, marketing, software e AI: dal brief alla proposta, collegata al preventivo.</p>
        </div>
        <button className={s.primary} onClick={() => setDialog(true)} disabled={!data}>＋ Nuova proposta</button>
      </div>

      <nav className={s.tabs} aria-label="Sezioni Agency">
        {TABS.map(([k, label]) => (
          <button key={k} className={`${s.tab} ${tab === k ? s.tabOn : ''}`} onClick={() => setTab(k)} aria-current={tab === k ? 'page' : undefined}>{label}</button>
        ))}
      </nav>

      {error && <p className={s.error} role="alert">{error}</p>}
      {!data && !error && <p className={s.help}>Caricamento…</p>}

      {data && tab === 'dashboard' && (
        <>
          <div className={s.grid4}>
            <div className={s.kpi}><strong>{open.length}</strong><span>Opportunità aperte</span></div>
            <div className={s.kpi}><strong>{money(pipelineValue)}</strong><span>Valore nei preventivi aperti</span></div>
            <div className={s.kpi}><strong>{toReview.length}</strong><span>Presentazioni da rivedere</span></div>
            <div className={s.kpi}><strong>{money(wonValue)}</strong><span>Valore vinto</span></div>
          </div>
          <div className={s.cols2}>
            <div className={s.stack}>
              <div className={s.panel}>
                <header><h2>Pipeline Agency</h2><button className={s.linkBtn} onClick={() => setTab('opportunita')}>Tutte →</button></header>
                <div className={s.grid4} style={{ marginBottom: 0, gridTemplateColumns: 'repeat(3, minmax(0,1fr))' }}>
                  {AGENCY_STAGES.map((st) => {
                    const list = projects.filter((p) => p.stage === st)
                    return (
                      <button key={st} className={s.kpi} style={{ textAlign: 'left', cursor: 'pointer', font: 'inherit' }} onClick={() => { setStage(st); setTab('opportunita') }}>
                        <strong style={{ fontSize: 20 }}>{list.length}</strong>
                        <span>{AGENCY_STAGE_LABELS[st]} · {money(list.reduce((sum, p) => sum + (p.value || 0), 0))}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className={s.panel}>
                <header><h2>Ultime opportunità</h2></header>
                {projectTable(projects.slice(0, 8))}
              </div>
            </div>
            <div className={s.panel}>
              <header><h2>Presentazioni</h2><button className={s.linkBtn} onClick={() => setTab('studio')}>Studio →</button></header>
              {pres.length ? (
                <table className={s.table}>
                  <tbody>
                    {pres.slice(0, 10).map((p) => (
                      <tr key={p.id}>
                        <td><Link href={`/agency/presentazioni/${p.id}`}>{p.title}</Link><div className={s.help}>{byId.get(p.project_id)?.client_name}</div></td>
                        <td>{presBadge(p.status)}</td>
                        <td className={s.help}>{p.todo ? `${p.todo} da verificare` : `${p.slide_count} slide`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className={s.empty}><strong>Ancora nessuna presentazione</strong>Una proposta nuova ne genera una dal brief.</div>
              )}
            </div>
          </div>
        </>
      )}

      {data && tab === 'opportunita' && (
        <div className={s.panel}>
          <div className={s.between}>
            <div className={s.chips}>
              {(['open', 'all', ...AGENCY_STAGES] as const).map((st) => (
                <button key={st} className={`${s.chip} ${stage === st ? s.chipOn : ''}`} onClick={() => setStage(st)}>
                  {st === 'open' ? 'Aperte' : st === 'all' ? 'Tutte' : AGENCY_STAGE_LABELS[st]}
                </button>
              ))}
            </div>
            <input style={{ maxWidth: 280 }} placeholder="Cerca cliente o progetto" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Cerca" />
          </div>
          {projectTable(filtered)}
        </div>
      )}

      {data && tab === 'clienti' && (
        <div className={s.panel}>
          <p className={s.help}>I clienti sono i contatti del CRM: la scheda, la pipeline e i follow-up restano lì. Qui vedi le loro opportunità Agency.</p>
          {clients.length ? (
            <table className={s.table}>
              <thead><tr><th>Cliente</th><th>Opportunità</th><th>Valore aperto</th><th /></tr></thead>
              <tbody>
                {clients.map((c) => (
                  <tr key={c.key}>
                    <td><strong>{c.name}</strong></td>
                    <td><div className={s.chips}>{c.projects.map((p) => <Link key={p.id} href={`/agency/${p.id}`} className={s.tag}>{p.title} · {AGENCY_STAGE_LABELS[p.stage]}</Link>)}</div></td>
                    <td>{money(c.projects.filter((p) => OPEN.includes(p.stage)).reduce((sum, p) => sum + (p.value || 0), 0))}</td>
                    <td>{c.contact_id ? <Link href={`/contacts/${c.contact_id}`}>Scheda CRM →</Link> : <span className={s.help}>Contatto cancellato</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className={s.empty}><strong>Nessun cliente Agency</strong>Il primo arriva con la prima proposta.</div>
          )}
        </div>
      )}

      {data && tab === 'studio' && (
        <div className={s.panel}>
          <p className={s.help}>Ogni presentazione appartiene a un’opportunità. Aprila per modificarla, rigenerarla, chiedere una revisione all’AI, approvarla ed esportarla.</p>
          {pres.length ? (
            <table className={s.table}>
              <thead><tr><th>Presentazione</th><th>Cliente</th><th>Stato</th><th>Da completare</th><th>Preventivo</th><th>Aggiornata</th></tr></thead>
              <tbody>
                {pres.map((p) => (
                  <tr key={p.id}>
                    <td><Link href={`/agency/presentazioni/${p.id}`}>{p.title}</Link><div className={s.help}>{p.slide_count} slide</div></td>
                    <td>{byId.get(p.project_id) ? <Link href={`/agency/${p.project_id}`}>{byId.get(p.project_id)?.client_name}</Link> : '—'}</td>
                    <td>{presBadge(p.status)}</td>
                    <td>{p.todo ? `${p.todo} [DA VERIFICARE]` : '—'}</td>
                    <td>{p.quote_id ? 'Collegato' : <span className={s.help}>Nessuno</span>}</td>
                    <td>{day(p.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className={s.empty}><strong>Nessuna presentazione</strong><button className={s.linkBtn} onClick={() => setDialog(true)}>Crea la prima proposta</button></div>
          )}
        </div>
      )}

      {data && tab === 'preventivi' && (
        <div className={s.panel}>
          <p className={s.help}>I preventivi restano quelli del CRM (stessi numeri, stesso pagamento e firma). Qui ci sono quelli collegati a un’opportunità Agency; si crea un preventivo dalla pagina dell’opportunità.</p>
          {data.quotes.length ? (
            <table className={s.table}>
              <thead><tr><th>Preventivo</th><th>Opportunità</th><th>Stato</th><th>Totale</th><th>Creato</th></tr></thead>
              <tbody>
                {data.quotes.map((q) => (
                  <tr key={q.id}>
                    <td><Link href={`/preventivi?edit=${q.id}`}>{q.quote_number}</Link><div className={s.help}>{q.title}</div></td>
                    <td>{byId.get(q.agency_project_id) ? <Link href={`/agency/${q.agency_project_id}`}>{byId.get(q.agency_project_id)?.client_name}</Link> : '—'}</td>
                    <td><span className={s.badge} data-s={q.status}>{q.status}</span></td>
                    <td>{formatMoney(Number(q.total_amount), q.currency)}</td>
                    <td>{day(q.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className={s.empty}><strong>Nessun preventivo collegato</strong>Apri un’opportunità e premi “Nuovo preventivo”.</div>
          )}
        </div>
      )}

      {data && tab === 'documenti' && (
        <div className={s.stack}>
          <div className={s.panel}>
            <header><h2>Materiali caricati</h2></header>
            {!docs ? <p className={s.help}>Caricamento…</p> : docs.assets.length ? (
              <table className={s.table}>
                <thead><tr><th>File</th><th>Tipo</th><th>Opportunità</th><th>Peso</th><th>Caricato</th></tr></thead>
                <tbody>
                  {docs.assets.map((a) => (
                    <tr key={a.id}>
                      <td>{a.url ? <a href={a.url} target="_blank" rel="noreferrer">{a.name}</a> : a.source_url ? <a href={a.source_url} target="_blank" rel="noreferrer">{a.name}</a> : a.name}</td>
                      <td><span className={s.tag}>{KIND_LABEL[a.kind] || a.kind}</span></td>
                      <td><Link href={`/agency/${a.project_id}`}>{a.client_name}</Link><div className={s.help}>{a.project_title}</div></td>
                      <td>{a.size > 1048576 ? `${(a.size / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(a.size / 1024))} KB`}</td>
                      <td>{day(a.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <div className={s.empty}><strong>Nessun file</strong>Brief, documenti, presentazioni e foto dei clienti finiscono qui.</div>}
          </div>
          <div className={s.panel}>
            <header><h2>Presentazioni generate</h2></header>
            <p className={s.help}>Il PDF e il PowerPoint si scaricano dalla presentazione; una presentazione approvata ha anche il link da condividere.</p>
            {docs?.presentations?.length ? (
              <table className={s.table}>
                <tbody>
                  {docs.presentations.map((p: any) => (
                    <tr key={p.id}>
                      <td><Link href={`/agency/presentazioni/${p.id}`}>{p.title}</Link><div className={s.help}>{p.project?.title} · versione {p.version}</div></td>
                      <td>{presBadge(p.status)}</td>
                      <td>{p.status === 'approved' ? <a href={`/proposta/${p.public_token}`} target="_blank" rel="noreferrer">Link pubblico ↗</a> : <span className={s.help}>Non condivisa</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </div>
        </div>
      )}

      {data && tab === 'template' && <TemplateTab settings={data.settings} categories={data.categories} onChanged={load} />}

      {dialog && data && (
        <NewProposalDialog
          categories={data.categories}
          onClose={() => setDialog(false)}
          onCreated={(presentationId, _projectId, warnings) => {
            try {
              if (warnings.length) sessionStorage.setItem(`agency:warnings:${presentationId}`, JSON.stringify(warnings))
            } catch {
              /* solo un avviso in meno */
            }
            router.push(`/agency/presentazioni/${presentationId}`)
          }}
        />
      )}
    </div>
  )
}
