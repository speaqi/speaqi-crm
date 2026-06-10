'use client'

import { type MouseEvent, type DragEvent } from 'react'
import { priorityLabel, statusLabel } from '@/lib/data'
import type { ScheduledCall } from '@/lib/schedule'
import type { CRMContact, Quote, Task } from '@/types'
import { QuickDismissMenu } from '@/components/crm/QuickDismissMenu'

export interface QueueItem {
  contact: CRMContact
  due_at: string
  task: Task | null
  quote: Quote | null
  reason: string
  priority: 'critical' | 'high' | 'medium'
  score: number
}

interface Props {
  items: QueueItem[]
  onOpenContact: (contactId: string, event: MouseEvent<HTMLElement>) => void
  onComplete: (taskId: string | null) => void
  onReschedule: (contactId: string, taskId: string | null, days: number) => void
  onDismiss: (contactId: string, status: string, nextFollowupAt: string | null) => void
  onGenerateDraft?: (contactId: string) => void
  generatingDraftId?: string | null
}

const REASON_ICONS: Record<string, string> = {
  overdue: '⏰',
  quote_expired: '💶',
  quote_due: '💶',
  demo_viewed: '🎬',
  hot_lead: '🔥',
  followup_due: '📞',
  no_contact: '🆕',
  stale: '💤',
}

function scoreBadge(score: number) {
  if (score >= 80) return '🔥'
  if (score >= 60) return '⭐'
  if (score >= 40) return '👍'
  return ''
}

export function DashboardPriorityQueue({ items, onOpenContact, onComplete, onReschedule, onDismiss, onGenerateDraft, generatingDraftId }: Props) {
  if (items.length === 0) {
    return (
      <section className="oggi-card">
        <div className="oggi-card-title">📋 Da fare oggi</div>
        <p className="oggi-muted">Nessuna azione in scadenza. 👏</p>
      </section>
    )
  }

  return (
    <section className="oggi-card">
      <div className="oggi-card-title">
        📋 Da fare oggi
        <span className="oggi-overdue-count">{items.length}</span>
      </div>
      <div className="oggi-priority-queue">
        {items.slice(0, 15).map((item, i) => {
          const isCritical = item.priority === 'critical'
          const isHigh = item.priority === 'high'
          const due = item.due_at ? new Date(item.due_at) : null
          const time = due
            ? due.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
            : ''
          const scoreIcon = scoreBadge(item.score)
          const reasonIcon = REASON_ICONS[item.reason] || '📌'

          return (
            <div
              key={`q-${item.contact.id}-${i}`}
              className={`oggi-queue-row ${isCritical ? 'is-critical' : ''} ${isHigh ? 'is-high' : ''}`}
            >
              <span className="oggi-queue-priority">
                {isCritical ? '🔴' : isHigh ? '🟠' : '🔵'}
              </span>
              <button
                type="button"
                className="oggi-queue-body"
                onClick={(e) => onOpenContact(item.contact.id, e)}
              >
                <div className="oggi-queue-main">
                  <strong className="oggi-queue-name">{item.contact.name}</strong>
                  {item.contact.company && (
                    <span className="oggi-queue-company">{item.contact.company}</span>
                  )}
                </div>
                <div className="oggi-queue-meta">
                  <span className="oggi-queue-reason">
                    {reasonIcon} {item.reason}
                  </span>
                  {item.score > 0 && (
                    <span className="oggi-queue-score" title={`Score: ${item.score}`}>
                      {scoreIcon} {item.score}
                    </span>
                  )}
                  <span className="oggi-queue-status">
                    {statusLabel(item.contact.status)}
                  </span>
                </div>
              </button>
              <div className="oggi-queue-actions">
                {due && (
                  <span className="oggi-queue-time">{time}</span>
                )}
                <div className="oggi-queue-shifts">
                  {[0, 1, 3].map((days) => (
                    <button
                      key={days}
                      type="button"
                      className="oggi-call-shift"
                      onClick={(e) => {
                        e.stopPropagation()
                        onReschedule(item.contact.id, item.task?.id || null, days)
                      }}
                    >
                      {days === 0 ? 'Oggi' : `+${days}`}
                    </button>
                  ))}
                </div>
                {item.task?.id ? (
                  <button
                    type="button"
                    className="oggi-call-done"
                    onClick={(e) => {
                      e.stopPropagation()
                      onComplete(item.task!.id)
                    }}
                    title="Completato"
                  >
                    ✓
                  </button>
                ) : (
                  <button
                    type="button"
                    className="oggi-call-done"
                    onClick={(e) => onOpenContact(item.contact.id, e)}
                    title="Apri"
                  >
                    →
                  </button>
                )}
                {item.contact.email && onGenerateDraft && (
                  <button
                    type="button"
                    className="oggi-call-done"
                    disabled={generatingDraftId === item.contact.id}
                    onClick={(e) => {
                      e.stopPropagation()
                      onGenerateDraft(item.contact.id)
                    }}
                    title={generatingDraftId === item.contact.id ? 'Generazione...' : 'Genera bozza email'}
                    style={{ background: generatingDraftId === item.contact.id ? 'var(--accent)' : 'var(--surface)', color: generatingDraftId === item.contact.id ? '#fff' : 'var(--accent)' }}
                  >
                    {generatingDraftId === item.contact.id ? '⏳' : '✉️'}
                  </button>
                )}
                <QuickDismissMenu
                  contactId={item.contact.id}
                  contactName={item.contact.name}
                  onDismiss={onDismiss}
                />
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
