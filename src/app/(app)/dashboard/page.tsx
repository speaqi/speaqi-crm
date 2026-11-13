'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useCRMContext } from '@/components/layout/CRMContext'
import { ContactDrawer } from '@/components/crm/ContactDrawer'
import { CallOutcomeModal } from '@/components/crm/CallOutcomeModal'
import TourismWork from '@/components/tourism/TourismWork'
import TodoPage from '../todo/page'
import CalendarioPage from '../calendario/page'
import PreviousDashboard from '@/components/crm/PreviousDashboard'
import { canAccessPath } from '@/lib/areas'
import { apiFetch } from '@/lib/api'
import { isClosedStatus, isHiddenContact } from '@/lib/data'
import { localDayDateKey, isCallTaskType, buildScheduledCalls } from '@/lib/schedule'
import { closedWork, type WorkItem } from '@/lib/tourism-work'
import type { Task, CRMContact, TaskWithContact } from '@/types'
import styles from './workday.module.css'

type Row = { id: string; kind: 'task' | 'call' | 'tourism'; title: string; detail: string; date: string | null; fresh?: boolean; task?: Task; contact?: CRMContact; callTask?: TaskWithContact | null; work?: WorkItem }
type Bucket = 'overdue' | 'today' | 'new' | 'future' | 'unplanned'
const labels: Record<Bucket, string> = { overdue: 'Scaduti', today: 'Oggi', new: 'Nuove assegnazioni', future: 'Prossimi giorni', unplanned: 'Da pianificare' }
const order: Bucket[] = ['overdue', 'today', 'new', 'unplanned', 'future']

