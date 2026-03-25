'use client'

import { useState } from 'react'
import { useCRMContext } from '../layout'

function dateKey(d: Date) { return d.toISOString().split('T')[0] }
function addDays(d: Date, n: number) { const r = new Date(d); r.setDate(r.getDate() + n); return r }
function fmtDay(d: Date) { return d.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' }) }

export default function CalendarioPage() {
  const { cards, callDone, callScheduled, toggleCallDone, scheduleCall, scheduleAll, showToast } = useCRMContext()
  const [search, setSearch] = useState('')
  const [calFilter, setCalFilter] = useState<'all' | 'today' | 'alta' | 'nosched'>('all')
  const [weekOffset, setWeekOffset] = useState(0)

  const today = new Date(); today.setHours(0, 0, 0, 0)
  const todayStr = dateKey(today)

  const callCards = cards.filter(c => c.s === 'Da Richiamare' || c.s === 'Da fare')

  let todayCalls = callCards.filter(c => callScheduled[c._u!] === todayStr)
  callCards.forEach(c => {
    if (c.d === todayStr && !callScheduled[c._u!] && !todayCalls.find(x => x._u === c._u)) {
      todayCalls.push(c)
    }
  })

  const doneToday = todayCalls.filter(c => callDone[c._u! + '_' + todayStr]).length

  // Week grid
  const mon = new Date(today)
  mon.setDate(today.getDate() - today.getDay() + 1 + weekOffset * 7)
  const days = Array.from({ length: 7 }, (_, i) => addDays(mon, i))
  const daysIt = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom']

  // Queue
  const queue = callCards.filter(c => !callScheduled[c._u!])
  const queueSorted = [...queue].sort((a, b) => {
    const po: Record<string, number> = { Alta: 0, Media: 1, '': 2, Bassa: 3 }
    return (po[a.p || ''] ?? 2) - (po[b.p || ''] ?? 2)
  })
  const filteredQueue = search
    ? queueSorted.filter(c => c.n.toLowerCase().includes(search.toLowerCase()))
    : queueSorted

  function handleScheduleToday(uid: string) {
    scheduleCall(uid, todayStr)
    showToast('Chiamata aggiunta per oggi!')
  }

  function handleScheduleAll() {
    const count = scheduleAll()
    if (count === 0) {
      showToast('Tutte le chiamate sono già pianificate!')
    } else {
      showToast(`✅ ${count} chiamate pianificate automaticamente!`)
    }
  }

  function handleSelectDay(dk: string) {
    const unscheduled = callCards.filter(c => !callScheduled[c._u!])
    if (!unscheduled.length) { showToast('Tutte le chiamate sono già pianificate!'); return }
    const next = unscheduled[0]
    const dateFormatted = dk.split('-').reverse().join('/')
    if (confirm(`Pianificare "${next.n}" per ${dateFormatted}?`)) {
      scheduleCall(next._u!, dk)
      showToast('Chiamata pianificata!')
    }
  }

  const todayDateLabel = today.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <>
      <div className="toolbar">
        <div className="search">
          <span style={{ color: 'var(--text3)' }}>🔍</span>
          <input
            type="text"
            placeholder="Cerca chiamata da pianificare…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        {(['all', 'today', 'alta', 'nosched'] as const).map(f => (
          <div
            key={f}
            className={`filter-chip ${calFilter === f ? 'active' : ''}`}
            onClick={() => setCalFilter(f)}
          >
            {f === 'all' ? 'Tutte' : f === 'today' ? '⚡ Oggi' : f === 'alta' ? '🔴 Alta' : '📋 Non pianificate'}
          </div>
        ))}
        <button className="btn btn-primary btn-sm" style={{ marginLeft: 'auto' }} onClick={handleScheduleAll}>
          📅 Auto-Pianifica
        </button>
      </div>

      <div className="cal-content">
        <div className="cal-top">
          {/* TODAY panel */}
          <div className="cal-today">
            <div className="cal-today-header">
              <div className="cal-today-title">📞 Da Chiamare Oggi</div>
              <div className="cal-today-date">{todayDateLabel}</div>
            </div>
            {todayCalls.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text3)' }}>
                <div style={{ fontSize: 24, marginBottom: 8 }}>📭</div>
                <div style={{ fontSize: 13 }}>
                  Nessuna chiamata pianificata per oggi.<br />
                  Usa &quot;Auto-Pianifica&quot; o pianifica dalle card in coda.
                </div>
              </div>
            ) : (
              todayCalls.map(c => {
                const dk = c._u! + '_' + todayStr
                const isDone = !!callDone[dk]
                const priClass = c.p === 'Alta' ? 'tag-alta' : c.p === 'Media' ? 'tag-media' : 'tag-bassa'
                return (
                  <div
                    key={c._u}
                    className={`call-item ${isDone ? 'done' : ''}`}
                    onClick={() => toggleCallDone(c._u!, todayStr)}
                  >
                    <div className={`call-cb ${isDone ? 'checked' : ''}`}>{isDone ? '✓' : ''}</div>
                    <div className="call-info">
                      <div className="call-name">{c.n}</div>
                      <div className="call-sub">
                        {c.r ? `👤 ${c.r}` : ''} {c.note ? `· ${c.note.substring(0, 30)}` : ''}
                      </div>
                    </div>
                    {c.p && (
                      <span className={`tag ${priClass}`} style={{ fontSize: 10 }}>{c.p}</span>
                    )}
                  </div>
                )
              })
            )}
            {todayCalls.length > 0 && (
              <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text2)' }}>
                Completati: {doneToday}/{todayCalls.length}
              </div>
            )}
          </div>

          {/* WEEK calendar */}
          <div className="week-cal">
            <div className="week-header">
              <div className="week-title">{fmtDay(days[0])} – {fmtDay(days[6])}</div>
              <div className="week-nav">
                <button className="week-nav-btn" onClick={() => setWeekOffset(w => w - 1)}>‹</button>
                <button className="week-nav-btn" onClick={() => setWeekOffset(0)} title="Oggi">·</button>
                <button className="week-nav-btn" onClick={() => setWeekOffset(w => w + 1)}>›</button>
              </div>
            </div>
            <div className="week-grid">
              {days.map((day, i) => {
                const dk = dateKey(day)
                const isToday = dk === dateKey(new Date())
                const scheduled = callCards.filter(c => callScheduled[c._u!] === dk)
                return (
                  <div key={i} className="day-col">
                    <div className="day-header">{daysIt[i]}</div>
                    <div
                      className={`day-num ${isToday ? 'today' : ''}`}
                      onClick={() => handleSelectDay(dk)}
                    >
                      {day.getDate()}
                    </div>
                    <div className="day-events">
                      {scheduled.map(c => {
                        const isDone = !!callDone[c._u! + '_' + dk]
                        const cls = isDone ? 'done' : c.p === 'Alta' ? 'alta' : c.p === 'Media' ? 'media' : 'normal'
                        return (
                          <div key={c._u} className={`day-event ${cls}`} title={c.n}>
                            {c.n.substring(0, 14)}
                          </div>
                        )
                      })}
                      {scheduled.length < 3 && (
                        <div
                          className="day-event"
                          style={{ background: 'none', color: 'var(--text3)', border: '1px dashed var(--border)', cursor: 'pointer' }}
                          onClick={() => handleSelectDay(dk)}
                        >
                          ＋ aggiungi
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* QUEUE */}
        <div className="cal-queue">
          <div className="cal-queue-header">
            <div className="dash-card-title">📋 Coda Da Richiamare — non ancora pianificati</div>
            <div style={{ fontSize: 12, color: 'var(--text2)' }}>{filteredQueue.length} da pianificare</div>
          </div>
          <div className="queue-grid">
            {filteredQueue.length === 0 ? (
              <p style={{ color: 'var(--text3)', fontSize: 13, padding: 12 }}>
                Ottimo! Tutte le chiamate sono pianificate 🎉
              </p>
            ) : (
              filteredQueue.map(c => (
                <div key={c._u} className="queue-card" title="Clicca per pianificare oggi">
                  <div style={{ fontSize: 18 }}>
                    {c.p === 'Alta' ? '🔴' : c.p === 'Media' ? '🟡' : c.p === 'Bassa' ? '🔵' : '⚪'}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="qc-name">{c.n}</div>
                    <div className="qc-resp">{c.r || 'Nessun responsabile'}</div>
                  </div>
                  <button
                    className="call-schedule-btn"
                    onClick={e => { e.stopPropagation(); handleScheduleToday(c._u!) }}
                  >
                    📅 Oggi
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </>
  )
}
