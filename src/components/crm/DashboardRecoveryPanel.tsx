'use client'

import { useState, type MouseEvent } from 'react'
import { statusLabel } from '@/lib/data'
import type { CRMContact } from '@/types'
import { QuickDismissMenu } from '@/components/crm/QuickDismissMenu'

export interface RecoveryItem {
  contact: CRMContact
  daysStale: number
  reason: 'no_next_step' | 'waiting_due'
}

interface Props {
  items: RecoveryItem[]
  onSchedule: (contactId: string, followupAt: string) => void
  onDismiss: (contactId: string, status: string, nextFollowupAt: string | null) => void
  onOpenContact: (contactId: string, event: MouseEvent<HTMLElement>) => void
}

const COLLAPSED_COUNT = 8

const SCHEDULE_PRESETS: Array<{ label: string; days: number }> = [
  { label: 'Domani', days: 1 },
  { label: '+3g', days: 3 },
  { label: '+1 sett', days: 7 },
  { label: '+1 mese', days: 30 },
]

function followupFromNow(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() + days)
  date.setHours(10, 0, 0, 0)
  return date.toISOString()
}

export function DashboardRecoveryPanel({ items, onSchedule, onDismiss, onOpenContact }: Props) {
  const [expanded, setExpanded] = useState(false)

  if (items.length === 0) return null

  const visibleItems = expanded ? items : items.slice(0, COLLAPSED_COUNT)

  return (
    <section className="oggi-card">
      <div className="oggi-card-title">
        🛟 Da recuperare
        <span className="oggi-overdue-count">{items.length}</span>
      </div>
      <p className="oggi-muted">
        Contatti aperti senza un prossimo passo: dai una data di richiamo o chiudili.
      </p>
      <div className="oggi-priority-queue">
        {visibleItems.map((item) => (
          <div key={`rec-${item.contact.id}`} className="oggi-queue-row">
            <span className="oggi-queue-priority">{item.reason === 'waiting_due' ? '⏰' : '🛟'}</span>
            <button
              type="button"
              className="oggi-queue-body"
              onClick={(event) => onOpenContact(item.contact.id, event)}
            >
              <div className="oggi-queue-main">
                <strong className="oggi-queue-name">{item.contact.name}</strong>
                {item.contact.company && (
                  <span className="oggi-queue-company">{item.contact.company}</span>
                )}
              </div>
              <div className="oggi-queue-meta">
                <span className="oggi-queue-reason">
                  {item.reason === 'waiting_due'
                    ? 'Richiamo scaduto'
                    : item.daysStale >= 999
                      ? 'Mai contattato'
                      : `Fermo da ${item.daysStale} giorni`}
                </span>
                <span className="oggi-queue-status">{statusLabel(item.contact.status)}</span>
              </div>
            </button>
            <div className="oggi-queue-actions">
              <div className="oggi-queue-shifts">
                {SCHEDULE_PRESETS.map((preset) => (
                  <button
                    key={preset.days}
                    type="button"
                    className="oggi-call-shift"
                    onClick={(event) => {
                      event.stopPropagation()
                      onSchedule(item.contact.id, followupFromNow(preset.days))
                    }}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <QuickDismissMenu
                contactId={item.contact.id}
                contactName={item.contact.name}
                onDismiss={onDismiss}
              />
            </div>
          </div>
        ))}
      </div>
      {items.length > COLLAPSED_COUNT && (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? 'Mostra meno' : `Mostra tutti (${items.length})`}
        </button>
      )}
    </section>
  )
}
