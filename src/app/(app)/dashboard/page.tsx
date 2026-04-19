'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { useCRMContext } from '../layout'
import { isClosedStatus, priorityLabel, statusLabel } from '@/lib/data'
import type { ScheduledCall } from '@/lib/schedule'

const DAY_MS = 24 * 60 * 60 * 1000
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

function dayLabelShort(date: Date, index: number) {
  if (index === 0) return 'Oggi'
  if (index === 1) return 'Domani'
  return date.toLocaleDateString('it-IT', { weekday: 'long' })
}

function dayNumber(date: Date) {
  return date.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })
}

interface LatestImport {
  listName: string
  total: number
  createdAt: string
}

export default function OggiPage() {
  const { contacts, allContacts, scheduledCalls, completeTask } = useCRMContext()

  const now = new Date()
  const today = startOfDay(now)
  const stagnantCutoff = new Date(today.getTime() - 14 * DAY_MS)

  const overdueCalls = useMemo<ScheduledCall[]>(
    () => scheduledCalls.filter((call) => new Date(call.due_at) < today),
    [scheduledCalls, today]
  )

  const days = useMemo(() => {
    const buckets: Array<{ date: Date; calls: ScheduledCall[] }> = []
    for (let index = 0; index < DAYS_AHEAD; index += 1) {
      const dayStart = new Date(today.getTime() + index * DAY_MS)
      const dayEnd = new Date(dayStart.getTime() + DAY_MS)
      buckets.push({
        date: dayStart,
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
      // error surfaced by layout
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
        <section className="oggi-overdue">
          <div className="oggi-overdue-head">
            <span className="oggi-overdue-icon">⏰</span>
            <h2>Scaduti da recuperare</h2>
            <span className="oggi-overdue-count">{overdueCalls.length}</span>
          </div>
          <div className="oggi-overdue-list">
            {overdueCalls.slice(0, 6).map((call) => (
              <CallCard key={`ovd-${call.contact.id}`} call={call} variant="overdue" onComplete={handleComplete} />
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
          <h2>Prossimi 5 giorni</h2>
          <Link href="/calendario" className="oggi-week-link">Vista calendario →</Link>
        </div>
        <div className="oggi-week-grid">
          {days.map((day, index) => (
            <div key={day.date.toISOString()} className={`oggi-day-col ${index === 0 ? 'is-today' : ''}`}>
              <div className="oggi-day-head">
                <span className="oggi-day-label">{dayLabelShort(day.date, index)}</span>
                <span className="oggi-day-date">{dayNumber(day.date)}</span>
                {day.calls.length > 0 && <span className="oggi-day-count">{day.calls.length}</span>}
              </div>
              <div className="oggi-day-body">
                {day.calls.length === 0 ? (
                  <div className="oggi-day-empty">—</div>
                ) : (
                  day.calls.map((call) => (
                    <CallCard
                      key={`d-${day.date.toISOString()}-${call.contact.id}`}
                      call={call}
                      variant={index === 0 ? 'today' : 'upcoming'}
                      onComplete={handleComplete}
                    />
                  ))
                )}
              </div>
            </div>
          ))}
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
  onComplete,
}: {
  call: ScheduledCall
  variant: 'overdue' | 'today' | 'upcoming'
  onComplete: (taskId: string | null) => void
}) {
  const due = new Date(call.due_at)
  const time = due.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
  const priority = call.contact.priority

  return (
    <div className={`oggi-call-card is-${variant} ${priority >= 3 ? 'is-hot' : ''}`}>
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
