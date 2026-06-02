'use client'

import { type MouseEvent } from 'react'
import { formatDateTime, statusLabel } from '@/lib/data'
import type { CRMContact, Quote } from '@/types'

interface RiskItem {
  contact: CRMContact
  reason: string
  severity: 'critical' | 'warning'
  quote?: Quote | null
  daysStale: number
}

interface TopLead {
  contact: CRMContact
  score: number
  value?: number | null
}

interface Props {
  riskItems: RiskItem[]
  topLeads: TopLead[]
  onOpenContact: (contactId: string, event: MouseEvent<HTMLElement>) => void
}

function formatMoney(value?: number | null) {
  if (!value) return null
  return new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(value)
}

export function DashboardRiskPanel({ riskItems, topLeads, onOpenContact }: Props) {
  return (
    <div className="oggi-risk-grid">
      <section className="oggi-card">
        <div className="oggi-card-title">⚠️ Pipeline a rischio</div>
        {riskItems.length === 0 ? (
          <p className="oggi-muted">Nessun alert. Pipeline sana. 👏</p>
        ) : (
          <div className="oggi-risk-list">
            {riskItems.slice(0, 6).map((item) => (
              <button
                key={item.contact.id}
                type="button"
                className={`oggi-risk-row ${item.severity === 'critical' ? 'is-critical' : ''}`}
                onClick={(e) => onOpenContact(item.contact.id, e)}
              >
                <span className="oggi-risk-icon">
                  {item.severity === 'critical' ? '🔴' : '🟡'}
                </span>
                <div className="oggi-risk-info">
                  <strong>{item.contact.name}</strong>
                  <span className="oggi-risk-reason">
                    {item.reason}
                    {item.quote && (
                      <em> — {formatMoney(item.quote.total_amount)}</em>
                    )}
                  </span>
                </div>
                <span className="oggi-risk-days">{item.daysStale}g</span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="oggi-card">
        <div className="oggi-card-title">🔥 Top Lead</div>
        {topLeads.length === 0 ? (
          <p className="oggi-muted">Nessun lead caldo al momento.</p>
        ) : (
          <div className="oggi-top-leads">
            {topLeads.slice(0, 6).map((lead, i) => (
              <button
                key={lead.contact.id}
                type="button"
                className="oggi-lead-row"
                onClick={(e) => onOpenContact(lead.contact.id, e)}
              >
                <span className="oggi-lead-rank">#{i + 1}</span>
                <div className="oggi-lead-info">
                  <strong>{lead.contact.name}</strong>
                  <span>{statusLabel(lead.contact.status)}</span>
                </div>
                <div className="oggi-lead-metrics">
                  <span className="oggi-lead-score" title="Score">
                    {lead.score >= 80 ? '🔥' : lead.score >= 60 ? '⭐' : ''} {lead.score}
                  </span>
                  {lead.value ? (
                    <span className="oggi-lead-value">{formatMoney(lead.value)}</span>
                  ) : null}
                </div>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
