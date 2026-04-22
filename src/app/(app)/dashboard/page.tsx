'use client'

import Link from 'next/link'
import { DragEvent, useMemo, useState } from 'react'
import { useCRMContext } from '../layout'
import { isClosedStatus, priorityLabel, statusLabel } from '@/lib/data'
import type { ScheduledCall } from '@/lib/schedule'

const DAY_MS = 24 * 60 * 60 * 1000
const DAYS_BACK = 1
const DAYS_AHEAD = 5

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

export default function OggiPage() {
  const {
    contacts,
    allContacts,
    scheduledCalls,
    completeTask,
    updateTask,
    updateContact,
    showToast,
  } = useCRMContext()
  const [dragOverKey, setDragOverKey] = useState<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)

  const now = new Date()
  const today = startOfDay(now)
  const stagnantCutoff = new Date(today.getTime() - 14 * DAY_MS)

  const overdueCalls = useMemo<ScheduledCall[]>(
    () => scheduledCalls.filter((call) => new Date(call.due_at) < today),
    [scheduledCalls, today]
  )

  const days = useMemo(() => {
    const buckets: Array<{ date: Date; calls: ScheduledCall[]; offset: number }> = []
    for (let offset = -DAYS_BACK; offset < DAYS_AHEAD; offset += 1) {
      const dayStart = new Date(today.getTime() + offset * DAY_MS)
      const dayEnd = new Date(dayStart.getTime() + DAY_MS)
      buckets.push({
        date: dayStart,
        offset,
        calls: scheduledCalls
          .filter((call) => {
            const due = new Date(call.due_at)
            return due >= dayStart && due < dayEnd
          })
          .sort((left, right) => new Date(left.due_at).getTime() - new Date(right.due_at).getTime()),
      })
    }
    return buckets
  }, [scheduledCalls, today])

  const stagnantContacts = useMemo(
    () =>
      contacts
        .filter((contact) => !isClosedStatus(contact.status))
        .filter((contact) => !contact.next_followup_at)
        .filter((contact) => {
          const reference = contact.last_contact_at || contact.created_at
          return reference && new Date(reference) < stagnantCutoff
        })
        .slice(0, 6),
    [contacts, stagnantCutoff]
  )

  const latestImport = useMemo<LatestImport | null>(() => {
    const byList = new Map<string, { count: number; latest: string }>()
    for (const contact of allContacts) {
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
  }, [allContacts, now])

  const hour = now.getHours()
  const greeting = greetingForHour(hour)
  const dayLabel = formatItalianDate(now)
  const totalUpcoming = days.reduce((sum, day) => sum + day.calls.length, 0) + overdueCalls.length

  async function handleComplete(taskId: string | null) {
    if (!taskId) return
    try {
      await completeTask(taskId)
    } catch {
      // handled by layout
    }
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
            <span>prossimi 5gg</span>
          </div>
        </div>
        <div className="oggi-hero-actions">
          <Link href="/contacts?new=1" className="btn btn-primary">
            + Nuovo contatto
          </Link>
          <Link href="/import" className="btn btn-ghost">
            📥 Importa CSV
          </Link>
        </div>
      </header>

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

      <section className="oggi-week">
        <div className="oggi-week-head">
          <h2>Ieri + prossimi 5 giorni</h2>
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
                <Link
                  key={contact.id}
                  href={`/contacts?id=${contact.id}`}
                  className="oggi-stagnant-row"
                >
                  <span className="oggi-stagnant-name">{contact.name}</span>
                  <span className="oggi-stagnant-meta">{statusLabel(contact.status)}</span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function CallCard({
  call,
  variant,
  dragging,
  onComplete,
  onDragStart,
  onDragEnd,
}: {
  call: ScheduledCall
  variant: 'overdue' | 'today' | 'upcoming'
  dragging: boolean
  onComplete: (taskId: string | null) => void
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
      <Link href={`/contacts?id=${call.contact.id}`} className="oggi-call-body">
        <strong className="oggi-call-name">{call.contact.name}</strong>
        {call.contact.company && <span className="oggi-call-company">{call.contact.company}</span>}
        {priority > 0 && <span className={`oggi-call-pri pri-${priority}`}>{priorityLabel(priority)}</span>}
      </Link>
      {call.task?.id ? (
        <button
          type="button"
          className="oggi-call-done"
          onClick={() => onComplete(call.task!.id)}
          title="Segna completato"
          aria-label="Segna completato"
        >
          ✓
        </button>
      ) : (
        <Link
          href={`/contacts?id=${call.contact.id}`}
          className="oggi-call-done"
          aria-label="Apri"
        >
          →
        </Link>
      )}
    </div>
  )
}
