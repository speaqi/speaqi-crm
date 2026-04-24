'use client'

import Link from 'next/link'
import { DragEvent, MouseEvent, KeyboardEvent, useMemo, useState } from 'react'
import { ContactDrawer } from '@/components/crm/ContactDrawer'
import { ContactModal } from '@/components/crm/ContactModal'
import { useCRMContext } from '../layout'
import {
  contactAssigneeIsOtherTeammate,
  isClosedStatus,
  priorityLabel,
  statusLabel,
} from '@/lib/data'
import { buildScheduledCalls, type ScheduledCall } from '@/lib/schedule'
import type { ContactInput, CRMContact } from '@/types'

const DAY_MS = 24 * 60 * 60 * 1000
const DAYS_BACK = 1
/** Offset massimo nel loop (escluso): ieri … oggi … fino a oggi + (DAYS_AHEAD - 1) giorni (~2 settimane). */
const DAYS_AHEAD = 15

function startOfDay(date: Date) {
  const clone = new Date(date)
  clone.setHours(0, 0, 0, 0)
  return clone
}

function formatItalianDate(date: Date) {
  return date.toLocaleDateString('it-IT', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
}

function greetingForHour(hour: number) {
  if (hour < 6) return 'Buonanotte'
  if (hour < 13) return 'Buongiorno'
  if (hour < 19) return 'Buon pomeriggio'
  return 'Buonasera'
}

function dayLabelShort(date: Date, offset: number) {
  if (offset === -1) return 'Ieri'
  if (offset === 0) return 'Oggi'
  if (offset === 1) return 'Domani'
  return date.toLocaleDateString('it-IT', { weekday: 'long' })
}

function dayNumber(date: Date) {
  return date.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })
}

function dayKey(date: Date) {
  return date.toISOString().slice(0, 10)
}

interface LatestImport {
  listName: string
  total: number
  createdAt: string
}

interface DragPayload {
  contactId: string
  taskId: string | null
  dueAt: string
  contactName: string
}

const DRAG_MIME = 'application/x-call'

function isInProgressStatus(status: string) {
  return status.toLowerCase() !== 'new' && !isClosedStatus(status)
}

function isContactedStatus(status: string) {
  const normalized = status.trim().toLowerCase()
  return normalized === 'contacted' || normalized === 'contattato'
}

function followupLabel(value?: string | null) {
  if (!value) return 'Senza data'
  return new Date(value).toLocaleDateString('it-IT', {
    day: '2-digit',
    month: '2-digit',
  })
}