export default function WorkdayPage() {
  const crm = useCRMContext()
  const { isAdmin, allowedAreas, loading, stages, completeTask, updateContact, addActivity, refresh, showToast } = crm
  const canTodo = canAccessPath('/todo', allowedAreas, isAdmin)
  const canCalls = canAccessPath('/calendario', allowedAreas, isAdmin)
  const canTourism = canAccessPath('/tourism-lavoro', allowedAreas, isAdmin)
  const [tasks, setTasks] = useState<Task[]>([])
  const [work, setWork] = useState<WorkItem[]>([])
  const [errors, setErrors] = useState<{ todo?: string; tourism?: string }>({})
  const [pending, setPending] = useState({ todo: false, tourism: false })
  const [busy, setBusy] = useState('')
  const [title, setTitle] = useState('')
  const [date, setDate] = useState('')
  const [filter, setFilter] = useState<'all' | Row['kind']>('all')
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<Partial<Record<Bucket, boolean>>>({})
  const [drawer, setDrawer] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<{ contact: CRMContact; task: TaskWithContact | null } | null>(null)
  const [selectedWork, setSelectedWork] = useState<string | null>(null)
  const [panel, setPanel] = useState<'tourism' | 'todo' | 'calls' | 'overview' | null>(null)
  const today = localDayDateKey(new Date())

  const loadTasks = useCallback(async () => {
    setPending((p) => ({ ...p, todo: true }))
    try {
      const result = await apiFetch<{ tasks: Task[] }>('/api/tasks/standalone?status=pending')
      setTasks(result.tasks || [])
      setErrors((e) => ({ ...e, todo: undefined }))
    } catch (e) { setErrors((v) => ({ ...v, todo: e instanceof Error ? e.message : 'Impossibile caricare le attività' })) } finally { setPending((p) => ({ ...p, todo: false })) }
  }, [])
  const loadWork = useCallback(async () => {
    setPending((p) => ({ ...p, tourism: true }))
    try {
      const all: WorkItem[] = []
      let page = 0
      let total = 0
      do {
        const result = await apiFetch<{ items: WorkItem[]; total: number }>(`/api/tourism/work?page=${page}`)
        all.push(...result.items)
        total = result.total
        if (!result.items.length) break
        page++
      } while (all.length < total)
      setWork(all)
      setErrors((e) => ({ ...e, tourism: undefined }))
    } catch (e) { setErrors((v) => ({ ...v, tourism: e instanceof Error ? e.message : 'Impossibile caricare il lavoro Turismo' })) } finally { setPending((p) => ({ ...p, tourism: false })) }
  }, [])
  useEffect(() => { if (!loading && canTodo) void loadTasks() }, [loading, canTodo, loadTasks])
  useEffect(() => { if (!loading && canTourism) void loadWork() }, [loading, canTourism, loadWork])

  const allCalls = useMemo(() => {
    const contacts = crm.allContacts.filter((c) => !isHiddenContact(c))
    const scheduled = buildScheduledCalls(contacts, crm.allTasks)
    const seen = new Set(scheduled.map((c) => c.contact.id))
    const remaining = contacts.filter((c) => !seen.has(c.id) && !isClosedStatus(c.status)).map((contact) => ({ contact, task: null, due_at: contact.next_followup_at || '', task_type: 'follow-up', source: 'contact' as const }))
    return [...scheduled, ...remaining]
  }, [crm.allContacts, crm.allTasks])
  const rows = useMemo<Row[]>(() => [
    ...(canTodo ? tasks.map((task): Row => ({ id: task.id, kind: 'task', title: task.title || task.note || 'Attività', detail: [task.note && task.title ? task.note : 'Da fare', task.area].filter(Boolean).join(' · '), date: task.due_date || null, task })) : []),
    ...(canTodo ? crm.allTasks.filter((task) => task.contact_id && task.status === 'pending' && !isCallTaskType(task.type)).map((task): Row => ({ id: task.id, kind: 'task', title: task.title || task.note || task.type, detail: task.contact?.name ? `Contatto: ${task.contact.name}` : 'Attività contatto', date: task.due_date || null, task })) : []),
    ...(canCalls ? allCalls.map((call): Row => ({ id: call.contact.id, kind: 'call', title: call.contact.company || call.contact.name, detail: [call.due_at ? (call.task_type === 'call' ? 'Chiamata' : 'Follow-up') : 'Da pianificare', call.contact.company && call.contact.name, call.contact.category, call.contact.list_name, call.contact.source].filter(Boolean).join(' · '), date: call.due_at || null, contact: call.contact, callTask: call.task })) : []),
    ...(canTourism ? work.filter((item) => !closedWork(item)).map((item): Row => ({ id: item.id, kind: 'tourism', title: item.title, detail: item.next_action, date: item.due_on, fresh: !item.acknowledged_at, work: item })) : []),
  ], [canTodo, canCalls, canTourism, tasks, crm.allTasks, allCalls, work])
  const groups = useMemo(() => {
    const result: Record<Bucket, Row[]> = { overdue: [], today: [], new: [], future: [], unplanned: [] }
    for (const row of rows) {
      if (filter !== 'all' && row.kind !== filter) continue
      if (search.trim() && !`${row.title} ${row.detail} ${row.contact?.email || ''}`.toLowerCase().includes(search.trim().toLowerCase())) continue
      const key = row.date ? (row.date.length === 10 ? row.date : localDayDateKey(new Date(row.date))) : null
      const bucket: Bucket = key && key < today ? 'overdue' : key === today ? 'today' : row.fresh ? 'new' : key ? 'future' : 'unplanned'
      result[bucket].push(row)
    }
    for (const group of order) result[group].sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.title.localeCompare(b.title))
    return result
  }, [rows, filter, today, search])

  async function addTask(event: React.FormEvent) {
    event.preventDefault()
    if (!title.trim()) return
    setBusy('new')
    try {
      await apiFetch('/api/tasks/standalone', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: title.trim(), due_date: date ? new Date(`${date}T12:00:00`).toISOString() : null, area: 'speaqi' }) })
      setTitle(''); setDate(''); await loadTasks()
    } catch (e) { showToast(e instanceof Error ? e.message : 'Impossibile aggiungere l’attività') } finally { setBusy('') }
  }
  async function finishTask(task: Task) {
    setBusy(task.id)
    try { if (task.contact_id) { await completeTask(task.id); } else { await apiFetch('/api/tasks/standalone', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: task.id, status: 'done' }) }); await loadTasks() } }
    catch (e) { showToast(e instanceof Error ? e.message : 'Impossibile completare') } finally { setBusy('') }
  }
  async function handleContact(row: Row, choice: 'lost' | 'tomorrow' | 'week' | 'months') {
    if (!row.contact) return
    setBusy(row.id)
    try {
      if (choice === 'lost') {
        await updateContact(row.id, { status: 'Lost', next_followup_at: '' })
        showToast('Contatto segnato come perso')
      } else {
        const date = new Date()
        if (choice === 'months') {
          const day = date.getDate(); date.setDate(1); date.setMonth(date.getMonth() + 3)
          date.setDate(Math.min(day, new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()))
        } else date.setDate(date.getDate() + (choice === 'week' ? 7 : 1))
        date.setHours(9, 0, 0, 0)
        await updateContact(row.id, { next_followup_at: date.toISOString() })
        showToast(`Ricontatto fissato per ${date.toLocaleDateString('it-IT')}`)
      }
      await refresh()
    } catch (e) { showToast(e instanceof Error ? e.message : 'Impossibile aggiornare il contatto') } finally { setBusy('') }
  }
  function openPanel(next: typeof panel, workId: string | null = null) {
    setSelectedWork(workId); setPanel(next)
    window.setTimeout(() => document.getElementById('workday-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }
  function closePanel() { setPanel(null); if (canTodo) void loadTasks(); if (canTourism) void loadWork(); void refresh() }

  return <main className={styles.page}>
    <header className={styles.header}><div><p className={styles.eyebrow}>IL MIO LAVORO</p><h1>La tua giornata, in un posto solo</h1><p>Attività, follow-up e Turismo insieme. Apri una voce per lavorarci.</p></div><button className="btn btn-ghost" onClick={() => { if (canTodo) void loadTasks(); if (canTourism) void loadWork(); void refresh() }}>Aggiorna</button></header>
    {canTodo && <form className={styles.capture} onSubmit={addTask}><label className={styles.srOnly} htmlFor="new-work">Nuova attività</label><input id="new-work" placeholder="Aggiungi una cosa da fare…" value={title} onChange={(e) => setTitle(e.target.value)} /><label className={styles.srOnly} htmlFor="new-date">Scadenza</label><input id="new-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /><button className="btn btn-primary" disabled={busy === 'new' || !title.trim()}>Aggiungi</button></form>}
    {Object.entries(errors).filter(([, value]) => value).map(([source, value]) => <p className={styles.error} key={source}>{source === 'todo' ? 'Attività' : 'Turismo'}: {value} <button type="button" onClick={() => source === 'todo' ? void loadTasks() : void loadWork()}>Riprova</button></p>)}
    {crm.error && <p className={styles.error}>CRM: {crm.error} <button type="button" onClick={() => void refresh()}>Riprova</button></p>}
    {(pending.todo || pending.tourism) && <p>Caricamento di attività e Turismo…</p>}
    <label className={styles.search}>Cerca contatto, azienda, categoria o attività <input className="fi" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Ad esempio: siti web" /></label>
    <div className={styles.filters} aria-label="Filtra il lavoro">{([['all', 'Tutto'], ['task', 'Da fare'], ['call', 'Follow-up'], ['tourism', 'Turismo']] as const).filter(([key]) => key === 'all' || (key === 'task' ? canTodo : key === 'call' ? canCalls : canTourism)).map(([key, label]) => <button key={key} type="button" aria-pressed={filter === key} className={filter === key ? styles.active : ''} onClick={() => setFilter(key)}>{label} <span>{key === 'all' ? rows.length : rows.filter((r) => r.kind === key).length}</span></button>)}</div>
    {loading ? <p>Caricamento del lavoro…</p> : order.map((bucket) => {
      const group = groups[bucket]
      if (!group.length) return null
      const shown = expanded[bucket] ? group : group.slice(0, bucket === 'future' || bucket === 'unplanned' ? 5 : 15)
      return <section className={styles.section} key={bucket}><h2>{labels[bucket]} <span>{group.length}</span></h2><div className={styles.list}>{shown.map((row) => <article className={styles.row} key={`${row.kind}:${row.id}`}><div className={styles.rowMain}><div className={styles.meta}><span>{row.kind === 'task' ? 'DA FARE' : row.kind === 'call' ? 'FOLLOW-UP' : 'TURISMO'}</span>{row.fresh && <span>NUOVA</span>}{row.date && <time>{new Date(row.date.length === 10 ? `${row.date}T12:00:00` : row.date).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' })}</time>}</div><strong>{row.title}</strong><p>{row.detail}</p></div><div className={styles.actions}>{row.kind === 'task' && <button className="btn btn-ghost btn-sm" disabled={busy === row.id} onClick={() => row.task && void finishTask(row.task)}>✓ Fatto</button>}{row.kind === 'call' && row.contact && <><button className="btn btn-primary btn-sm" onClick={() => setOutcome({ contact: row.contact!, task: row.callTask || null })}>Registra esito</button><button className="btn btn-ghost btn-sm" onClick={() => setDrawer(row.id)}>Apri contatto</button><div className={styles.quickActions} aria-label={`Azioni rapide ${row.title}`}><button type="button" disabled={busy === row.id} onClick={() => void handleContact(row, 'tomorrow')}>Domani</button><button type="button" disabled={busy === row.id} onClick={() => void handleContact(row, 'week')}>7 giorni</button><button type="button" disabled={busy === row.id} onClick={() => void handleContact(row, 'months')}>3 mesi</button><button type="button" disabled={busy === row.id} onClick={() => void handleContact(row, 'lost')}>Perso</button></div></>}{row.kind === 'tourism' && <button className="btn btn-primary btn-sm" onClick={() => openPanel('tourism', row.id)}>Gestisci</button>}</div></article>)}</div>{shown.length < group.length && <button className={styles.more} onClick={() => setExpanded((s) => ({ ...s, [bucket]: true }))}>Mostra tutte le {group.length} voci</button>}</section>
    })}
    {!loading && !pending.todo && !pending.tourism && rows.length === 0 && !crm.error && !Object.values(errors).some(Boolean) && <p className={styles.empty}>Nessuna attività aperta nelle aree disponibili.</p>}
    <section className={styles.tools}><h2>Gestisci il lavoro</h2><p>Strumenti completi, sempre in questa pagina.</p><div className={styles.filters}>{canTodo && <button onClick={() => openPanel('todo')}>Lavagna attività</button>}{canCalls && <button onClick={() => openPanel('calls')}>Calendario follow-up</button>}{canTourism && <button onClick={() => openPanel('tourism')}>Gestione Turismo</button>}{isAdmin && <button onClick={() => openPanel('overview')}>Altri strumenti Oggi</button>}</div></section>
    {panel && <section id="workday-detail" className={styles.detail}><div className={styles.detailHeader}><h2>{panel === 'todo' ? 'Lavagna attività' : panel === 'calls' ? 'Calendario follow-up' : panel === 'tourism' ? 'Gestione Turismo' : 'Altri strumenti Oggi'}</h2><button className="btn btn-ghost" onClick={closePanel}>Chiudi e aggiorna</button></div>{panel === 'todo' ? <TodoPage /> : panel === 'calls' ? <CalendarioPage /> : panel === 'tourism' ? <TourismWork key={selectedWork || 'list'} initialSelectedId={selectedWork} onChanged={loadWork} /> : <PreviousDashboard />}</section>}
    <ContactDrawer contactId={drawer} onClose={() => setDrawer(null)} />
    <CallOutcomeModal open={!!outcome} contact={outcome?.contact || null} task={outcome?.task} stages={stages} onClose={() => setOutcome(null)} onSave={async (payload) => { if (!outcome) return; if (outcome.task) await completeTask(outcome.task.id, { refresh: false }); if (payload.status !== outcome.contact.status || isClosedStatus(payload.status)) await updateContact(outcome.contact.id, { status: payload.status, next_followup_at: isClosedStatus(payload.status) ? '' : payload.next_followup_at }, { refresh: false }); await addActivity(outcome.contact.id, { type: 'call', content: payload.content, next_followup_at: isClosedStatus(payload.status) ? undefined : payload.next_followup_at, task_type: payload.task_type }, { refresh: false }); await refresh(); showToast('Esito registrato e follow-up aggiornato') }} />
  </main>
}
