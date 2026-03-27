'use client'

import { useEffect, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import {
  EMPTY_CONTACT_INPUT,
  PRIORITY_OPTIONS,
  SOURCE_OPTIONS,
  fromDatetimeLocalValue,
  isClosedStatus,
  sourceLabel,
  statusLabel,
  toDatetimeLocalValue,
} from '@/lib/data'
import type { CRMContact, ContactInput, PipelineStage } from '@/types'

interface ContactModalProps {
  open: boolean
  title: string
  stages: PipelineStage[]
  initialContact?: CRMContact | null
  defaultSource?: string
  onClose: () => void
  onSave: (payload: ContactInput) => Promise<void> | void
  onDelete?: () => Promise<void> | void
}

function buildInitialState(contact?: CRMContact | null, defaultSource?: string): ContactInput {
  if (!contact) {
    return {
      ...EMPTY_CONTACT_INPUT,
      source: defaultSource || EMPTY_CONTACT_INPUT.source,
    }
  }

  return {
    name: contact.name,
    email: contact.email || '',
    phone: contact.phone || '',
    status: contact.status,
    source: contact.source || defaultSource || 'manual',
    priority: contact.priority || 0,
    responsible: contact.responsible || '',
    value: contact.value ?? null,
    note: contact.note || '',
    next_followup_at: toDatetimeLocalValue(contact.next_followup_at),
  }
}

export function ContactModal({
  open,
  title,
  stages,
  initialContact,
  defaultSource,
  onClose,
  onSave,
  onDelete,
}: ContactModalProps) {
  const [form, setForm] = useState<ContactInput>(buildInitialState(initialContact, defaultSource))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setForm(buildInitialState(initialContact, defaultSource))
    }
  }, [defaultSource, initialContact, open])

  async function handleSave() {
    if (!form.name.trim()) {
      window.alert('Inserisci almeno il nome del contatto')
      return
    }

    if (!isClosedStatus(form.status) && !form.next_followup_at) {
      window.alert('Ogni contatto aperto deve avere un prossimo follow-up')
      return
    }

    setSaving(true)
    try {
      await onSave({
        ...form,
        name: form.name.trim(),
        email: form.email?.trim(),
        phone: form.phone?.trim(),
        source: form.source?.trim(),
        responsible: form.responsible?.trim(),
        note: form.note?.trim(),
        next_followup_at: fromDatetimeLocalValue(form.next_followup_at),
      })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!onDelete || !window.confirm('Eliminare questo contatto?')) return
    setSaving(true)
    try {
      await onDelete()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          {onDelete && (
            <button className="btn btn-del" onClick={handleDelete} disabled={saving}>
              🗑 Elimina
            </button>
          )}
          <button className="btn btn-ghost" onClick={onClose} disabled={saving}>
            Annulla
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Salvataggio...' : 'Salva'}
          </button>
        </>
      }
    >
      <div className="fg">
        <label className="fl">Nome / Organizzazione *</label>
        <input
          className="fi"
          value={form.name}
          onChange={(event) => setForm((previous) => ({ ...previous, name: event.target.value }))}
          placeholder="Es. Comune di Roma"
        />
      </div>

      <div className="frow">
        <div className="fg">
          <label className="fl">Email</label>
          <input
            className="fi"
            type="email"
            value={form.email || ''}
            onChange={(event) => setForm((previous) => ({ ...previous, email: event.target.value }))}
            placeholder="email@azienda.it"
          />
        </div>
        <div className="fg">
          <label className="fl">Telefono</label>
          <input
            className="fi"
            value={form.phone || ''}
            onChange={(event) => setForm((previous) => ({ ...previous, phone: event.target.value }))}
            placeholder="+39 ..."
          />
        </div>
      </div>

      <div className="frow">
        <div className="fg">
          <label className="fl">Stadio pipeline</label>
          <select
            className="fi"
            value={form.status}
            onChange={(event) => setForm((previous) => ({ ...previous, status: event.target.value }))}
          >
            {stages.map((stage) => (
              <option key={stage.id} value={stage.name}>
                {statusLabel(stage.name)}
              </option>
            ))}
          </select>
        </div>
        <div className="fg">
          <label className="fl">Origine</label>
          <select
            className="fi"
            value={form.source || 'manual'}
            onChange={(event) => setForm((previous) => ({ ...previous, source: event.target.value }))}
          >
            {SOURCE_OPTIONS.map((source) => (
              <option key={source} value={source}>
                {sourceLabel(source)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="frow">
        <div className="fg">
          <label className="fl">Priorità</label>
          <select
            className="fi"
            value={String(form.priority)}
            onChange={(event) =>
              setForm((previous) => ({ ...previous, priority: Number(event.target.value) }))
            }
          >
            {PRIORITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="fg">
          <label className="fl">Responsabile</label>
          <input
            className="fi"
            value={form.responsible || ''}
            onChange={(event) => setForm((previous) => ({ ...previous, responsible: event.target.value }))}
            placeholder="Chi gestisce il lead"
          />
        </div>
      </div>

      <div className="frow">
        <div className="fg">
          <label className="fl">Valore stimato (€)</label>
          <input
            className="fi"
            type="number"
            value={form.value ?? ''}
            onChange={(event) =>
              setForm((previous) => ({
                ...previous,
                value: event.target.value ? Number(event.target.value) : null,
              }))
            }
            placeholder="5000"
          />
        </div>
        <div className="fg">
          <label className="fl">Prossimo follow-up {isClosedStatus(form.status) ? '(opzionale)' : '*'}</label>
          <input
            className="fi"
            type="datetime-local"
            value={form.next_followup_at || ''}
            onChange={(event) =>
              setForm((previous) => ({ ...previous, next_followup_at: event.target.value }))
            }
          />
        </div>
      </div>

      <div className="fg">
        <label className="fl">Note</label>
        <textarea
          className="fi"
          rows={4}
          value={form.note || ''}
          onChange={(event) => setForm((previous) => ({ ...previous, note: event.target.value }))}
          style={{ resize: 'vertical' }}
          placeholder="Contesto commerciale, dettagli, decision maker..."
        />
      </div>
    </Modal>
  )
}
