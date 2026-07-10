'use client'

import Link from 'next/link'
import { DragEvent, MouseEvent, KeyboardEvent, useMemo, useState } from 'react'
import { ContactDrawer } from '@/components/crm/ContactDrawer'
import { ContactModal } from '@/components/crm/ContactModal'
import { DashboardHero } from '@/components/crm/DashboardHero'
import { DashboardPriorityQueue, type QueueItem } from '@/components/crm/DashboardPriorityQueue'
import { QuickDismissMenu } from '@/components/crm/QuickDismissMenu'
import { DashboardRecoveryPanel, type RecoveryItem } from '@/components/crm/DashboardRecoveryPanel'
import { DashboardRiskPanel } from '@/components/crm/DashboardRiskPanel'
import { DashboardEmailInbox } from '@/components/crm/DashboardEmailInbox'
import { useCRMContext } from '../layout'
import { isClosedStatus, isInactiveStatus, statusLabel } from '@/lib/data'
import { buildScheduledCalls, dueAtLocalDateKey, localDayDateKey, type ScheduledCall } from '@/lib/schedule'
import { startOfDay, dayKey } from '@/lib/schedule'
import type { ContactInput, CRMContact } from '@/types'
import { apiFetch } from '@/lib/api'

const DAY_MS = 24 * 60 * 60 * 1000
const DAYS_BACK = 7
const DAYS_AHEAD = 15

function formatItalianDate(date: Date) {
  return date.toLocaleDateString('it-IT', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
}

function dayLabelShort(date: Date, offset: number) {
  if (offset === 0) return 'Oggi'
  if (offset === 1) return 'Domani'
  return date.toLocaleDateString('it-IT', { weekday: 'long' })
}

function dayNumber(date: Date) {
  return date.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })
}

function followupLabel(value?: string | null) {
  if (!value) return 'Senza data'
  return new Date(value).toLocaleDateString('it-IT', {
    day: '2-digit',
    month: '2-digit',
  })
}

interface DragPayload {
  contactId: string
  taskId: string | null
  dueAt: string
  contactName: string
}

const DRAG_MIME = 'application/x-call'

type DayBucket = {
  key: string
  date: Date
  calls: ScheduledCall[]
  offset: number
  label?: string
  dateLabel?: string
  isPastRange?: boolean
}

function isInProgressStatus(status: string) {
  return status.toLowerCase() !== 'new' && !isClosedStatus(status)
}

