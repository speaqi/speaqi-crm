'use client'

import { useEffect, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import {
  TASK_TYPES,
  fromDatetimeLocalValue,
  isCallableDate,
  isClosedStatus,
  nextCallableDateTime,
  statusLabel,
  toDatetimeLocalValue,
} from '@/lib/data'
import type { CRMContact, PipelineStage, TaskWithContact } from '@/types'

type CallOutcomeModalProps = {
  open: boolean
  contact: CRMContact | null
  task?: Pick<TaskWithContact, 'id' | 'type'> | null
  stages: PipelineStage[]
  onClose: () => void
  onSave: (payload: {
    status: string
    content: string
    next_followup_at: string | null
    task_type: string
  }) => Promise<void> | void
}

function buildInitialState(contact: CRMContact | null) {
  return {
    status: contact?.status || 'Contacted',
    content: '',
    taskType: 'follow-up',
    nextFollowupAt: toDatetimeLocalValue(nextCallableDateTime(contact?.next_followup_at).toISOString()),
  }
}

export function CallOutcomeModal({
  open,
  contact,
  task,
  stages,
  onClose,
  onSave,
}: CallOutcomeModalProps) {
  const [status, setStatus] = useState('Contacted')
  const [content, setContent] = useState('')
  const [taskType, setTaskType] = useState('follow-up')
  const [nextFollowupAt, setNextFollowupAt] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return

    const initial = buildInitialState(contact)
    setStatus(initial.status)
    setContent(
      contact?.phone
        ? `Chiamata effettuata con ${contact.name}.`
        : `Aggiornamento chiamata per ${contact?.name || 'contatto'}.`
    )
    setTaskType(initial.taskType)
    setNextFollowupAt(initial.nextFollowupAt)
  }, [contact, open, task])

  const followupRequired = !isClosedStatus(status)
  const nextFollowupIso = fromDatetimeLocalValue(nextFollowupAt)

  async function handleSave() {
    if (!contact) return

    const summary = content.trim()
    if (!summary) {
      window.alert('Inserisci l’esito della chiamata')
      return
    }

    if (followupRequired && !nextFollowupIso) {
      window.alert('Per un contatto aperto devi pianificare il prossimo follow-up')
      return
    }

    if (nextFollowupIso && !isCallableDate(nextFollowupIso)) {
      window.alert('Il follow-up deve avere una data valida')
      return
    }

    setSaving(true)
    try {
      await onSave({
        status,
        content: summary,
        next_followup_at: followupRequired ? nextFollowupIso : null,
        task_type: taskType,
      })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={task ? `Esito chiamata: ${contact?.name || 'contatto'}` : 'Esito chiamata'}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose} disabled={saving}>
            Annulla
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Salvataggio...' : 'Salva esito'}
          </button>
        </>
      }
    >
      <div className="fg">
        <label className="fl">Esito / stato dopo la chiamata</label>
        <select className="fi" value={status} onChange={(event) => setStatus(event.target.value)}>
          {stages.map((stage) => (
            <option key={stage.id} value={stage.name}>
              {statusLabel(stage.name)}
            </option>
          ))}
        </select>
      </div>

      <div className="fg">
        <label className="fl">Esito sintetico</label>
        <textarea
          className="fi"
          rows={4}
          value={content}
          onChange={(event) => setContent(event.target.value)}
          style={{ resize: 'vertical' }}
          placeholder="Riassumi cosa e successo, chi hai sentito e cosa avete concordato"
        />
      </div>

      <div className="frow">
        <div className="fg">
          <label className="fl">Tipo prossimo task</label>
          <select
            className="fi"
            value={taskType}
            onChange={(event) => setTaskType(event.target.value)}
            disabled={!followupRequired}
          >
            {TASK_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </div>
        <div className="fg">
          <label className="fl">Prossimo follow-up {followupRequired ? '*' : '(non richiesto)'}</label>
          <input
            className="fi"
            type="datetime-local"
            value={nextFollowupAt}
            onChange={(event) => setNextFollowupAt(event.target.value)}
            disabled={!followupRequired}
          />
        </div>
      </div>

        <div className="modal-helper">
        {followupRequired
          ? 'Per contatti aperti il follow-up e obbligatorio. Puoi pianificarlo anche sabato e domenica.'
          : 'Se chiudi il contatto, il follow-up non viene richiesto.'}
      </div>
    </Modal>
  )
}
