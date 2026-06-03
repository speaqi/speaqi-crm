'use client'

import { useEffect, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import {
  EMPTY_CONTACT_INPUT,
  LEAD_CATEGORY_SUGGESTIONS,
  PRIORITY_OPTIONS,
  SOURCE_OPTIONS,
  fromDatetimeLocalValue,
  isClosedStatus,
  sourceLabel,
  statusLabel,
  toDatetimeLocalValue,
} from '@/lib/data'
import type { CRMContact, ContactInput, PipelineStage, TeamMember } from '@/types'

interface ContactModalProps {
  open: boolean
  title: string
  stages: PipelineStage[]
  initialContact?: CRMContact | null
  defaultSource?: string
  teamMembers?: TeamMember[]
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
    category: contact.category || '',
    company: contact.company || '',
    billing_tax_id: contact.billing_tax_id || '',
    billing_pec: contact.billing_pec || '',
    billing_sdi: contact.billing_sdi || '',
    billing_address: contact.billing_address || '',
    billing_zip: contact.billing_zip || '',
    billing_city: contact.billing_city || '',
    event_tag: contact.event_tag || '',
    list_name: contact.list_name || '',
    status: contact.status,
    contact_scope: contact.contact_scope || 'crm',
    personal_section: contact.personal_section || '',
    source: contact.source || defaultSource || 'manual',
    priority: contact.priority || 0,
    responsible: contact.responsible || '',
    value: contact.value ?? null,
    note: contact.note || '',
    next_followup_at: toDatetimeLocalValue(contact.next_followup_at),
    lost_reason: contact.lost_reason || '',
    win_probability: contact.win_probability ?? null,
  }
}