function quickShiftLabel(dayOffset: number) {
  if (dayOffset === 0) return 'Oggi'
  return `+${dayOffset}`
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
    adminDashboardShowAllContacts,
    setAdminDashboardShowAllContacts,
    completeTask,
    updateTask,
    updateContact,
    deleteContact,
    showToast,
  } = useCRMContext()
  const [dragOverKey, setDragOverKey] = useState<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [drawerContactId, setDrawerContactId] = useState<string | null>(null)
  const [drawerAnchor, setDrawerAnchor] = useState<{ x: number; y: number } | null>(null)
  const [editingContact, setEditingContact] = useState<CRMContact | null>(null)
  const [modalOpen, setModalOpen] = useState(false)

  const now = new Date()
  const today = startOfDay(now)
  const stagnantCutoff = new Date(today.getTime() - 14 * DAY_MS)

  const adminScopeName = useMemo(() => {
    const emailLc = (authEmail || '').trim().toLowerCase()
    const fromTeam = teamMembers.find((m) => (m.email || '').trim().toLowerCase() === emailLc)?.name?.trim()
    return (viewerMemberName && viewerMemberName.trim()) || fromTeam || null
  }, [authEmail, teamMembers, viewerMemberName])

  /** Nomi (lower) dei colleghi: email ≠ utente loggato. Esclude dalla dashboard i contatti loro. */
  const otherTeammateNamesNorm = useMemo(() => {
    const emailLc = (authEmail || '').trim().toLowerCase()
    return new Set(
      teamMembers
        .filter((m) => (m.email || '').trim().toLowerCase() !== emailLc)
        .map((m) => (m.name || '').trim().toLowerCase())
        .filter(Boolean)
    )
  }, [teamMembers, authEmail])

  const scopeContacts = useMemo(() => {
    if (!isAdmin || adminDashboardShowAllContacts) return contacts
    if (otherTeammateNamesNorm.size === 0) return contacts
    return contacts.filter((c) => !contactAssigneeIsOtherTeammate(c, otherTeammateNamesNorm))
  }, [adminDashboardShowAllContacts, contacts, isAdmin, otherTeammateNamesNorm])

  const scopeContactIds = useMemo(() => new Set(scopeContacts.map((c) => c.id)), [scopeContacts])

  const scopeTasks = useMemo(() => {
    if (!isAdmin || adminDashboardShowAllContacts) return crmTasks
    return crmTasks.filter((t) => scopeContactIds.has(t.contact_id))
  }, [adminDashboardShowAllContacts, crmTasks, isAdmin, scopeContactIds])

  const dashboardScheduledCalls = useMemo(
    () => buildScheduledCalls(scopeContacts, scopeTasks),
    [scopeContacts, scopeTasks]
  )

  const days = useMemo(() => {
    const buckets: Array<{ date: Date; calls: ScheduledCall[]; offset: number }> = []
    for (let offset = -DAYS_BACK; offset < DAYS_AHEAD; offset += 1) {
      const dayStart = new Date(today.getTime() + offset * DAY_MS)
      const dayEnd = new Date(dayStart.getTime() + DAY_MS)
      buckets.push({
        date: dayStart,
        offset,
        calls: dashboardScheduledCalls
          .filter((call) => {
            const due = new Date(call.due_at)
            return due >= dayStart && due < dayEnd
          })
          .sort((left, right) => new Date(left.due_at).getTime() - new Date(right.due_at).getTime()),
      })
    }
    return buckets
  }, [dashboardScheduledCalls, today])

  const stagnantContacts = useMemo(
    () =>
      scopeContacts
        .filter((contact) => !isClosedStatus(contact.status))
        .filter((contact) => !contact.next_followup_at)
        .filter((contact) => {
          const reference = contact.last_contact_at || contact.created_at
          return reference && new Date(reference) < stagnantCutoff
        })
        .slice(0, 6),
    [scopeContacts, stagnantCutoff]
  )

  const latestImport = useMemo<LatestImport | null>(() => {
    const byList = new Map<string, { count: number; latest: string }>()
    for (const contact of scopeContacts) {
      const listName = contact.list_name?.trim()
      if (!listName) continue
      const existing = byList.get(listName) || { count: 0, latest: contact.created_at }
      existing.count += 1
      if (contact.created_at > existing.latest) existing.latest = contact.created_at
      byList.set(listName, existing)
    }
    let best: LatestImport | null = null
    for (const [listName, data] of byList.entries()) {
      if (!best || data.latest > best.createdAt) {
        best = { listName, total: data.count, createdAt: data.latest }
      }
    }
    if (!best) return null
    const age = now.getTime() - new Date(best.createdAt).getTime()
    return age < 30 * DAY_MS ? best : null
  }, [scopeContacts, now])

  const hour = now.getHours()
  const greeting = greetingForHour(hour)
  const dayLabel = formatItalianDate(now)

  const stageOrderMap = useMemo(() => {
    const map = new Map<string, number>()
    stages.forEach((stage, index) => {
      map.set(stage.name, Number.isFinite(stage.order) ? Number(stage.order) : index)
    })
    return map
  }, [stages])

  const contactedOrder = useMemo(() => {
    const contactedStage = stages.find((stage) => stage.system_key === 'contacted' || isContactedStatus(stage.name))
    if (contactedStage && Number.isFinite(contactedStage.order)) return Number(contactedStage.order)
    return stageOrderMap.get('Contacted') ?? stageOrderMap.get('contattato') ?? 1
  }, [stages, stageOrderMap])

  const statusAboveContacted = useMemo(() => {
    const allowed = new Set<string>()
    for (const [status, order] of stageOrderMap.entries()) {
      if (order > contactedOrder) {
        allowed.add(status)
      }
    }
    return allowed
  }, [contactedOrder, stageOrderMap])

  const scheduledByContactId = useMemo(
    () => new Map(dashboardScheduledCalls.map((call) => [call.contact.id, call])),
    [dashboardScheduledCalls]
  )

  const overdueCalls = useMemo<ScheduledCall[]>(
    () =>
      dashboardScheduledCalls.filter((call) => {
        if (new Date(call.due_at) >= today) return false
        return statusAboveContacted.has(call.contact.status)
      }),
    [dashboardScheduledCalls, statusAboveContacted, today]
  )

  const totalUpcoming = days.reduce((sum, day) => sum + day.calls.length, 0) + overdueCalls.length

  const topPipelineContacts = useMemo(() => {
    return scopeContacts
      .filter((contact) => isInProgressStatus(contact.status))
      .sort((left, right) => {
        const rightPriority = Number(right.priority || 0)
        const leftPriority = Number(left.priority || 0)
        if (rightPriority !== leftPriority) return rightPriority - leftPriority

        const rightStage = stageOrderMap.get(right.status) ?? 0
        const leftStage = stageOrderMap.get(left.status) ?? 0
        if (rightStage !== leftStage) return rightStage - leftStage

        const leftDue = new Date(
          scheduledByContactId.get(left.id)?.due_at || left.next_followup_at || '2999-12-31'
        ).getTime()
        const rightDue = new Date(
          scheduledByContactId.get(right.id)?.due_at || right.next_followup_at || '2999-12-31'
        ).getTime()
        if (leftDue !== rightDue) return leftDue - rightDue

        return left.name.localeCompare(right.name)
      })
      .slice(0, 8)
  }, [scopeContacts, scheduledByContactId, stageOrderMap])

  async function handleComplete(taskId: string | null) {
    if (!taskId) return
    try {
      await completeTask(taskId)
    } catch {
      // handled by layout
    }
  }

  async function handleQuickSchedule(call: ScheduledCall, dayOffset: number) {
    const originalDue = new Date(call.due_at)
    const targetDate = new Date(today.getTime() + dayOffset * DAY_MS)
    targetDate.setHours(originalDue.getHours(), originalDue.getMinutes(), 0, 0)

    if (dayOffset === 0 && targetDate.getTime() <= Date.now()) {
      targetDate.setTime(Date.now() + 15 * 60 * 1000)
      targetDate.setSeconds(0, 0)
    }

    try {
      if (call.task?.id) {
        await updateTask(call.task.id, { due_date: targetDate.toISOString() })
      } else {
        await updateContact(call.contact.id, { next_followup_at: targetDate.toISOString() })
      }
      showToast(`${call.contact.name} spostato a ${quickShiftLabel(dayOffset)}`)
    } catch (error) {
      showToast(`Errore: ${error instanceof Error ? error.message : 'spostamento rapido'}`)
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

  return (
    <div className="oggi-page oggi-v2">
      <header className="oggi-hero">
        <div>
          <h1>{greeting}.</h1>
          <p className="oggi-date">{dayLabel}</p>
        </div>
        <div className="oggi-hero-stats">
          <div className="oggi-stat">
            <strong>{overdueCalls.length}</strong>
            <span>scaduti</span>
          </div>
          <div className="oggi-stat">
            <strong>{days[0]?.calls.length || 0}</strong>
            <span>oggi</span>
          </div>
          <div className="oggi-stat">
            <strong>{totalUpcoming}</strong>
            <span>prossimi ~2 sett.</span>
          </div>
        </div>
        <div className="oggi-hero-actions">
          {isAdmin && teamMembers.length > 0 && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setAdminDashboardShowAllContacts((v) => !v)}
              aria-pressed={adminDashboardShowAllContacts}
              title={
                adminDashboardShowAllContacts
                  ? 'Torna alla vista solo miei / non assegnati agli altri nel team'
                  : 'Mostra tutti i contatti del workspace (anche assegnati ai colleghi)'
              }
            >
              {adminDashboardShowAllContacts
                ? adminScopeName
                  ? `Solo ${adminScopeName}`
                  : 'Solo i miei'
                : 'Vedi tutti'}
            </button>
          )}
          <Link href="/contacts?new=1" className="btn btn-primary">
            + Nuovo contatto
          </Link>
          <Link href="/import" className="btn btn-ghost">
            📥 Importa CSV
          </Link>
        </div>
      </header>

      <div className={`oggi-focus-grid ${overdueCalls.length === 0 ? 'is-single' : ''}`}>
        {overdueCalls.length > 0 && (
          <section
            className={`oggi-overdue ${dragOverKey === 'overdue' ? 'is-drop-target' : ''}`}
            onDragOver={(event) => handleDragOver(event, 'overdue')}
            onDragLeave={(event) => handleDragLeave(event, 'overdue')}
            onDrop={(event) => handleDrop(event, today)}
          >
            <div className="oggi-overdue-head">
              <span className="oggi-overdue-icon">⏰</span>
              <h2>Scaduti da recuperare</h2>
              <span className="oggi-overdue-count">{overdueCalls.length}</span>
            </div>
            <div className="oggi-overdue-list">
              {overdueCalls.slice(0, 6).map((call) => (
                <CallCard
                  key={`ovd-${call.contact.id}`}
                  call={call}
                  variant="overdue"
                  dragging={draggingId === call.contact.id}
                  onComplete={handleComplete}
                  onQuickMove={handleQuickSchedule}
                  onOpenContact={openDrawerFromMouse}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                />
              ))}
              {overdueCalls.length > 6 && (
                <Link href="/kanban?view=list" className="oggi-overdue-more">
                  +{overdueCalls.length - 6} altri →
                </Link>
              )}
            </div>
          </section>
        )}

        <section className="oggi-card oggi-top-pipeline-card">
          <div className="oggi-card-title">🔥 Top pipeline in corso</div>
          {topPipelineContacts.length === 0 ? (
            <p className="oggi-muted">Nessun contatto in corso da evidenziare.</p>
          ) : (
            <div className="oggi-pipeline-list">
              {topPipelineContacts.map((contact) => {
                const call = scheduledByContactId.get(contact.id) || null
                return (
                <button
                  type="button"
                  key={contact.id}
                  className="oggi-pipeline-row"
                  onClick={(event) => openDrawerFromMouse(contact.id, event)}
                  onKeyDown={(event) => openDrawerFromKeyboard(contact.id, event)}
                >
                  <span className="oggi-pipeline-main">
                    <strong>{contact.name}</strong>
                    <span>{statusLabel(contact.status)}</span>
                  </span>
                  <span className="oggi-pipeline-meta">
                    {contact.priority > 0 && <em>{priorityLabel(contact.priority)}</em>}
                    <span>{followupLabel(call?.due_at || contact.next_followup_at)}</span>
                  </span>
                </button>
              )
            })}
          </div>
          )}
        </section>
      </div>

      <section className="oggi-week">
        <div className="oggi-week-head">
          <h2>Ieri + circa 2 settimane</h2>
          <span className="oggi-week-hint">Trascina un contatto per spostarlo di giorno</span>
          <Link href="/calendario" className="oggi-week-link">Vista calendario →</Link>
        </div>
        <div className="oggi-week-grid">
          {days.map((day) => {
            const key = dayKey(day.date)
            const isDropTarget = dragOverKey === key
            return (
              <div
                key={key}
                className={`oggi-day-col ${day.offset === 0 ? 'is-today' : ''} ${isDropTarget ? 'is-drop-target' : ''}`}
                onDragOver={(event) => handleDragOver(event, key)}
                onDragLeave={(event) => handleDragLeave(event, key)}
                onDrop={(event) => handleDrop(event, day.date)}
              >
                <div className="oggi-day-head">
                  <span className="oggi-day-label">{dayLabelShort(day.date, day.offset)}</span>
                  <span className="oggi-day-date">{dayNumber(day.date)}</span>
                  {day.calls.length > 0 && <span className="oggi-day-count">{day.calls.length}</span>}
                </div>
                <div className="oggi-day-body">
                  {day.calls.length === 0 ? (
                    <div className="oggi-day-empty">{isDropTarget ? '⤵ Rilascia qui' : '—'}</div>
                  ) : (
                    day.calls.map((call) => (
                      <CallCard
                        key={`d-${key}-${call.contact.id}`}
                        call={call}
                        variant={day.offset === 0 ? 'today' : 'upcoming'}
                        dragging={draggingId === call.contact.id}
                        onComplete={handleComplete}
                        onOpenContact={openDrawerFromMouse}
                        onDragStart={handleDragStart}
                        onDragEnd={handleDragEnd}
                      />
                    ))
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <div className="oggi-bottom-grid">
        {latestImport && (
          <section className="oggi-card oggi-card-accent">
            <div className="oggi-card-title">📥 Ultimo import</div>
            <div className="oggi-import-body">
              <div className="oggi-import-meta">
                <strong>{latestImport.listName}</strong>
                <span>{latestImport.total} contatti</span>
              </div>
              <Link
                href={`/contacts?list=${encodeURIComponent(latestImport.listName)}`}
                className="btn btn-primary btn-sm"
              >
                Apri lista →
              </Link>
            </div>
          </section>
        )}

        <section className="oggi-card">
          <div className="oggi-card-title">💤 Fermi da 2 settimane</div>
          {stagnantContacts.length === 0 ? (
            <p className="oggi-muted">Tutti i contatti sono seguiti. 👏</p>
          ) : (
            <div className="oggi-stagnant-list">
              {stagnantContacts.map((contact) => (
                <button
                  type="button"
                  key={contact.id}
                  className="oggi-stagnant-row"
                  onClick={(event) => openDrawerFromMouse(contact.id, event)}
                  onKeyDown={(event) => openDrawerFromKeyboard(contact.id, event)}
                >
                  <span className="oggi-stagnant-name">{contact.name}</span>
                  <span className="oggi-stagnant-meta">{statusLabel(contact.status)}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>

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

function CallCard({
  call,
  variant,
  dragging,
  onComplete,
  onQuickMove,
  onOpenContact,
  onDragStart,
  onDragEnd,
}: {
  call: ScheduledCall
  variant: 'overdue' | 'today' | 'upcoming'
  dragging: boolean
  onComplete: (taskId: string | null) => void
  onQuickMove?: (call: ScheduledCall, dayOffset: number) => void
  onOpenContact: (contactId: string, event: MouseEvent<HTMLElement>) => void
  onDragStart: (event: DragEvent<HTMLElement>, call: ScheduledCall) => void
  onDragEnd: () => void
}) {
  const due = new Date(call.due_at)
  const time = due.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
  const priority = call.contact.priority

  return (
    <div
      className={`oggi-call-card is-${variant} ${priority >= 3 ? 'is-hot' : ''} ${dragging ? 'is-dragging' : ''}`}
      draggable
      onDragStart={(event) => onDragStart(event, call)}
      onDragEnd={onDragEnd}
    >
      <div className="oggi-call-grip" aria-hidden>⋮⋮</div>
      <div className="oggi-call-time">
        {variant === 'overdue' ? '⏰' : time}
      </div>
      <button
        type="button"
        className="oggi-call-body"
        onClick={(event) => onOpenContact(call.contact.id, event)}
      >
        <strong className="oggi-call-name">{call.contact.name}</strong>
        {call.contact.company && <span className="oggi-call-company">{call.contact.company}</span>}
        {priority > 0 && <span className={`oggi-call-pri pri-${priority}`}>{priorityLabel(priority)}</span>}
      </button>
      {variant === 'overdue' ? (
        <div className="oggi-call-actions">
          {[0, 1, 3, 7].map((dayOffset) => (
            <button
              key={dayOffset}
              type="button"
              className="oggi-call-shift"
              onClick={() => onQuickMove?.(call, dayOffset)}
              onMouseDown={(event) => event.stopPropagation()}
              title={`Sposta a ${quickShiftLabel(dayOffset)}`}
            >
              {quickShiftLabel(dayOffset)}
            </button>
          ))}
        </div>
      ) : call.task?.id ? (
        <button
          type="button"
          className="oggi-call-done"
          onClick={(event) => {
            event.stopPropagation()
            onComplete(call.task!.id)
          }}
          title="Segna completato"
          aria-label="Segna completato"
        >
          ✓
        </button>
      ) : (
        <button
          type="button"
          className="oggi-call-done"
          onClick={(event) => onOpenContact(call.contact.id, event)}
          aria-label="Apri"
        >
          →
        </button>
      )}
    </div>
  )
}
