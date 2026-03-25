'use client'

import { useMemo } from 'react'
import { formatDateTime, isOverdue } from '@/lib/data'
import { useCRMContext } from '../layout'

function groupByDate(tasks: ReturnType<typeof useCRMContext>['tasks']) {
  return tasks.reduce<Record<string, typeof tasks>>((groups, task) => {
    const key = task.due_date ? new Date(task.due_date).toISOString().slice(0, 10) : 'Senza data'
    if (!groups[key]) groups[key] = []
    groups[key].push(task)
    return groups
  }, {})
}

export default function CalendarioPage() {
  const { tasks, completeTask, showToast } = useCRMContext()

  const groupedTasks = useMemo(() => groupByDate(tasks), [tasks])
  const orderedDates = Object.keys(groupedTasks).sort()

  return (
    <div className="dash-content">
      <div className="dash-card">
        <div className="dash-card-title">Calendario follow-up</div>
        <div className="calendar-groups">
          {orderedDates.length === 0 ? (
            <p style={{ color: 'var(--text3)' }}>Nessun follow-up pianificato.</p>
          ) : (
            orderedDates.map((dateKey) => (
              <div key={dateKey} className="calendar-group">
                <div className="section-header">
                  {dateKey === 'Senza data' ? dateKey : new Date(`${dateKey}T09:00:00`).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })}
                </div>
                <div className="task-list">
                  {groupedTasks[dateKey].map((task) => (
                    <div key={task.id} className={`task-card ${task.due_date && isOverdue(task.due_date) ? 'overdue' : ''}`}>
                      <div>
                        <strong>{task.contact?.name || 'Contatto'}</strong>
                        <div className="task-date">{task.type} · {formatDateTime(task.due_date)}</div>
                        <div className="task-note">{task.note || 'Nessuna nota'}</div>
                      </div>
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={async () => {
                          await completeTask(task.id)
                          showToast('Task completato')
                        }}
                      >
                        Completa
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
