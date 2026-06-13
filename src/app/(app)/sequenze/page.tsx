'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import { apiFetch } from '@/lib/api'
import type {
  FollowupSequence,
  SequenceStepAction,
  SequenceStepInput,
} from '@/types'
import { useCRMContext } from '../layout'

const ACTION_OPTIONS: Array<{ value: SequenceStepAction; label: string; icon: string }> = [
  { value: 'send_email', label: 'Email', icon: '✉️' },
  { value: 'call', label: 'Chiamata', icon: '📞' },
  { value: 'whatsapp', label: 'WhatsApp', icon: '💬' },
  { value: 'wait', label: 'Attesa', icon: '⏳' },
]

const PRIORITY_OPTIONS = [
  { value: 'high', label: 'Alta' },
  { value: 'medium', label: 'Media' },
  { value: 'low', label: 'Bassa' },
] as const

function actionMeta(action: SequenceStepAction) {
  return ACTION_OPTIONS.find((option) => option.value === action) || ACTION_OPTIONS[3]
}

function dayFromHours(hours: number) {
  return Math.round((Number(hours) || 0) / 24)
}

function hoursFromDay(day: number) {
  return Math.max(0, Math.round(Number(day) || 0)) * 24
}

type DraftStep = SequenceStepInput & { day: number }

function emptyDraftSteps(): DraftStep[] {
  return [
    { action: 'send_email', offset_hours: 0, day: 0, title: 'Email di apertura', priority: 'high' },
    { action: 'call', offset_hours: 72, day: 3, title: 'Chiamata di follow-up', priority: 'high' },
    { action: 'send_email', offset_hours: 168, day: 7, title: 'Email di valore', priority: 'medium' },
    { action: 'whatsapp', offset_hours: 336, day: 14, title: 'WhatsApp di chiusura', priority: 'medium' },
  ]
}

