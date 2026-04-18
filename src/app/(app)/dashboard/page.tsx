'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { useCRMContext } from '../layout'
import { isClosedStatus, priorityLabel, statusLabel } from '@/lib/data'
import type { ScheduledCall } from '@/lib/schedule'

const DAY_MS = 24 * 60 * 60 * 1000

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

function formatRelativeDay(date: Date) {
  const today = startOfDay(new Date())
  const target = startOfDay(date)
  const diffDays = Math.round((target.getTime() - today.getTime()) / DAY_MS)
  if (diffDays === 0) return 'Oggi'
  if (diffDays === 1) return 'Domani'
  if (diffDays === -1) return 'Ieri'
  if (diffDays > 1 && diffDays < 7) return date.toLocaleDateString('it-IT', { weekday: 'long' })
  return date.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })
}

function greetingForHour(hour: number) {
  if (hour < 6) return 'Buonanotte'
  if (hour < 13) return 'Buongiorno'
  if (hour < 19) return 'Buon pomeriggio'
  return 'Buonasera'
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
  const tomorrow = new Date(today.getTime() + DAY_MS)
  const in3Days = new Date(today.getTime() + 4 * DAY_MS)
  const stagnantCutoff = new Date(today.getTime() - 14 * DAY_MS)

  const overdueCalls = useMemo<ScheduledCall[]>(
    () => scheduledCalls.filter((call) => new Date(call.due_at) < today),
    [scheduledCalls, today]
  )
  const todayCalls = useMemo<ScheduledCall[]>(
    () =>
      scheduledCalls.filter((call) => {
        const due = new Date(call.due_at)
        return due >= today && due < tomorrow
      }),
    [scheduledCalls, today, tomorrow]
  )
  const upcomingCalls = useMemo<ScheduledCall[]>(
    () =>
      scheduledCalls.filter((call) => {
        const due = new Date(call.due_at)
        return due >= tomorrow && due < in3Days
      }),
    [scheduledCalls, tomorrow, in3Days]
  )

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

  async function handleComplete(taskId: string | null) {
    if (!taskId) return
    try {
      await completeTask(taskId)
    } catch {
      // noop — errore mostrato dal layout
    }
  }

  const totalToday = todayCalls.length + overdueCalls.length
  const emptyToday = totalToday === 0

  return (
    <div className="oggi-page">
      <div className="oggi-hero">
        <div>
          <h1>{greeting}.</h1>
          <p className="oggi-date">{dayLabel}</p>
        </div>
        <div className="oggi-hero-actions">
          <Link href="/contacts?new=1" className="btn btn-primary">
            + Nuovo contatto
          </Link>
          <Link href="/import" className="btn btn-ghost">
            📥 Importa CSV
          </Link>
        </div>
      </div>

      {emptyToday ? (
        <div className="oggi-empty">
          <div className="oggi-empty-emoji">☀️</div>
          <h2>Nessun follow-up oggi.</h2>
          <p>Bel lavoro. Usa il tempo libero per caricare nuovi lead o ricontattare chi è fermo.</p>
          <div className="oggi-empty-actions">
            <Link href="/import" className="btn btn-primary">Importa contatti</Link>
            <Link href="/contacts" className="btn btn-ghost">Apri contatti</Link>
          </div>
        </div>
      ) : (
        <section className="oggi-section">
          <div className="oggi-section-head">
            <h2>
              <span className="oggi-flame">🔥</span>
              Da fare oggi
              <span className="oggi-count">{totalToday}</span>
            </h2>
          </div>
          <div className="oggi-list">
            {overdueCalls.slice(0, 8).map((call) => (
              <CallRow key={`o-${call.contact.id}`} call={call} overdue onComplete={handleComplete} />
            ))}
            {todayCalls.slice(0, 10).map((call) => (
              <CallRow key={`t-${call.contact.id}`} call={call} onComplete={handleComplete} />
            ))}
          </div>
        </section>
      )}

      <div className="oggi-grid">
        {latestImport && (
          <section className="oggi-card oggi-card-accent">
            <div className="oggi-card-title">📥 Ultimo import</div>
            <div className="oggi-import-body">
              <div className="oggi-import-meta">
                <strong>{latestImport.listName}</strong>
                <span>{latestImport.total} contatti · {formatRelativeDay(new Date(latestImport.createdAt))}</span>
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
          <div className="oggi-card-title">📅 Prossimi 3 giorni</div>
          {upcomingCalls.length === 0 ? (
            <p className="oggi-muted">Niente di programmato.</p>
          ) : (
            <div className="oggi-list oggi-list-compact">
              {upcomingCalls.slice(0, 6).map((call) => (
                <Link
                  key={call.contact.id}
                  href={`/contacts/${call.contact.id}`}
                  className="oggi-upcoming-row"
                >
                  <span className="oggi-upcoming-day">
                    {formatRelativeDay(new Date(call.due_at))}
                  </span>
                  <span className="oggi-upcoming-name">{call.contact.name}</span>
                  <span className="oggi-upcoming-time">
                    {new Date(call.due_at).toLocaleTimeString('it-IT', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="oggi-card">
          <div className="oggi-card-title">💤 Lead fermi da 2 settimane</div>
          {stagnantContacts.length === 0 ? (
            <p className="oggi-muted">Tutti i lead aperti sono seguiti. 👏</p>
          ) : (
            <div className="oggi-list oggi-list-compact">
              {stagnantContacts.map((contact) => (
                <Link
                  key={contact.id}
                  href={`/contacts/${contact.id}`}
                  className="oggi-stagnant-row"
                >
                  <span className="oggi-stagnant-name">{contact.name}</span>
                  <span className="oggi-stagnant-meta">
                    {statusLabel(contact.status)} · {formatRelativeDay(new Date(contact.last_contact_at || contact.created_at))}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function CallRow({
  call,
  overdue = false,
  onComplete,
}: {
  call: ScheduledCall
  overdue?: boolean
  onComplete: (taskId: string | null) => void
}) {
  const due = new Date(call.due_at)
  const time = due.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })

  return (
    <div className={`oggi-call-row ${overdue ? 'is-overdue' : ''}`}>
      <div className={`oggi-call-dot ${overdue ? 'is-overdue' : ''}`} />
      <Link href={`/contacts/${call.contact.id}`} className="oggi-call-name">
        <strong>{call.contact.name}</strong>
        {call.contact.company && <span className="oggi-call-company">· {call.contact.company}</span>}
      </Link>
      <span className="oggi-call-meta">
        {overdue ? '⏰ scaduto' : time} · {priorityLabel(call.contact.priority)}
      </span>
      {call.task?.id ? (
        <button
          type="button"
          className="btn btn-ghost btn-sm oggi-call-done"
          onClick={() => onComplete(call.task!.id)}
          title="Segna completato"
        >
          ✓ fatto
        </button>
      ) : (
        <Link
          href={`/contacts/${call.contact.id}`}
          className="btn btn-ghost btn-sm oggi-call-done"
        >
          apri →
        </Link>
      )}
    </div>
  )
}
