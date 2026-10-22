'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { apiFetch } from '@/lib/api'
import {
  WORK_KINDS,
  WORK_STAGES,
  workFlags,
  closedWork,
  type WorkItem,
  type WorkNote,
  type WorkEvent,
  type WorkIdentity,
  type WorkMember,
  type WorkRule,
} from '@/lib/tourism-work'
import s from './work.module.css'

const ENDPOINT = '/api/tourism/work'
type Summary = {
  open: number
  today: number
  overdue: number
  fresh: number
  stale: number
  loads: { member_id: string | null; open: number; overdue: number }[]
}
type Data = {
  items: WorkItem[]
  total: number
  identity: WorkIdentity
  is_admin: boolean
  members: WorkMember[]
  rules: WorkRule[]
  ai_configured: boolean
  summary: Summary
}
type Detail = {
  item: WorkItem
  notes: WorkNote[]
  events: WorkEvent[]
  children: WorkItem[]
  children_truncated: boolean
}
type Sources = {
  entities: {
    id: string
    name: string
    country_code: string
    type_code: string
    kind: string
  }[]
  signals: {
    id: string
    title: string
    source_url: string
    rationale: string
  }[]
}
async function mutate(body: object, method = 'POST') {
  return apiFetch<Record<string, unknown>>(ENDPOINT, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}
const tomorrow = () =>
  new Date(Date.now() + 86400000).toISOString().slice(0, 10)
const dateLabel = (v: string) =>
  new Intl.DateTimeFormat('it', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(v))

export default function TourismWork() {
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [page, setPage] = useState(0),
    [mine, setMine] = useState(false)
  const [view, setView] = useState('work'),
    [filter, setFilter] = useState('open'),
    [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null),
    [detail, setDetail] = useState<Detail | null>(null),
    [creating, setCreating] = useState(false)
  const [generation, setGeneration] = useState(''),
    [createSources, setCreateSources] = useState<string[]>([])
  const [createParent, setCreateParent] = useState<WorkItem | null>(null)
  const load = useCallback(async () => {
    const response = await apiFetch<Data>(
      `${ENDPOINT}?page=${page}&mine=${mine}`,
    )
    setData(response)
    return response
  }, [page, mine])
  useEffect(() => {
    let live = true
    setLoading(true)
    setError('')
    apiFetch<Data>(`${ENDPOINT}?page=${page}&mine=${mine}`)
      .then((r) => {
        if (live) setData(r)
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
  }, [page, mine])
  useEffect(() => {
    let live = true
    setDetail(null)
    setGeneration('')
    if (!selectedId) return
    apiFetch<Detail>(`${ENDPOINT}?id=${selectedId}`)
      .then((r) => {
        if (live) setDetail(r)
      })
      .catch((e) => {
        if (live) setError(e.message)
      })
    return () => {
      live = false
    }
  }, [selectedId])
  useEffect(() => {
    const ids =
      new URLSearchParams(window.location.search)
        .get('entities')
        ?.split(',')
        .filter(Boolean) || []
    if (ids.length) {
      setCreateSources(ids.slice(0, 100))
      setCreating(true)
    }
  }, [])
  const act = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Operazione fallita')
    } finally {
      setBusy(false)
    }
  }
  const refreshDetail = async () => {
    await load()
    if (selectedId)
      setDetail(await apiFetch<Detail>(`${ENDPOINT}?id=${selectedId}`))
  }
  const memberName = (id: string | null) =>
    id
      ? data?.members.find((m) => m.id === id)?.name ||
        (id === data?.identity.member_id ? 'Tu' : 'Collaboratore assegnato')
      : 'Proprietario'
  const items = (data?.items || []).filter((i) => {
    const flags = workFlags(i)
    return (
      `${i.title} ${i.country_code} ${i.segment} ${i.next_action}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (filter === 'all' ||
        (filter === 'open' && !closedWork(i)) ||
        (filter === 'closed' && closedWork(i)) ||
        flags[filter as keyof typeof flags])
    )
  })
  return (
    <main className={s.workspace} data-tourism-work>
      <div className={s.top}>
        <div>
          <div className={s.eyebrow}>Speaqi / Turismo operativo</div>
          <h1>
            Il mio lavoro<span style={{ color: '#288367' }}>.</span>
          </h1>
          <p className={s.muted}>
            Partner, territori e opportunità. Ogni scheda ha un responsabile e
            un prossimo passo.
          </p>
        </div>
        <div className={s.toolbar}>
          {data?.is_admin && (
            <>
              <Link className={s.link} href="/tourism">
                Apri intelligence
              </Link>
              <button
                className={s.primary}
                onClick={() => {
                  setCreating(true)
                  setCreateParent(null)
                  setSelectedId(null)
                }}
              >
                ＋ Assegna lavoro
              </button>
            </>
          )}
        </div>
      </div>
      {error && (
        <div className={s.error} role="alert">
          {error}{' '}
          <button
            disabled={busy}
            onClick={() =>
              act(async () => {
                await load()
                if (selectedId)
                  setDetail(
                    await apiFetch<Detail>(`${ENDPOINT}?id=${selectedId}`),
                  )
              })
            }
          >
            Ricarica
          </button>
        </div>
      )}
      {notice && (
        <div className={s.notice} role="status">
          {notice}
        </div>
      )}
      {loading && <p role="status">Caricamento assegnazioni…</p>}
      {data && (
        <>
          <div className={s.toolbar}>
            <button
              className={view === 'work' ? s.active : ''}
              onClick={() => setView('work')}
            >
              Attività e portafogli
            </button>
            {data.is_admin && (
              <>
                <button
                  className={view === 'team' ? s.active : ''}
                  onClick={() => setView('team')}
                >
                  Team e accessi
                </button>
                <button
                  className={view === 'rules' ? s.active : ''}
                  onClick={() => setView('rules')}
                >
                  Regole di assegnazione
                </button>
                <label className={s.check}>
                  <input
                    type="checkbox"
                    checked={mine}
                    onChange={(e) => {
                      setMine(e.target.checked)
                      setPage(0)
                    }}
                  />
                  Solo il mio lavoro
                </label>
              </>
            )}
            {data.identity.access_kind === 'external' && (
              <span className={s.badge}>
                Accesso partner · solo schede condivise
              </span>
            )}
          </div>
          {view === 'work' && (
            <>
              <div className={s.stats}>
                {(
                  [
                    ['today', 'Da fare oggi'],
                    ['overdue', 'Scadute'],
                    ['fresh', 'Da prendere in carico'],
                    ['stale', 'Ferme da 14 giorni'],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    className={`${s.stat} ${filter === key ? s.active : ''}`}
                    onClick={() => setFilter(key)}
                  >
                    <span>{label}</span>
                    <strong>{data.summary?.[key] ?? '—'}</strong>
                    <small>Apri elenco</small>
                  </button>
                ))}
              </div>
              <div className={s.toolbar}>
                <input
                  aria-label="Cerca nel lavoro caricato"
                  placeholder="Cerca nelle schede di questa pagina…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  style={{ flex: 1, minWidth: 200 }}
                />
                <select
                  aria-label="Filtra attività"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  style={{ width: 'auto' }}
                >
                  <option value="open">Aperte</option>
                  <option value="all">Tutte</option>
                  <option value="today">Oggi</option>
                  <option value="overdue">Scadute</option>
                  <option value="fresh">Nuove assegnazioni</option>
                  <option value="stale">Ferme</option>
                  <option value="closed">Concluse / archiviate</option>
                </select>
              </div>
              <p className={s.muted}>
                {data.total} schede accessibili · pagina {page + 1} · ricerca e
                filtro sull’elenco caricato. Le scadenze sono espresse in UTC.
              </p>
              <div className={s.layout}>
                <div className={s.list}>
                  {items.map((item) => {
                    const flags = workFlags(item)
                    return (
                      <button
                        key={item.id}
                        className={`${s.card} ${selectedId === item.id ? s.active : ''}`}
                        onClick={() => {
                          setSelectedId(item.id)
                          setCreating(false)
                        }}
                      >
                        <div className={s.badges}>
                          <span className={s.badge}>
                            {WORK_KINDS[item.kind]}
                          </span>
                          <span className={s.badge}>
                            {WORK_STAGES[item.stage]}
                          </span>
                          {flags.overdue && (
                            <span className={`${s.badge} ${s.urgent}`}>
                              Scaduta
                            </span>
                          )}
                          {flags.fresh && (
                            <span className={s.badge}>
                              Da prendere in carico
                            </span>
                          )}
                          {flags.stale && (
                            <span className={s.badge}>Ferma da 14 giorni</span>
                          )}
                        </div>
                        <strong>{item.title}</strong>
                        <span className={s.muted}>
                          {memberName(item.responsible_id)} ·{' '}
                          {item.country_code || 'Tutti i territori'}
                          {item.segment ? ` · ${item.segment}` : ''}
                        </span>
                        <p>{item.next_action}</p>
                        <small>
                          Scadenza: {item.due_on || 'Conclusa'}
                          {item.parent_id ? ' · parte di un portafoglio' : ''}
                        </small>
                      </button>
                    )
                  })}
                  {!items.length && (
                    <div className={`${s.panel} ${s.empty}`}>
                      Nessuna scheda in questa vista.
                      {data.is_admin
                        ? ' Assegna lavoro dalla directory o crea una scheda.'
                        : 'Le nuove assegnazioni compariranno qui.'}
                    </div>
                  )}
                  <div className={s.toolbar}>
                    <button
                      disabled={!page || busy}
                      onClick={() => {
                        setPage((p) => p - 1)
                        setSelectedId(null)
                      }}
                    >
                      Precedente
                    </button>
                    <button
                      disabled={(page + 1) * 100 >= data.total || busy}
                      onClick={() => {
                        setPage((p) => p + 1)
                        setSelectedId(null)
                      }}
                    >
                      Successiva
                    </button>
                  </div>
                </div>
                <section className={s.panel} aria-label="Scheda lavoro">
                  {creating && data.is_admin ? (
                    <CreateWork
                      members={data.members}
                      rules={data.rules}
                      portfolios={[
                        ...data.items.filter(
                          (i) => !i.parent_id && i.id !== createParent?.id,
                        ),
                        ...(createParent ? [createParent] : []),
                      ]}
                      initialSources={createSources}
                      initialParent={createParent?.id || ''}
                      busy={busy}
                      submit={(body) =>
                        act(async () => {
                          const result = await mutate(body)
                          setCreating(false)
                          setCreateSources([])
                          window.history.replaceState(
                            null,
                            '',
                            window.location.pathname,
                          )
                          await load()
                          setNotice(
                            typeof result.created === 'number'
                              ? `${result.created} schede create; le fonti già assegnate sono state conservate.`
                              : 'Lavoro assegnato',
                          )
                          if (result.item)
                            setSelectedId((result.item as WorkItem).id)
                        })
                      }
                      cancel={() => {
                        setCreating(false)
                        setCreateSources([])
                      }}
                    />
                  ) : detail ? (
                    <WorkDetail
                      key={`${detail.item.id}:${detail.item.version}`}
                      detail={detail}
                      data={data}
                      busy={busy}
                      generation={generation}
                      memberName={memberName}
                      open={setSelectedId}
                      createChild={() => {
                        setCreateParent(detail.item)
                        setCreateSources([])
                        setCreating(true)
                      }}
                      save={(body) =>
                        act(async () => {
                          await mutate(
                            {
                              id: detail.item.id,
                              version: detail.item.version,
                              ...body,
                            },
                            'PATCH',
                          )
                          await refreshDetail()
                          setNotice('Scheda aggiornata')
                        })
                      }
                      handoff={(body) =>
                        act(async () => {
                          await mutate({
                            action: 'handoff',
                            id: detail.item.id,
                            version: detail.item.version,
                            ...body,
                          })
                          await refreshDetail()
                          setNotice(
                            'Assegnazione aggiornata anche per le schede del portafoglio',
                          )
                        })
                      }
                      note={(body) =>
                        act(async () => {
                          await mutate({
                            action: 'note',
                            id: detail.item.id,
                            ...body,
                          })
                          await refreshDetail()
                          setNotice('Riscontro salvato')
                        })
                      }
                      assist={(mode) =>
                        act(async () => {
                          const result = await mutate({
                            action: 'assist',
                            id: detail.item.id,
                            mode,
                          })
                          setGeneration(String(result.text))
                        })
                      }
                    />
                  ) : (
                    <div className={s.empty}>
                      {selectedId
                        ? 'Caricamento scheda…'
                        : 'Apri una scheda per vedere contesto, prossimi passi, documenti e storico.'}
                    </div>
                  )}
                </section>
              </div>
            </>
          )}
          {view === 'team' && data.is_admin && (
            <section className={s.panel}>
              <h2>Distribuisci il lavoro al team</h2>
              <p className={s.muted}>
                Abilita gli utenti già presenti. I partner esterni vedono
                esclusivamente le schede assegnate e le note condivise. Gli
                interni assegnati vedono anche le note interne. La
                riassegnazione resta al proprietario.
              </p>
              <div className={s.scroll}>
                <table className={s.table}>
                  <thead>
                    <tr>
                      <th>Persona</th>
                      <th>Accesso</th>
                      <th>Carico aperto</th>
                      <th>Scadute</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.members.map((m) => {
                      const workload = data.summary?.loads.find(
                        (l) => l.member_id === m.id,
                      )
                      return (
                        <tr key={m.id}>
                          <td>{m.name}</td>
                          <td>
                            <select
                              aria-label={`Accesso ${m.name}`}
                              disabled={busy}
                              value={m.enabled ? m.access_kind : 'disabled'}
                              onChange={(e) => {
                                const value = e.target.value
                                act(async () => {
                                  await mutate({
                                    action: 'member',
                                    member_id: m.id,
                                    enabled: value !== 'disabled',
                                    access_kind:
                                      value === 'internal'
                                        ? 'internal'
                                        : 'external',
                                  })
                                  await load()
                                  setNotice('Accesso aggiornato')
                                })
                              }}
                            >
                              <option value="disabled">Disabilitato</option>
                              <option value="internal">Interno</option>
                              <option value="external">Partner esterno</option>
                            </select>
                          </td>
                          <td>{workload?.open || 0}</td>
                          <td>{workload?.overdue || 0}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {!data.members.length && (
                <p>
                  Aggiungi prima gli utenti in{' '}
                  <Link href="/impostazioni/team">Impostazioni → Team</Link>.
                </p>
              )}
            </section>
          )}
          {view === 'rules' && data.is_admin && (
            <section className={s.panel}>
              <h2>Regole per territorio e competenza</h2>
              <p className={s.muted}>
                Definisci paese, segmento e persone adatte. Quando applichi una
                regola a una selezione, il sistema sceglie tra queste la persona
                con meno schede aperte.
              </p>
              {data.rules.map((rule) => (
                <div className={s.card} key={rule.id}>
                  <strong>{rule.name}</strong>
                  <p>
                    {rule.country_code || 'Tutti i paesi'} ·{' '}
                    {rule.segment || 'Tutti i segmenti'} ·{' '}
                    {rule.member_ids.map(memberName).join(', ')}
                  </p>
                  <button
                    disabled={busy}
                    onClick={() =>
                      act(async () => {
                        await mutate({
                          action: 'rule',
                          id: rule.id,
                          name: rule.name,
                          enabled: !rule.enabled,
                        })
                        await load()
                      })
                    }
                  >
                    {rule.enabled ? 'Disattiva' : 'Attiva'}
                  </button>
                </div>
              ))}
              <hr className={s.divider} />
              <RuleForm
                members={data.members.filter((m) => m.enabled)}
                busy={busy}
                submit={(body) =>
                  act(async () => {
                    await mutate({ action: 'rule', ...body })
                    await load()
                    setNotice('Regola salvata')
                  })
                }
              />
            </section>
          )}
        </>
      )}
    </main>
  )
}

function MemberSelect({
  members,
  value,
  onChange,
  disabled = false,
}: {
  members: WorkMember[]
  value: string
  onChange: (v: string) => void
  disabled?: boolean
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
    >
      <option value="">Proprietario</option>
      {members.map((m) => (
        <option key={m.id} value={m.id}>
          {m.name}
          {m.enabled ? '' : ' · accesso disabilitato'}
        </option>
      ))}
    </select>
  )
}
function Collaborators({
  members,
  selected,
  change,
}: {
  members: WorkMember[]
  selected: string[]
  change: (v: string[]) => void
}) {
  return (
    <div>
      <span className={s.muted}>Collaboratori</span>
      {members.map((m) => (
        <label className={s.check} key={m.id}>
          <input
            type="checkbox"
            checked={selected.includes(m.id)}
            onChange={(e) =>
              change(
                e.target.checked
                  ? [...selected, m.id]
                  : selected.filter((id) => id !== m.id),
              )
            }
          />
          {m.name}
        </label>
      ))}
    </div>
  )
}
function WorkDetail({
  detail,
  data,
  busy,
  generation,
  save,
  handoff,
  note,
  assist,
  memberName,
  open,
  createChild,
}: {
  detail: Detail
  data: Data
  busy: boolean
  generation: string
  memberName: (id: string | null) => string
  open: (id: string) => void
  createChild: () => void
  save: (v: object) => void
  handoff: (v: object) => void
  note: (v: object) => void
  assist: (mode: string) => void
}) {
  const item = detail.item
  const [stage, setStage] = useState(item.stage),
    [action, setAction] = useState(item.next_action),
    [due, setDue] = useState(item.due_on || ''),
    [reason, setReason] = useState(item.reason)
  const [responsible, setResponsible] = useState(item.responsible_id || ''),
    [collaborators, setCollaborators] = useState(item.collaborator_ids)
  const [context, setContext] = useState(item.shared_context),
    [website, setWebsite] = useState(item.website)
  const [text, setText] = useState(''),
    [visibility, setVisibility] = useState(
      data.identity.access_kind === 'external' ? 'shared' : 'internal',
    ),
    [url, setUrl] = useState('')
  return (
    <>
      <div className={s.eyebrow}>
        {WORK_KINDS[item.kind]} · {memberName(item.responsible_id)}
      </div>
      <h2>{item.title}</h2>
      {item.parent_id && (
        <button onClick={() => open(item.parent_id!)}>
          Apri partner / portafoglio
        </button>
      )}
      {!item.parent_id && (
        <>
          <h3>Opportunità e attività collegate</h3>
          {(detail.children || []).map((child) => (
            <button
              className={s.card}
              key={child.id}
              onClick={() => open(child.id)}
            >
              <strong>{child.title}</strong>
              {WORK_STAGES[child.stage]} · {child.next_action}
            </button>
          ))}
          {detail.children_truncated && (
            <p className={s.muted}>
              Prime 100 schede collegate. Le altre sono nell’elenco generale.
            </p>
          )}
          {data.is_admin && (
            <button disabled={busy} onClick={createChild}>
              ＋ Attività o opportunità collegata
            </button>
          )}
        </>
      )}
      {item.website && (
        <a href={item.website} target="_blank" rel="noopener noreferrer">
          Apri sito / fonte ↗
        </a>
      )}
      <p style={{ whiteSpace: 'pre-wrap' }}>
        {item.shared_context || 'Contesto da completare con il responsabile.'}
      </p>
      {data.is_admin && (
        <details>
          <summary>Modifica contesto condiviso</summary>
          <form
            className={s.form}
            onSubmit={(e) => {
              e.preventDefault()
              save({ shared_context: context, website })
            }}
          >
            <label>
              Interessi, contatti e informazioni da condividere
              <textarea
                maxLength={10000}
                value={context}
                onChange={(e) => setContext(e.target.value)}
              />
            </label>
            <label>
              Sito o fonte
              <input
                type="url"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
              />
            </label>
            <button disabled={busy}>Salva contesto</button>
          </form>
        </details>
      )}
      {!item.acknowledged_at && (
        <button disabled={busy} onClick={() => save({ acknowledge: true })}>
          Prendi in carico
        </button>
      )}
      {(item.checklist || []).length > 0 && (
        <>
          <h3>Checklist di verifica</h3>
          {item.checklist.map((step, index) => (
            <label className={s.check} key={index}>
              <input
                type="checkbox"
                checked={step.done}
                disabled={busy}
                onChange={(e) =>
                  save({
                    checklist: item.checklist.map((entry, i) =>
                      i === index
                        ? { ...entry, done: e.target.checked }
                        : entry,
                    ),
                  })
                }
              />
              {step.label}
            </label>
          ))}
        </>
      )}
      <form
        className={s.form}
        onSubmit={(e) => {
          e.preventDefault()
          save({ stage, next_action: action, due_on: due || null, reason })
        }}
      >
        <label>
          Stato commerciale
          <select
            value={stage}
            onChange={(e) => setStage(e.target.value as typeof stage)}
          >
            {Object.entries(WORK_STAGES).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Prossima azione
          <textarea
            required
            minLength={2}
            maxLength={1000}
            value={action}
            onChange={(e) => setAction(e.target.value)}
          />
        </label>
        <label>
          Scadenza / richiamo (UTC)
          <input
            type="date"
            required={!['agreement', 'archived'].includes(stage)}
            value={due}
            onChange={(e) => setDue(e.target.value)}
          />
        </label>
        <label>
          Motivazione{' '}
          {['waiting', 'archived'].includes(stage) ? '(obbligatoria)' : ''}
          <input
            required={['waiting', 'archived'].includes(stage)}
            minLength={['waiting', 'archived'].includes(stage) ? 2 : undefined}
            maxLength={1000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <button className={s.primary} disabled={busy}>
          Salva prossimo passo
        </button>
      </form>
      {data.is_admin && (
        <>
          <hr className={s.divider} />
          <form
            className={s.form}
            onSubmit={(e) => {
              e.preventDefault()
              handoff({
                responsible_id: responsible || null,
                collaborator_ids: collaborators,
              })
            }}
          >
            <label>
              Responsabile principale
              <MemberSelect
                members={data.members}
                value={responsible}
                onChange={setResponsible}
              />
            </label>
            <Collaborators
              members={data.members}
              selected={collaborators}
              change={setCollaborators}
            />
            <p className={s.muted}>
              Il passaggio include tutte le schede figlie del portafoglio e
              conserva lo storico.
            </p>
            <button disabled={busy}>Passa al collega</button>
          </form>
        </>
      )}
      <hr className={s.divider} />
      <h2>Note, conversazioni e documenti</h2>
      <form
        className={s.form}
        onSubmit={(e) => {
          e.preventDefault()
          note({ body: text, visibility, document_url: url })
        }}
      >
        <label>
          Nuovo riscontro
          <textarea
            required
            minLength={2}
            maxLength={10000}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <label>
          Visibilità
          <select
            value={visibility}
            onChange={(e) => setVisibility(e.target.value)}
          >
            {data.identity.access_kind !== 'external' && (
              <option value="internal">Interna · team assegnato</option>
            )}
            <option value="shared">Condivisa · anche con il partner</option>
          </select>
        </label>
        <label>
          Link a un documento (facoltativo)
          <input
            type="url"
            placeholder="https://…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </label>
        <button disabled={busy}>Aggiungi riscontro</button>
      </form>
      {detail.notes.map((n) => (
        <div className={s.note} key={n.id}>
          <small>
            {n.visibility === 'internal' ? 'Interna' : 'Condivisa'} ·{' '}
            {dateLabel(n.created_at)} UTC
          </small>
          <p>{n.body}</p>
          {n.document_url && (
            <a href={n.document_url} target="_blank" rel="noopener noreferrer">
              Apri documento ↗
            </a>
          )}
        </div>
      ))}
      <hr className={s.divider} />
      <h2>Prepara il prossimo contatto</h2>
      <div className={s.toolbar}>
        <button disabled={busy} onClick={() => assist('brief')}>
          Riepilogo prima della chiamata
        </button>
        <button
          disabled={busy || !data.ai_configured}
          onClick={() => assist('draft')}
        >
          Bozza follow-up AI
        </button>
      </div>
      <p className={s.muted}>
        {data.ai_configured
          ? 'Bozze da rivedere. La bozza per il partner usa soltanto i riscontri condivisi.'
          : 'Il riepilogo è disponibile. Per le bozze AI serve la configurazione del provider.'}
      </p>
      {generation && <pre aria-label="Testo preparato">{generation}</pre>}
      <hr className={s.divider} />
      <details>
        <summary>
          Storico della scheda · ultime {detail.events.length} modifiche
        </summary>
        {detail.events.map((event) => (
          <div className={s.note} key={event.id}>
            <small>
              {dateLabel(event.created_at)} UTC ·{' '}
              {event.actor_id === item.user_id
                ? 'Proprietario'
                : 'Collaboratore'}
            </small>
            <p>
              {event.event}:{' '}
              {Object.entries(event.changes)
                .map(
                  ([k, v]) =>
                    `${({ stage: 'stato', responsible_id: 'responsabile', collaborator_ids: 'collaboratori', next_action: 'prossima azione', due_on: 'scadenza', acknowledged_at: 'presa in carico', title: 'titolo', reason: 'motivazione', shared_context: 'contesto' } as Record<string, string>)[k] || k}: ${k === 'responsible_id' ? memberName(v as string | null) : k === 'stage' ? WORK_STAGES[v as keyof typeof WORK_STAGES] : typeof v === 'string' ? v : JSON.stringify(v)}`,
                )
                .join(' · ')}
            </p>
          </div>
        ))}
      </details>
    </>
  )
}

function CreateWork({
  members,
  rules,
  portfolios,
  initialSources,
  initialParent,
  busy,
  submit,
  cancel,
}: {
  members: WorkMember[]
  rules: WorkRule[]
  portfolios: WorkItem[]
  initialSources: string[]
  initialParent: string
  busy: boolean
  submit: (body: object) => void
  cancel: () => void
}) {
  const [mode, setMode] = useState(
      initialSources.length ? 'entities' : 'manual',
    ),
    [kind, setKind] = useState(initialParent ? 'task' : 'partner'),
    [responsible, setResponsible] = useState(''),
    [parent, setParent] = useState(initialParent)
  const [collaborators, setCollaborators] = useState<string[]>([]),
    [query, setQuery] = useState(''),
    [sources, setSources] = useState<Sources>({ entities: [], signals: [] }),
    [sourceError, setSourceError] = useState('')
  const [ids, setIds] = useState<string[]>(initialSources),
    [signal, setSignal] = useState(''),
    [rule, setRule] = useState('')
  useEffect(() => {
    let live = true
    const t = setTimeout(() => {
      apiFetch<Sources>(
        `${ENDPOINT}?view=sources&q=${encodeURIComponent(query)}`,
      )
        .then((r) => {
          if (live) {
            setSources(r)
            setSourceError('')
          }
        })
        .catch((e) => {
          if (live) setSourceError(e.message)
        })
    }, 300)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [query])
  const send = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const base = {
      responsible_id: responsible || null,
      parent_id: parent || null,
      next_action: String(f.get('next_action')),
      due_on: String(f.get('due_on')),
      collaborator_ids: collaborators,
    }
    if (mode === 'entities')
      submit({
        action: 'assign_entities',
        ...base,
        ids,
        rule_id: parent ? null : rule || null,
      })
    else if (mode === 'signal')
      submit({
        action: 'signal',
        ...base,
        signal_id: signal,
        shared_context: String(f.get('shared_context') || ''),
      })
    else
      submit({
        action: 'create',
        ...base,
        kind,
        title: String(f.get('title')),
        country_code: String(f.get('country_code')).trim().toUpperCase(),
        segment: String(f.get('segment')).trim(),
        shared_context: String(f.get('shared_context') || ''),
      })
  }
  return (
    <>
      <h2>Assegna lavoro</h2>
      <form className={s.form} onSubmit={send}>
        <label>
          Parti da
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="manual">Nuova scheda / portafoglio</option>
            <option value="entities">
              Partner o territori dalla directory
            </option>
            <option value="signal">Segnale dalla ricerca intelligence</option>
          </select>
        </label>
        {mode === 'manual' ? (
          <>
            <label>
              Tipo
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                {Object.entries(WORK_KINDS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Titolo
              <input name="title" required minLength={2} maxLength={200} />
            </label>
            <div className={s.row}>
              <label>
                Paese (codice ISO)
                <input
                  name="country_code"
                  maxLength={2}
                  pattern="[A-Za-z]{2}"
                  placeholder="IT"
                />
              </label>
              <label>
                Segmento / competenza
                <input
                  name="segment"
                  maxLength={100}
                  placeholder="hotel, tour_operator…"
                />
              </label>
            </div>
          </>
        ) : (
          <>
            <label>
              Cerca nella directory o nei segnali
              <input value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
            {sourceError && (
              <p role="alert" className={s.error}>
                {sourceError}
              </p>
            )}
            <div className={s.sources}>
              {mode === 'entities'
                ? sources.entities.map((entity) => (
                    <label className={s.check} key={entity.id}>
                      <input
                        type="checkbox"
                        checked={ids.includes(entity.id)}
                        onChange={(e) =>
                          setIds(
                            e.target.checked
                              ? [...ids, entity.id]
                              : ids.filter((id) => id !== entity.id),
                          )
                        }
                      />
                      {entity.name} · {entity.country_code} ·{' '}
                      {entity.type_code || entity.kind}
                    </label>
                  ))
                : sources.signals.map((source) => (
                    <label className={s.check} key={source.id}>
                      <input
                        type="radio"
                        name="signal"
                        required
                        value={source.id}
                        checked={signal === source.id}
                        onChange={() => setSignal(source.id)}
                      />
                      {source.title}
                    </label>
                  ))}
              {!(mode === 'entities'
                ? sources.entities.length
                : sources.signals.length) && (
                <p>
                  Nessuna fonte trovata. Puoi creare una scheda manualmente.
                </p>
              )}
            </div>
            {mode === 'entities' && (
              <small>
                {ids.length} selezionate · massimo 100. Dati condivisi
                automaticamente: nome, paese, segmento e sito pubblico.
              </small>
            )}
          </>
        )}
        <label>
          Portafoglio padre (facoltativo)
          <select value={parent} onChange={(e) => setParent(e.target.value)}>
            <option value="">Scheda indipendente</option>
            {portfolios.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </label>
        {parent ? (
          <p className={s.muted}>
            Responsabile e collaboratori vengono ereditati dal portafoglio.
          </p>
        ) : (
          <>
            {mode === 'entities' && (
              <label>
                Assegna con una regola
                <select value={rule} onChange={(e) => setRule(e.target.value)}>
                  <option value="">Scelta manuale</option>
                  {rules
                    .filter((r) => r.enabled)
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                </select>
              </label>
            )}
            {!rule && (
              <label>
                Responsabile
                <MemberSelect
                  members={members}
                  value={responsible}
                  onChange={setResponsible}
                />
              </label>
            )}
            {mode !== 'entities' && (
              <Collaborators
                members={members}
                selected={collaborators}
                change={setCollaborators}
              />
            )}
          </>
        )}
        {mode !== 'entities' && (
          <label>
            Contesto da condividere
            <textarea
              name="shared_context"
              maxLength={10000}
              placeholder="Interessi, contatti autorizzati, obiettivo e informazioni utili al collega…"
            />
          </label>
        )}
        <label>
          Prossima azione
          <input
            name="next_action"
            required
            minLength={2}
            maxLength={1000}
            defaultValue={
              mode === 'signal'
                ? 'Verificare il segnale e definire un contatto'
                : 'Qualificare il partner e verificare il referente'
            }
          />
        </label>
        <label>
          Scadenza (UTC)
          <input type="date" name="due_on" defaultValue={tomorrow()} required />
        </label>
        <p className={s.muted}>
          I segnali restano ipotesi da verificare. La creazione conserva la
          fonte e non attiva trial o accordi commerciali.
        </p>
        <div className={s.toolbar}>
          <button
            className={s.primary}
            disabled={
              busy ||
              (mode === 'entities' && !ids.length) ||
              (mode === 'signal' && !signal)
            }
          >
            Assegna lavoro
          </button>
          <button type="button" disabled={busy} onClick={cancel}>
            Annulla
          </button>
        </div>
      </form>
    </>
  )
}
function RuleForm({
  members,
  busy,
  submit,
}: {
  members: WorkMember[]
  busy: boolean
  submit: (v: object) => void
}) {
  const [selected, setSelected] = useState<string[]>([])
  return (
    <form
      className={s.form}
      onSubmit={(e) => {
        e.preventDefault()
        const f = new FormData(e.currentTarget)
        submit({
          name: f.get('name'),
          country_code: String(f.get('country_code')).trim().toUpperCase(),
          segment: String(f.get('segment')).trim(),
          member_ids: selected,
          enabled: true,
        })
      }}
    >
      <label>
        Nome regola
        <input
          name="name"
          required
          minLength={2}
          maxLength={200}
          placeholder="Italia · tour operator"
        />
      </label>
      <div className={s.row}>
        <label>
          Paese (vuoto = tutti)
          <input name="country_code" pattern="[A-Za-z]{2}" maxLength={2} />
        </label>
        <label>
          Codice segmento (vuoto = tutti)
          <input name="segment" placeholder="tour_operator" maxLength={100} />
        </label>
      </div>
      <Collaborators
        members={members}
        selected={selected}
        change={setSelected}
      />
      <button disabled={busy || !selected.length}>Salva regola</button>
    </form>
  )
}