export function ContactModal({
  open,
  title,
  stages,
  initialContact,
  defaultSource,
  teamMembers = [],
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
    const resolvedName = (form.name || '').trim() || (form.company || '').trim()
    if (!resolvedName) {
      window.alert('Inserisci almeno un referente o un nome organizzazione')
      return
    }

    if (form.contact_scope === 'crm' && !isClosedStatus(form.status) && !form.next_followup_at) {
      window.alert('Ogni contatto aperto deve avere un prossimo follow-up')
      return
    }

    if (isClosedStatus(form.status) && form.status.toLowerCase() === 'lost' && !(form.lost_reason || '').trim()) {
      window.alert('Indica il motivo della perdita (lost_reason)')
      return
    }

    setSaving(true)
    try {
      await onSave({
        ...form,
        name: resolvedName,
        email: form.email?.trim(),
        phone: form.phone?.trim(),
        category: form.category?.trim(),
        company: form.company?.trim(),
        billing_tax_id: form.billing_tax_id?.trim(),
        billing_pec: form.billing_pec?.trim(),
        billing_sdi: form.billing_sdi?.trim(),
        billing_address: form.billing_address?.trim(),
        billing_zip: form.billing_zip?.trim(),
        billing_city: form.billing_city?.trim(),
        event_tag: form.event_tag?.trim(),
        personal_section: form.contact_scope === 'personal' ? form.personal_section?.trim() : '',
        source: form.source?.trim(),
        responsible: form.responsible?.trim(),
        note: form.note?.trim(),
        next_followup_at: fromDatetimeLocalValue(form.next_followup_at),
        lost_reason: isClosedStatus(form.status) && form.status.toLowerCase() === 'lost' ? form.lost_reason?.trim() : null,
        win_probability: form.win_probability ?? null,
      })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!onDelete || !window.confirm('Elimino questo contatto? Non si può annullare.')) return
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
            {saving ? 'Salvataggio…' : 'Salva'}
          </button>
        </>
      }
    >
      <div className="fg">
        <label className="fl">Referente (opzionale)</label>
        <input
          className="fi"
          value={form.name}
          onChange={(event) => setForm((previous) => ({ ...previous, name: event.target.value }))}
          placeholder="Es. Mario Rossi"
        />
        <div className="modal-helper">
          Se lasci vuoto questo campo, useremo il nome di Azienda/Organizzazione.
        </div>
      </div>

      <div className="frow">
        <div className="fg">
          <label className="fl">Azienda / Organizzazione *</label>
          <input
            className="fi"
            value={form.company || ''}
            onChange={(event) => setForm((previous) => ({ ...previous, company: event.target.value }))}
            placeholder="Es. Cantina La Messa"
          />
        </div>
        <div className="fg">
          <label className="fl">Event Tag</label>
          <input
            className="fi"
            value={form.event_tag || ''}
            onChange={(event) => setForm((previous) => ({ ...previous, event_tag: event.target.value }))}
            placeholder="Es. Fiera Milano 2026"
          />
        </div>
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

      <div className="fg">
        <label className="fl">Indirizzo sede</label>
        <input
          className="fi"
          value={form.billing_address || ''}
          onChange={(event) => setForm((previous) => ({ ...previous, billing_address: event.target.value }))}
          placeholder="Via, numero civico"
        />
      </div>

      <div className="frow">
        <div className="fg">
          <label className="fl">CAP</label>
          <input
            className="fi"
            value={form.billing_zip || ''}
            onChange={(event) => setForm((previous) => ({ ...previous, billing_zip: event.target.value }))}
            placeholder="Es. 20100"
          />
        </div>
        <div className="fg">
          <label className="fl">Città</label>
          <input
            className="fi"
            value={form.billing_city || ''}
            onChange={(event) => setForm((previous) => ({ ...previous, billing_city: event.target.value }))}
            placeholder="Es. Milano"
          />
        </div>
      </div>

      <div className="frow">
        <div className="fg">
          <label className="fl">Partita IVA / CF</label>
          <input
            className="fi"
            value={form.billing_tax_id || ''}
            onChange={(event) => setForm((previous) => ({ ...previous, billing_tax_id: event.target.value }))}
            placeholder="Es. 10831191217"
          />
        </div>
        <div className="fg">
          <label className="fl">PEC</label>
          <input
            className="fi"
            type="email"
            value={form.billing_pec || ''}
            onChange={(event) => setForm((previous) => ({ ...previous, billing_pec: event.target.value }))}
            placeholder="pec@azienda.it"
          />
        </div>
      </div>

      <div className="fg">
        <label className="fl">Codice SDI</label>
        <input
          className="fi"
          value={form.billing_sdi || ''}
          onChange={(event) => setForm((previous) => ({ ...previous, billing_sdi: event.target.value }))}
          placeholder="Es. ABCD123"
        />
      </div>

      <div className="fg">
        <label className="fl">Area</label>
        <select
          className="fi"
          value={form.contact_scope || 'crm'}
          onChange={(event) =>
            setForm((previous) => ({
              ...previous,
              contact_scope: event.target.value as ContactInput['contact_scope'],
              personal_section:
                event.target.value === 'personal'
                  ? previous.personal_section || ''
                  : '',
            }))
          }
        >
          <option value="crm">CRM</option>
          <option value="partner">Partner</option>
          <option value="personal">Area personale</option>
          <option value="holding">Lista separata</option>
        </select>
      </div>

      {form.contact_scope === 'personal' && (
        <div className="fg">
          <label className="fl">Sezione personale</label>
          <input
            className="fi"
            value={form.personal_section || ''}
            onChange={(event) => setForm((previous) => ({ ...previous, personal_section: event.target.value }))}
            placeholder="Es. Amici, Persone da chiamare"
          />
        </div>
      )}

      <div className="fg">
        <label className="fl">Categoria lead</label>
        <input
          className="fi"
          list="lead-category-suggestions"
          value={form.category || ''}
          onChange={(event) => setForm((previous) => ({ ...previous, category: event.target.value }))}
          placeholder="Es. vinitaly-winery"
        />
        <datalist id="lead-category-suggestions">
          {LEAD_CATEGORY_SUGGESTIONS.map((category) => (
            <option key={category} value={category} />
          ))}
        </datalist>
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
          {teamMembers.length > 0 ? (
            <select
              className="fi"
              value={form.responsible || ''}
              onChange={(event) => setForm((previous) => ({ ...previous, responsible: event.target.value }))}
            >
              <option value="">— Non assegnato —</option>
              {teamMembers.map((member) => (
                <option key={member.id} value={member.name}>
                  {member.name}
                </option>
              ))}
            </select>
          ) : (
            <input
              className="fi"
              value={form.responsible || ''}
              onChange={(event) => setForm((previous) => ({ ...previous, responsible: event.target.value }))}
              placeholder="Aggiungi team da Impostazioni › Team"
            />
          )}
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
          <label className="fl">
            Prossimo follow-up {form.contact_scope === 'crm' && !isClosedStatus(form.status) ? '*' : '(opzionale)'}
          </label>
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
          placeholder={
            form.contact_scope === 'personal'
              ? 'Promemoria, contesto personale, cose da ricordare...'
              : 'Contesto commerciale, dettagli, decision maker...'
          }
        />
      </div>

      {form.status.toLowerCase() === 'lost' && (
        <div className="fg">
          <label className="fl" style={{ color: '#ef4444' }}>
            Motivo perdita <span style={{ color: '#ef4444' }}>*</span>
          </label>
          <textarea
            className="fi"
            rows={2}
            value={form.lost_reason || ''}
            onChange={(event) => setForm((previous) => ({ ...previous, lost_reason: event.target.value }))}
            style={{ resize: 'vertical', borderColor: !form.lost_reason?.trim() ? '#fca5a5' : undefined }}
            placeholder="Es. Budget insufficiente, scelta concorrente, non più interessato..."
          />
        </div>
      )}
    </Modal>
  )
}