export default function OggiPage() {
  const {
    contacts,
    allContacts,
    tasks: crmTasks,
    stages,
    teamMembers,
    isAdmin,
    viewerMemberName,
    authEmail,
    partnerContacts,
    standaloneTasks,
    createStandaloneTask,
    completeStandaloneTask,
    adminDashboardShowAllContacts,
    setAdminDashboardShowAllContacts,
    completeTask,
    updateTask,
    updateContact,
    deleteContact,
    refresh,
    showToast,
  } = useCRMContext()

  const [dragOverKey, setDragOverKey] = useState<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [drawerContactId, setDrawerContactId] = useState<string | null>(null)
  const [drawerAnchor, setDrawerAnchor] = useState<{ x: number; y: number } | null>(null)
  const [editingContact, setEditingContact] = useState<CRMContact | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [weekExpanded, setWeekExpanded] = useState(false)
  const [todoInput, setTodoInput] = useState('')
  const [todoAdding, setTodoAdding] = useState(false)
  const [generatingDraftId, setGeneratingDraftId] = useState<string | null>(null)

  const now = new Date()
  const today = startOfDay(now)
  const stagnantCutoff = new Date(today.getTime() - 14 * DAY_MS)

  // ─── Scope contacts (admin filtering) ───
  const scopeContactIds = useMemo(() => new Set(contacts.map((c) => c.id)), [contacts])
  const scopeTasks = useMemo(() => crmTasks, [crmTasks])

  // ─── Scheduled calls ───
  const dashboardScheduledCalls = useMemo(
    () => buildScheduledCalls(contacts, scopeTasks),
    [contacts, scopeTasks]
  )

  const scheduledByContactId = useMemo(
    () => new Map(dashboardScheduledCalls.map((call) => [call.contact.id, call])),
    [dashboardScheduledCalls]
  )

  const todayKey = localDayDateKey(today)

  // ─── Priority Queue ───
  const queueItems = useMemo<QueueItem[]>(() => {
    const items: QueueItem[] = []
    const seen = new Set<string>()

    for (const call of dashboardScheduledCalls) {
      if (seen.has(call.contact.id)) continue
      const due = new Date(call.due_at)
      const dueKey = dueAtLocalDateKey(call.due_at)

      let priority: QueueItem['priority'] = 'medium'
      let reason = 'followup_due'

      if (dueKey && dueKey < todayKey) {
        priority = 'critical'
        reason = 'overdue'
      } else if ((call.contact.score || 0) >= 70) {
        priority = 'high'
        reason = 'hot_lead'
      } else if (dueKey === todayKey) {
        priority = 'high'
        reason = 'followup_due'
      }

      items.push({
        contact: call.contact,
        due_at: call.due_at,
        task: call.task,
        quote: null,
        reason,
        priority,
        score: call.contact.score || 0,
      })
      seen.add(call.contact.id)
    }

    // Sort: critical first, then high, then medium, then by score desc
    const priorityOrder = { critical: 0, high: 1, medium: 2 }
    return items.sort((a, b) => {
      const pDiff = priorityOrder[a.priority] - priorityOrder[b.priority]
      if (pDiff !== 0) return pDiff
      return b.score - a.score
    })
  }, [dashboardScheduledCalls, todayKey])

  // ─── Da recuperare: contatti aperti senza prossimo passo ───
  const recoveryItems = useMemo<RecoveryItem[]>(() => {
    const queuedContactIds = new Set(dashboardScheduledCalls.map((call) => call.contact.id))
    const items: RecoveryItem[] = []

    for (const contact of contacts) {
      if (isClosedStatus(contact.status)) continue
      if (queuedContactIds.has(contact.id)) continue

      const followupAt = contact.next_followup_at ? new Date(contact.next_followup_at).getTime() : null
      // Parcheggiato consapevolmente (es. Waiting "richiama tra 3 mesi") con data futura: non disturbare.
      if (followupAt && followupAt > now.getTime()) continue

      const lastContact = contact.last_contact_at ? new Date(contact.last_contact_at) : null
      const daysStale = lastContact
        ? Math.floor((now.getTime() - lastContact.getTime()) / DAY_MS)
        : 999

      items.push({
        contact,
        daysStale,
        // Waiting/inattivo con richiamo scaduto: buildScheduledCalls lo salta, quindi riemerge qui.
        reason: followupAt ? 'waiting_due' : 'no_next_step',
      })
    }

    return items.sort((a, b) => {
      if (a.reason !== b.reason) return a.reason === 'waiting_due' ? -1 : 1
      return b.daysStale - a.daysStale
    })
  }, [contacts, dashboardScheduledCalls, now])

  // ─── Risk items ───
  const riskItems = useMemo(() => {
    const items: Array<{
      contact: CRMContact
      reason: string
      severity: 'critical' | 'warning'
      quote: null
      daysStale: number
    }> = []

    for (const contact of contacts) {
      if (isInactiveStatus(contact.status)) continue
      const lastContact = contact.last_contact_at ? new Date(contact.last_contact_at) : new Date(contact.created_at)
      const daysStale = Math.floor((now.getTime() - lastContact.getTime()) / DAY_MS)

      if (daysStale >= 14) {
        items.push({
          contact,
          reason: `Fermo da ${daysStale} giorni`,
          severity: 'critical',
          quote: null,
          daysStale,
        })
      } else if (daysStale >= 7 && (contact.status === 'Quote' || contact.priority >= 3)) {
        items.push({
          contact,
          reason: 'In fase avanzata senza contatto',
          severity: 'warning',
          quote: null,
          daysStale,
        })
      }
    }

    return items.sort((a, b) => b.daysStale - a.daysStale)
  }, [contacts, now])

  // ─── Top leads ───
  const topLeads = useMemo(() => {
    return contacts
      .filter((c) => !isClosedStatus(c.status) && (c.score || 0) > 0)
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, 6)
      .map((c) => ({ contact: c, score: c.score || 0, value: c.value }))
  }, [contacts])

  // ─── Stats ───
  const overdueCount = queueItems.filter((q) => q.priority === 'critical').length
  const todayCount = dashboardScheduledCalls.filter(
    (call) => dueAtLocalDateKey(call.due_at) === todayKey
  ).length
  const hotCount = contacts.filter((c) => (c.score || 0) >= 70 && !isClosedStatus(c.status)).length

  // ─── Day buckets for week grid ───
  const days = useMemo<DayBucket[]>(() => {
    const buckets: DayBucket[] = []
    const pastRangeStart = new Date(today.getTime() - DAYS_BACK * DAY_MS)
    const pastCalls = dashboardScheduledCalls
      .filter((call) => {
        const due = new Date(call.due_at)
        if (Number.isNaN(due.getTime())) return false
        return due >= pastRangeStart && due < today
      })
      .sort((left, right) => new Date(left.due_at).getTime() - new Date(right.due_at).getTime())

    buckets.push({
      key: 'last-7-days',
      date: pastRangeStart,
      offset: -DAYS_BACK,
      label: 'Ultimi 7 giorni',
      dateLabel: `${dayNumber(pastRangeStart)} - ${dayNumber(new Date(today.getTime() - DAY_MS))}`,
      isPastRange: true,
      calls: pastCalls,
    })

    for (let offset = 0; offset < DAYS_AHEAD; offset += 1) {
      const dayStart = new Date(today.getTime() + offset * DAY_MS)
      const bucketKey = localDayDateKey(dayStart)
      buckets.push({
        key: bucketKey,
        date: dayStart,
        offset,
        calls: dashboardScheduledCalls
          .filter((call) => dueAtLocalDateKey(call.due_at) === bucketKey)
          .sort((left, right) => new Date(left.due_at).getTime() - new Date(right.due_at).getTime()),
      })
    }
    return buckets
  }, [dashboardScheduledCalls, today])

  // ─── Handlers ───
  async function handleComplete(taskId: string | null) {
    if (!taskId) return
    try {
      await completeTask(taskId)
    } catch { /* handled by layout */ }
  }

  async function handleReschedule(contactId: string, taskId: string | null, dayOffset: number) {
    const call = scheduledByContactId.get(contactId)
    const originalDue = call ? new Date(call.due_at) : new Date()
    const targetDate = new Date(today.getTime() + dayOffset * DAY_MS)
    targetDate.setHours(originalDue.getHours(), originalDue.getMinutes(), 0, 0)

    if (dayOffset === 0 && targetDate.getTime() <= Date.now()) {
      targetDate.setTime(Date.now() + 15 * 60 * 1000)
      targetDate.setSeconds(0, 0)
    }

    try {
      if (taskId) {
        await updateTask(taskId, { due_date: targetDate.toISOString() })
      } else {
        await updateContact(contactId, { next_followup_at: targetDate.toISOString() })
      }
      showToast(`Spostato a ${dayOffset === 0 ? 'oggi' : `+${dayOffset} giorni`}`)
    } catch (error) {
      showToast(`Errore: ${error instanceof Error ? error.message : 'spostamento'}`)
    }
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

  async function handleRecoverySchedule(contactId: string, followupAt: string) {
    try {
      await updateContact(contactId, { next_followup_at: followupAt })
      showToast(`Richiamo fissato per il ${followupLabel(followupAt)}`)
    } catch (error) {
      showToast(`Errore: ${error instanceof Error ? error.message : 'pianificazione'}`)
    }
  }

  async function handleGenerateDraft(contactId: string) {
    if (generatingDraftId) return
    setGeneratingDraftId(contactId)
    try {
      const result = await apiFetch<{ results: Array<{ error?: string; draft_id?: string }> }>('/api/ai/generate-drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ drafts: [{ contact_id: contactId }] }),
      })
      const first = result.results?.[0]
      if (first?.error) throw new Error(first.error)
      showToast('Bozza email generata ✓')
      refresh()
    } catch (error) {
      showToast(`Errore: ${error instanceof Error ? error.message : 'generazione bozza'}`)
    } finally {
      setGeneratingDraftId(null)
    }
  }

  function openDrawer(contactId: string, anchor?: { x: number; y: number } | null) {
    setDrawerContactId(contactId)
    setDrawerAnchor(anchor || null)
  }

  function closeDrawer() {
    setDrawerContactId(null)
    setDrawerAnchor(null)
  }

  function openDrawerFromMouse(contactId: string, event: MouseEvent<HTMLElement>) {
    openDrawer(contactId, { x: event.clientX, y: event.clientY })
  }

  function openDrawerFromKeyboard(contactId: string, event: KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    openDrawer(contactId, null)
  }

  function handleDragStart(event: DragEvent<HTMLElement>, call: ScheduledCall) {
    const payload: DragPayload = {
      contactId: call.contact.id,
      taskId: call.task?.id || null,
      dueAt: call.due_at,
      contactName: call.contact.name,
    }
    event.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload))
    event.dataTransfer.effectAllowed = 'move'
    setDraggingId(call.contact.id)
  }

  function handleDragEnd() {
    setDraggingId(null)
    setDragOverKey(null)
  }

  function handleDragOver(event: DragEvent<HTMLElement>, key: string) {
    if (!event.dataTransfer.types.includes(DRAG_MIME)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    if (dragOverKey !== key) setDragOverKey(key)
  }

  function handleDragLeave(event: DragEvent<HTMLElement>, key: string) {
    if (dragOverKey === key && !event.currentTarget.contains(event.relatedTarget as Node)) {
      setDragOverKey(null)
    }
  }

  async function handleDrop(event: DragEvent<HTMLElement>, targetDate: Date) {
    event.preventDefault()
    const raw = event.dataTransfer.getData(DRAG_MIME)
    setDragOverKey(null)
    setDraggingId(null)
    if (!raw) return

    let payload: DragPayload
    try {
      payload = JSON.parse(raw) as DragPayload
    } catch {
      return
    }

    const originalDue = new Date(payload.dueAt)
    const newDue = new Date(targetDate)
    newDue.setHours(originalDue.getHours(), originalDue.getMinutes(), 0, 0)

    if (dayKey(originalDue) === dayKey(newDue)) return

    try {
      if (payload.taskId) {
        await updateTask(payload.taskId, { due_date: newDue.toISOString() })
      } else {
        await updateContact(payload.contactId, { next_followup_at: newDue.toISOString() })
      }
      showToast(`${payload.contactName} spostato a ${dayNumber(newDue)}`)
    } catch (error) {
      showToast(`Errore: ${error instanceof Error ? error.message : 'spostamento'}`)
    }
  }

  // ─── Onboarding per workspace vuoto ───
  if (allContacts.length === 0) {
    return (
      <div className="oggi-page oggi-v2">
        <DashboardHero overdueCount={0} todayCount={0} hotCount={0} />
        <section className="oggi-onboarding">
          <div className="oggi-onboarding-icon">👋</div>
          <h2>Benvenuto in Speaqi!</h2>
          <p>
            Inizia caricando i tuoi contatti esistenti o crea il primo contatto manualmente.
            Puoi anche provare il comando vocale per inserire dati senza scrivere.
          </p>
          <div className="oggi-onboarding-actions">
            <Link href="/import" className="btn btn-primary">📥 Importa CSV</Link>
            <Link href="/contacts?new=1" className="btn btn-ghost">➕ Crea contatto</Link>
            <Link href="/voice" className="btn btn-ghost">🎤 Prova nota vocale</Link>
          </div>
        </section>
        <Link href="/voice" className="voice-fab" title="Nota vocale rapida">🎤</Link>
      </div>
    )
  }

  return (
    <div className="oggi-page oggi-v2">
      <DashboardHero
        overdueCount={overdueCount}
        todayCount={todayCount}
        hotCount={hotCount}
      />

      {/* Main 2-column layout */}
      <div className="oggi-main-grid">
        {/* Left: Priority Queue */}
        <div className="oggi-main-left">
          <DashboardPriorityQueue
            items={queueItems}
            onOpenContact={openDrawerFromMouse}
            onComplete={handleComplete}
            onReschedule={handleReschedule}
            onDismiss={handleDismiss}
            onGenerateDraft={handleGenerateDraft}
            generatingDraftId={generatingDraftId}
          />
        </div>

        {/* Right: Risk + Top Leads */}
        <div className="oggi-main-right">
          {isAdmin && teamMembers.length > 0 && (
            <div className="oggi-admin-bar">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setAdminDashboardShowAllContacts((v) => !v)}
                aria-pressed={adminDashboardShowAllContacts}
              >
                {adminDashboardShowAllContacts ? 'Solo i miei' : 'Vedi tutti'}
              </button>
            </div>
          )}
          <DashboardRiskPanel
            riskItems={riskItems}
            topLeads={topLeads}
            onOpenContact={openDrawerFromMouse}
          />
        </div>
      </div>

      {/* ─── DA RECUPERARE ─── */}
      <DashboardRecoveryPanel
        items={recoveryItems}
        onSchedule={handleRecoverySchedule}
        onDismiss={handleDismiss}
        onOpenContact={openDrawerFromMouse}
      />

      {/* ─── EMAIL INBOX ─── */}
      <DashboardEmailInbox showToast={showToast} refresh={refresh} />

      {/* ─── TO-DO LIST ─── */}
      <section className="oggi-todo">
        <div className="oggi-todo-head">
          <h2>📋 Cose da fare oggi</h2>
          <span className="oggi-todo-count">{standaloneTasks.length}</span>
        </div>
        <div className="oggi-todo-body">
          {standaloneTasks.map((t) => (
            <div key={t.id} className="oggi-todo-item">
              <button
                type="button"
                className="oggi-todo-check"
                onClick={async () => {
                  try {
                    await completeStandaloneTask(t.id)
                    showToast('Fatto ✓')
                  } catch (e) {
                    showToast(`Errore: ${e instanceof Error ? e.message : 'completamento'}`)
                  }
                }}
                title="Segna come fatto"
              >
                ○
              </button>
              <span className="oggi-todo-text">{t.title || t.note}</span>
            </div>
          ))}
          <form
            className="oggi-todo-add"
            onSubmit={async (e) => {
              e.preventDefault()
              const text = todoInput.trim()
              if (!text || todoAdding) return
              setTodoAdding(true)
              try {
                await createStandaloneTask({ title: text })
                setTodoInput('')
                showToast('Aggiunto')
              } catch (err) {
                showToast(`Errore: ${err instanceof Error ? err.message : 'aggiunta task'}`)
              } finally {
                setTodoAdding(false)
              }
            }}
          >
            <input
              className="oggi-todo-input"
              type="text"
              value={todoInput}
              onChange={(e) => setTodoInput(e.target.value)}
              placeholder="Scrivi cosa devi fare e premi Invio..."
              disabled={todoAdding}
            />
          </form>
        </div>
      </section>

      {/* Collapsible week grid */}
      <section className="oggi-week">
        <div className="oggi-week-head">
          <h2>Pianificazione 2 settimane</h2>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setWeekExpanded(!weekExpanded)}
          >
            {weekExpanded ? 'Comprimi' : 'Espandi'}
          </button>
          <Link href="/calendario" className="oggi-week-link">Vista calendario →</Link>
        </div>
        {weekExpanded && (
          <div className="oggi-week-grid">
            {days.map((day) => {
              const key = day.key
              const isDropTarget = dragOverKey === key
              return (
                <div
                  key={key}
                  className={`oggi-day-col ${day.offset === 0 ? 'is-today' : ''} ${day.isPastRange ? 'is-past-range' : ''} ${isDropTarget ? 'is-drop-target' : ''}`}
                  onDragOver={day.isPastRange ? undefined : (event) => handleDragOver(event, key)}
                  onDragLeave={day.isPastRange ? undefined : (event) => handleDragLeave(event, key)}
                  onDrop={day.isPastRange ? undefined : (event) => handleDrop(event, day.date)}
                >
                  <div className="oggi-day-head">
                    <span className="oggi-day-label">{day.label || dayLabelShort(day.date, day.offset)}</span>
                    <span className="oggi-day-date">{day.dateLabel || dayNumber(day.date)}</span>
                    {day.calls.length > 0 && <span className="oggi-day-count">{day.calls.length}</span>}
                  </div>
                  <div className="oggi-day-body">
                    {day.calls.length === 0 ? (
                      <div className="oggi-day-empty">{isDropTarget ? '⤵ Rilascia qui' : '—'}</div>
                    ) : (
                      day.calls.map((call) => (
                        <div
                          key={`d-${key}-${call.contact.id}`}
                          className={`oggi-call-card is-${day.offset === 0 ? 'today' : 'upcoming'} ${call.contact.priority >= 3 ? 'is-hot' : ''} ${draggingId === call.contact.id ? 'is-dragging' : ''}`}
                          draggable
                          onDragStart={(event) => handleDragStart(event, call)}
                          onDragEnd={handleDragEnd}
                        >
                          <div className="oggi-call-grip" aria-hidden>⋮⋮</div>
                          <div className="oggi-call-time">
                            {new Date(call.due_at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
                          </div>
                          <button
                            type="button"
                            className="oggi-call-body"
                            onClick={(event) => openDrawerFromMouse(call.contact.id, event)}
                          >
                            <strong className="oggi-call-name">{call.contact.name}</strong>
                            {call.contact.company && <span className="oggi-call-company">{call.contact.company}</span>}
                          </button>
                          {call.task?.id ? (
                            <button
                              type="button"
                              className="oggi-call-done"
                              onClick={(event) => {
                                event.stopPropagation()
                                handleComplete(call.task!.id)
                              }}
                              title="Segna completato"
                            >
                              ✓
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="oggi-call-done"
                              onClick={(event) => openDrawerFromMouse(call.contact.id, event)}
                            >
                              →
                            </button>
                          )}
                          <QuickDismissMenu
                            contactId={call.contact.id}
                            contactName={call.contact.name}
                            onDismiss={handleDismiss}
                          />
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* ─── PARTNER ─── */}
      {partnerContacts.length > 0 && (
        <section className="oggi-partner">
          <div className="oggi-partner-head">
            <h2>🤝 Partner</h2>
            <Link href="/partner" className="oggi-week-link">Vedi tutti ({partnerContacts.length}) →</Link>
          </div>
          <div className="oggi-partner-grid">
            {partnerContacts.slice(0, 6).map((p) => (
              <button
                key={p.id}
                type="button"
                className="oggi-partner-card"
                onClick={(event) => openDrawerFromMouse(p.id, event)}
              >
                <strong>{p.name}</strong>
                {p.company && <span className="oggi-partner-company">{p.company}</span>}
                {p.note && <span className="oggi-partner-note">{p.note.slice(0, 80)}{p.note.length > 80 ? '…' : ''}</span>}
              </button>
            ))}
          </div>
        </section>
      )}

      <ContactDrawer
        contactId={drawerContactId}
        anchorPoint={drawerAnchor}
        onClose={closeDrawer}
        onEdit={(id) => {
          const target = allContacts.find((contact) => contact.id === id) || null
          setEditingContact(target)
          setModalOpen(true)
        }}
      />

      <Link href="/voice" className="voice-fab" title="Nota vocale rapida">
        🎤
      </Link>

      <ContactModal
        open={modalOpen}
        title="Modifica contatto"
        stages={stages}
        teamMembers={teamMembers}
        initialContact={editingContact}
        onClose={() => {
          setModalOpen(false)
          setEditingContact(null)
        }}
        onSave={async (payload: ContactInput) => {
          if (!editingContact) return
          await updateContact(editingContact.id, payload)
          showToast('Contatto aggiornato')
          setDrawerContactId(editingContact.id)
        }}
        onDelete={
          editingContact
            ? async () => {
                await deleteContact(editingContact.id)
                setModalOpen(false)
                closeDrawer()
                showToast('Contatto eliminato')
              }
            : undefined
        }
      />
    </div>
  )
}
