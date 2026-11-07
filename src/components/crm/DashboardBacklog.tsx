'use client'

import { useMemo, useState, type MouseEvent } from 'react'
import { statusLabel } from '@/lib/data'
import type { ScheduledCall } from '@/lib/schedule'

interface Props {
  calls: ScheduledCall[]
  onOpenContact: (contactId: string, event: MouseEvent<HTMLElement>) => void
  /** Sposta il prossimo follow-up di questi contatti: domani (0) o fra N giorni lavorativi in più. */
  onPostpone: (contactIds: string[], extraDays: number) => Promise<void> | void
}

const PAGE = 40

/**
 * Follow-up scaduti di contatti fuori da mappe e turismo. Non spariscono: stanno
 * qui, chiusi, finché non si decide cosa farne.
 */
export function DashboardBacklog({ calls, onOpenContact, onPostpone }: Props) {
  const [open, setOpen] = useState(false)
  const [visible, setVisible] = useState(PAGE)
  const [busy, setBusy] = useState(false)

  const sorted = useMemo(
    () =>
      [...calls].sort(
        (a, b) =>
          (b.contact.priority - a.contact.priority) ||
          ((b.contact.engagement_count || 0) - (a.contact.engagement_count || 0)) ||
          new Date(b.due_at).getTime() - new Date(a.due_at).getTime()
      ),
    [calls]
  )

  if (calls.length === 0) return null

  async function postponeAll(extra: number, label: string) {
    if (!window.confirm(`Spostare tutti i ${calls.length} follow-up arretrati ${label}?`)) return
    setBusy(true)
    try {
      await onPostpone(calls.map((c) => c.contact.id), extra)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="oggi-card oggi-backlog">
      <div className="oggi-card-title">
        <button type="button" className="oggi-week-link" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? '⌃' : '⌄'} 🗂️ Arretrati · altri contatti
        </button>
        <span className="oggi-overdue-count">{calls.length}</span>
      </div>
      <p className="oggi-muted">
        Follow-up scaduti di contatti non legati a mappe o Tourism Intelligence. Non contano nel badge di Oggi.
      </p>
      {open && (
        <>
          <div className="oggi-queue-shifts" style={{ margin: '8px 0', gap: 8, display: 'flex', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => postponeAll(0, 'a domani mattina')}>
              Tutti a domani
            </button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => postponeAll(6, 'di una settimana')}>
              Tutti +1 settimana
            </button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => postponeAll(29, 'di un mese')}>
              Tutti +1 mese
            </button>
          </div>
          <div className="oggi-priority-queue">
            {sorted.slice(0, visible).map((item) => (
              <div key={`b-${item.contact.id}`} className="oggi-queue-row">
                <button type="button" className="oggi-queue-body" onClick={(e) => onOpenContact(item.contact.id, e)}>
                  <div className="oggi-queue-main">
                    <strong className="oggi-queue-name">{item.contact.name}</strong>
                    {item.contact.company && <span className="oggi-queue-company">{item.contact.company}</span>}
                  </div>
                  <div className="oggi-queue-meta">
                    <span className="oggi-queue-reason">
                      ⏰ dal {new Date(item.due_at).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' })}
                    </span>
                    <span className="oggi-queue-status">{statusLabel(item.contact.status)}</span>
                  </div>
                </button>
                <div className="oggi-queue-actions">
                  <button
                    type="button"
                    className="oggi-call-shift"
                    disabled={busy}
                    onClick={() => onPostpone([item.contact.id], 6)}
                    title="Rimanda di una settimana"
                  >
                    +7
                  </button>
                  <button
                    type="button"
                    className="oggi-call-shift"
                    disabled={busy}
                    onClick={() => onPostpone([item.contact.id], 29)}
                    title="Rimanda di un mese"
                  >
                    +30
                  </button>
                </div>
              </div>
            ))}
          </div>
          {sorted.length > visible && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setVisible((v) => v + PAGE)}>
              Mostra altri ({sorted.length - visible})
            </button>
          )}
        </>
      )}
    </section>
  )
}
