'use client'

import { useCRMContext } from '../layout'
import { COLS } from '@/lib/data'

export default function DashboardPage() {
  const { cards, contacts, speaqi } = useCRMContext()

  const total = cards.length
  const alta = cards.filter(c => c.p === 'Alta').length
  const done = cards.filter(c => c.s === 'Completato').length
  const val = cards.filter(c => c.$).reduce((s, c) => s + Number(c.$), 0)
  const daContattare = speaqi.filter(x => x.st === 'da-contattare').length

  const kpis = [
    { icon: '🗂', val: total, label: 'Card Totali', color: '#4f6ef7' },
    { icon: '🔴', val: alta, label: 'Alta Priorità', color: '#ef4444' },
    { icon: '✅', val: done, label: 'Completati', color: '#10b981' },
    { icon: '💰', val: '€' + val.toLocaleString('it'), label: 'Valore Totale', color: '#f59e0b' },
    { icon: '👥', val: contacts.length + speaqi.length, label: 'Contatti Totali', color: '#7c3aed' },
    { icon: '⚡', val: daContattare, label: 'Da Contattare', color: '#059669' },
  ]

  const colCounts = COLS.map(col => ({
    ...col,
    count: cards.filter(c => c.s === col.id).length,
  }))
  const maxCount = Math.max(...colCounts.map(c => c.count), 1)

  const hot = cards.filter(c => c.p === 'Alta' && c.s === 'Da Richiamare').slice(0, 10)
  const hotColor = COLS.find(c => c.id === 'Da Richiamare')?.color || '#f59e0b'

  return (
    <div className="dash-content">
      <div className="kpi-grid">
        {kpis.map((kpi, i) => (
          <div key={i} className="kpi" style={{ borderLeftColor: kpi.color }}>
            <div className="kpi-icon">{kpi.icon}</div>
            <div className="kpi-val" style={{ color: kpi.color }}>{kpi.val}</div>
            <div className="kpi-label">{kpi.label}</div>
          </div>
        ))}
      </div>

      <div className="dash-grid">
        <div className="dash-card">
          <div className="dash-card-title">📊 Distribuzione Stato</div>
          <div className="prog-list">
            {colCounts.map(col => (
              <div key={col.id} className="prog-row">
                <span className="prog-label">{col.e} {col.label}</span>
                <div className="prog-bar">
                  <div
                    className="prog-fill"
                    style={{ width: `${Math.round(col.count / maxCount * 100)}%`, background: col.color }}
                  />
                </div>
                <span className="prog-num">{col.count}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="dash-card">
          <div className="dash-card-title">🔥 Alta Priorità — Da Richiamare</div>
          <div className="activity-list">
            {hot.length > 0 ? hot.map((c, i) => (
              <div key={i} className="activity-item">
                <div className="activity-dot" style={{ background: hotColor }} />
                <span className="activity-name">{c.n}</span>
                <span className="activity-stato">{c.r || '—'}</span>
              </div>
            )) : (
              <p style={{ color: 'var(--text3)', fontSize: 13 }}>Nessun elemento alta priorità.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