export default function SequenzePage() {
  const { contacts, showToast } = useCRMContext()
  const [sequences, setSequences] = useState<FollowupSequence[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [showForm, setShowForm] = useState(false)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [triggerEvent, setTriggerEvent] = useState<'manual' | 'email_sent'>('manual')
  const [stopOnReply, setStopOnReply] = useState(true)
  const [steps, setSteps] = useState<DraftStep[]>(emptyDraftSteps())

  const [enrollFor, setEnrollFor] = useState<string | null>(null)
  const [enrollContactId, setEnrollContactId] = useState('')

  const sortedContacts = useMemo(
    () => [...contacts].sort((a, b) => (a.name || '').localeCompare(b.name || '')),
    [contacts]
  )

  async function load() {
    setLoading(true)
    try {
      const data = await apiFetch<{ sequences: FollowupSequence[] }>('/api/sequences')
      setSequences(data.sequences || [])
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Errore nel caricamento delle sequenze')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function resetForm() {
    setName('')
    setDescription('')
    setTriggerEvent('manual')
    setStopOnReply(true)
    setSteps(emptyDraftSteps())
    setShowForm(false)
  }

  function updateStep(index: number, patch: Partial<DraftStep>) {
    setSteps((current) => current.map((step, i) => (i === index ? { ...step, ...patch } : step)))
  }

  function addStep() {
    const last = steps[steps.length - 1]
    const nextDay = last ? last.day + 3 : 0
    setSteps((current) => [
      ...current,
      { action: 'send_email', offset_hours: hoursFromDay(nextDay), day: nextDay, title: '', priority: 'medium' },
    ])
  }

  function removeStep(index: number) {
    setSteps((current) => current.filter((_, i) => i !== index))
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) {
      showToast('Dai un nome alla sequenza')
      return
    }
    if (!steps.length) {
      showToast('Aggiungi almeno uno step')
      return
    }
    setBusy(true)
    try {
      await apiFetch('/api/sequences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          trigger_event: triggerEvent,
          stop_on_reply: stopOnReply,
          steps: steps.map((step) => ({
            action: step.action,
            offset_hours: hoursFromDay(step.day),
            title: step.title?.trim() || null,
            priority: step.priority,
          })),
        }),
      })
      showToast('Sequenza creata')
      resetForm()
      load()
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Impossibile creare la sequenza')
    } finally {
      setBusy(false)
    }
  }

  async function seedDefault() {
    setBusy(true)
    try {
      await apiFetch('/api/sequences/seed-defaults', { method: 'POST' })
      showToast('Sequenza predefinita pronta')
      load()
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Errore')
    } finally {
      setBusy(false)
    }
  }

  async function toggleStatus(sequence: FollowupSequence) {
    const nextStatus = sequence.status === 'active' ? 'paused' : 'active'
    try {
      await apiFetch(`/api/sequences/${sequence.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      })
      showToast(nextStatus === 'active' ? 'Sequenza attivata' : 'Sequenza in pausa')
      load()
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Errore')
    }
  }

  async function archive(sequence: FollowupSequence) {
    if (!confirm(`Archiviare la sequenza «${sequence.name}»? Le iscrizioni attive restano nello storico.`)) return
    try {
      await apiFetch(`/api/sequences/${sequence.id}`, { method: 'DELETE' })
      showToast('Sequenza archiviata')
      load()
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Errore')
    }
  }

  async function enroll(sequenceId: string) {
    if (!enrollContactId) {
      showToast('Scegli un contatto')
      return
    }
    setBusy(true)
    try {
      await apiFetch('/api/sequences/enroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sequence_id: sequenceId, contact_id: enrollContactId }),
      })
      showToast('Contatto iscritto alla cadenza')
      setEnrollFor(null)
      setEnrollContactId('')
      load()
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Impossibile iscrivere il contatto')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0 }}>Cadenze di follow-up</h1>
          <p className="card-desc" style={{ margin: '4px 0 0' }}>
            Sequenze multi-step (email, chiamata, WhatsApp) che riprendono i lead nel tempo e si fermano da sole
            appena il contatto risponde o viene chiuso. Niente più lead persi dopo il primo contatto.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {!sequences.length && (
            <button className="btn" onClick={seedDefault} disabled={busy}>
              Crea cadenza predefinita
            </button>
          )}
          <button className="btn btn-primary" onClick={() => setShowForm((value) => !value)}>
            {showForm ? 'Chiudi' : 'Nuova sequenza'}
          </button>
        </div>
      </div>

      {showForm && (
        <form className="card" onSubmit={handleCreate} style={{ marginBottom: 20, display: 'grid', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={{ display: 'grid', gap: 4 }}>
              <span>Nome</span>
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Es. Cadenza standard 14 giorni" />
            </label>
            <label style={{ display: 'grid', gap: 4 }}>
              <span>Avvio automatico</span>
              <select value={triggerEvent} onChange={(event) => setTriggerEvent(event.target.value as 'manual' | 'email_sent')}>
                <option value="manual">Manuale (iscrivi tu i contatti)</option>
                <option value="email_sent">Quando invii la prima email</option>
              </select>
            </label>
          </div>
          <label style={{ display: 'grid', gap: 4 }}>
            <span>Descrizione</span>
            <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="A cosa serve questa cadenza" />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={stopOnReply} onChange={(event) => setStopOnReply(event.target.checked)} />
            <span>Ferma la cadenza appena il lead risponde</span>
          </label>

          <div style={{ display: 'grid', gap: 8 }}>
            <strong>Step</strong>
            {steps.map((step, index) => (
              <div key={index} style={{ display: 'grid', gridTemplateColumns: '120px 90px 1fr 110px 36px', gap: 8, alignItems: 'center' }}>
                <select value={step.action} onChange={(event) => updateStep(index, { action: event.target.value as SequenceStepAction })}>
                  {ACTION_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.icon} {option.label}
                    </option>
                  ))}
                </select>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontSize: 12, color: '#6b7280' }}>g.</span>
                  <input
                    type="number"
                    min={0}
                    value={step.day}
                    onChange={(event) => updateStep(index, { day: Math.max(0, Number(event.target.value)) })}
                    style={{ width: '100%' }}
                  />
                </label>
                <input
                  value={step.title || ''}
                  onChange={(event) => updateStep(index, { title: event.target.value })}
                  placeholder="Titolo / nota dello step"
                />
                <select value={step.priority} onChange={(event) => updateStep(index, { priority: event.target.value as DraftStep['priority'] })}>
                  {PRIORITY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <button type="button" className="btn btn-del btn-sm" onClick={() => removeStep(index)} aria-label="Rimuovi step">
                  ✕
                </button>
              </div>
            ))}
            <button type="button" className="btn btn-ghost btn-sm" onClick={addStep} style={{ justifySelf: 'start' }}>
              + Aggiungi step
            </button>
            <p className="card-desc" style={{ margin: 0 }}>
              «g.» = giorni dall&apos;iscrizione. Lo step «Attesa» non crea un task, serve solo come pausa.
            </p>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" type="submit" disabled={busy}>
              Salva sequenza
            </button>
            <button className="btn btn-ghost" type="button" onClick={resetForm}>
              Annulla
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <p>Caricamento…</p>
      ) : !sequences.length ? (
        <div className="card">
          <p style={{ margin: 0 }}>
            Nessuna cadenza ancora. Crea quella predefinita (email giorno 0 → chiamata giorno 3 → email giorno 7 →
            WhatsApp giorno 14) oppure costruiscine una su misura.
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          {sequences.map((sequence) => (
            <div key={sequence.id} className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <strong style={{ fontSize: 16 }}>{sequence.name}</strong>
                    <span className="badge" style={{ background: sequence.status === 'active' ? '#10b981' : '#9ca3af' }}>
                      {sequence.status === 'active' ? 'Attiva' : 'In pausa'}
                    </span>
                    {sequence.trigger_event === 'email_sent' && (
                      <span className="badge" style={{ background: '#4f6ef7' }}>Auto su email</span>
                    )}
                  </div>
                  {sequence.description && <p className="card-desc" style={{ margin: '4px 0 0' }}>{sequence.description}</p>}
                  <p className="card-desc" style={{ margin: '4px 0 0' }}>
                    {sequence.active_enrollments || 0} contatti attivi · {sequence.stop_on_reply ? 'si ferma alla risposta' : 'prosegue sempre'}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <button className="btn btn-sm" onClick={() => setEnrollFor(enrollFor === sequence.id ? null : sequence.id)}>
                    Iscrivi contatto
                  </button>
                  <button className="btn btn-sm btn-ghost" onClick={() => toggleStatus(sequence)}>
                    {sequence.status === 'active' ? 'Metti in pausa' : 'Attiva'}
                  </button>
                  <button className="btn btn-sm btn-del" onClick={() => archive(sequence)}>
                    Archivia
                  </button>
                </div>
              </div>

              {enrollFor === sequence.id && (
                <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
                  <select
                    value={enrollContactId}
                    onChange={(event) => setEnrollContactId(event.target.value)}
                    style={{ flex: 1, maxWidth: 360 }}
                  >
                    <option value="">Scegli un contatto…</option>
                    {sortedContacts.map((contact) => (
                      <option key={contact.id} value={contact.id}>
                        {contact.name}
                        {contact.company ? ` · ${contact.company}` : ''}
                      </option>
                    ))}
                  </select>
                  <button className="btn btn-primary btn-sm" onClick={() => enroll(sequence.id)} disabled={busy}>
                    Iscrivi
                  </button>
                </div>
              )}

              <ol style={{ display: 'grid', gap: 6, margin: '14px 0 0', padding: 0, listStyle: 'none' }}>
                {sequence.steps.map((step) => {
                  const meta = actionMeta(step.action)
                  return (
                    <li
                      key={step.id || step.step_index}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14 }}
                    >
                      <span style={{ width: 70, color: '#6b7280' }}>Giorno {dayFromHours(step.offset_hours)}</span>
                      <span>{meta.icon}</span>
                      <span style={{ fontWeight: 500 }}>{meta.label}</span>
                      <span style={{ color: '#374151' }}>{step.title || ''}</span>
                    </li>
                  )
                })}
              </ol>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
