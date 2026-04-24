import type { CRMContact, ContactInput, ContactScope, PipelineStage } from '@/types'

export const DEFAULT_PIPELINE_STAGES: Array<Omit<PipelineStage, 'id'>> = [
  { name: 'New', order: 0, color: '#3b82f6', system_key: 'new' },
  { name: 'Contacted', order: 1, color: '#f59e0b', system_key: 'contacted' },
  { name: 'Interested', order: 2, color: '#10b981', system_key: 'interested' },
  { name: 'Supertop', order: 3, color: '#e11d48', system_key: 'supertop' },
  { name: 'Call booked', order: 4, color: '#7c3aed', system_key: 'call_booked' },
  { name: 'Quote', order: 5, color: '#f97316', system_key: 'quote' },
  { name: 'Lost', order: 6, color: '#ef4444', system_key: 'lost' },
  { name: 'Closed', order: 7, color: '#059669', system_key: 'closed' },
  { name: 'Paid', order: 8, color: '#0d9488', system_key: 'paid' },
]

export const SOURCE_OPTIONS = ['manual', 'speaqi', 'vinitaly', 'evento', 'import', 'legacy-kanban']
export const LEAD_CATEGORY_SUGGESTIONS = [
  'vinitaly-winery',
  'vinitaly-importer',
  'vinitaly-buyer',
  'vinitaly-distributor',
  'vinitaly-partner',
  'vinitaly-press',
]

export const ACTIVITY_TYPES = ['call', 'email', 'msg', 'note']

export const TASK_TYPES = ['follow-up', 'call', 'email']

export const PRIORITY_OPTIONS = [
  { value: 0, label: 'Nessuna' },
  { value: 1, label: 'Bassa' },
  { value: 2, label: 'Media' },
  { value: 3, label: 'Alta' },
]

export const EMPTY_CONTACT_INPUT: ContactInput = {
  name: '',
  email: '',
  phone: '',
  status: 'New',
  source: 'manual',
  contact_scope: 'crm',
  personal_section: '',
  category: '',
  company: '',
  event_tag: '',
  list_name: '',
  priority: 0,
  responsible: '',
  value: null,
  note: '',
  next_followup_at: '',
}

export function priorityLabel(priority?: number | null) {
  return PRIORITY_OPTIONS.find((option) => option.value === Number(priority ?? 0))?.label || 'Nessuna'
}

export function sourceLabel(source?: string | null) {
  switch (source || 'manual') {
    case 'manual':
      return 'Manuale'
    case 'speaqi':
      return 'Inbound'
    case 'evento':
      return 'Evento'
    case 'vinitaly':
      return 'Vinitaly'
    case 'import':
      return 'Import'
    case 'legacy-kanban':
      return 'Legacy Kanban'
    default:
      return source || 'Manuale'
  }
}

export function contactScopeLabel(scope?: string | null) {
  switch (scope || 'crm') {
    case 'personal':
      return 'Area personale'
    case 'holding':
      return 'Lista separata'
    case 'crm':
    default:
      return 'CRM'
  }
}

export function holdingListLabel(contact: Pick<CRMContact, 'list_name' | 'event_tag' | 'source'>) {
  return contact.list_name || contact.event_tag || sourceLabel(contact.source) || 'Lista separata'
}

export function personalSectionLabel(
  contact: Pick<CRMContact, 'personal_section' | 'list_name' | 'category'>
) {
  return contact.personal_section || contact.list_name || contact.category || 'Senza sezione'
}

export function isPersonalContact(contact: Pick<CRMContact, 'contact_scope'>) {
  return (contact.contact_scope || 'crm') === 'personal'
}

export function statusLabel(status?: string | null) {
  switch (status || '') {
    case 'New':
    case 'new':
      return 'Nuovo'
    case 'Contacted':
    case 'contacted':
      return 'Contattato'
    case 'replied':
      return 'Ha risposto'
    case 'Interested':
    case 'interested':
      return 'Interessato'
    case 'Supertop':
    case 'supertop':
      return 'SUPERTOP'
    case 'Call booked':
    case 'call_scheduled':
      return 'Call fissata'
    case 'Quote':
      return 'Preventivo'
    case 'Lost':
    case 'not_interested':
      return 'Perso'
    case 'Closed':
    case 'closed':
      return 'Chiuso'
    case 'Paid':
    case 'paid':
      return 'Pagato'
    default:
      return status || ''
  }
}

export function activityTypeLabel(type: string) {
  switch (type) {
    case 'call':
      return 'Chiamata'
    case 'email':
      return 'Email'
    case 'email_sent':
      return 'Email inviata'
    case 'email_open':
      return 'Email aperta'
    case 'email_click':
      return 'Click email'
    case 'unsubscribe':
      return 'Disiscrizione'
    case 'email_reply':
      return 'Risposta email'
    case 'msg':
      return 'Messaggio'
    case 'note':
      return 'Nota'
    case 'task':
      return 'Task'
    case 'system':
      return 'Sistema'
    case 'import':
      return 'Import'
    default:
      return type
  }
}

export function priorityBadgeClass(priority?: number | null) {
  const value = Number(priority ?? 0)
  if (value >= 3) return 'tag-alta'
  if (value === 2) return 'tag-media'
  if (value === 1) return 'tag-bassa'
  return ''
}

export function stageColor(status: string, stages: PipelineStage[]) {
  return stages.find((stage) => stage.name === status)?.color || '#4f6ef7'
}

export function formatDateTime(value?: string | null) {
  if (!value) return 'Non pianificato'
  return new Date(value).toLocaleString('it-IT', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function asDate(value?: string | Date | null) {
  if (!value) return null
  const date = value instanceof Date ? new Date(value) : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function toLocalDateKey(value?: string | Date | null) {
  const date = asDate(value)
  if (!date) return ''

  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function isCallableDate(value?: string | Date | null) {
  const date = asDate(value)
  return !!date
}

export function nextCallableDateTime(value?: string | Date | null) {
  const date = asDate(value) || new Date()
  const next = new Date(date)

  next.setDate(next.getDate() + 1)
  next.setHours(10, 0, 0, 0)

  while (!isCallableDate(next)) {
    next.setDate(next.getDate() + 1)
  }

  return next
}

export function toDatetimeLocalValue(value?: string | null) {
  if (!value) return ''
  const date = new Date(value)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day}T${hour}:${minute}`
}

export function fromDatetimeLocalValue(value?: string | null) {
  if (!value) return null
  return new Date(value).toISOString()
}

export function isClosedStatus(status: string) {
  const normalized = status.toLowerCase()
  return (
    normalized === 'closed' ||
    normalized === 'paid' ||
    normalized === 'lost' ||
    normalized === 'not_interested'
  )
}

export function isHoldingContact(contact: Pick<CRMContact, 'contact_scope'>) {
  return (contact.contact_scope || 'crm') === 'holding'
}

export function normalizeContactScope(value?: string | null, fallback: ContactScope = 'crm'): ContactScope {
  const normalized = String(value ?? fallback).trim().toLowerCase()
  if (normalized === 'holding') return 'holding'
  if (normalized === 'personal') return 'personal'
  return 'crm'
}

export function isOverdue(value?: string | null) {
  if (!value) return false
  return new Date(value).getTime() < Date.now()
}

export function isComuneContact(contact: Pick<CRMContact, 'name'>) {
  return /\bcomune\b/i.test(contact.name || '')
}

export function isNeverContacted(contact: Pick<CRMContact, 'status' | 'last_contact_at'>) {
  return contact.status === 'New' && !contact.last_contact_at
}

export function isPipelineVisible(contact: Pick<CRMContact, 'status' | 'last_contact_at'>) {
  return !isNeverContacted(contact)
}

export function mapLegacyStatus(status?: string | null) {
  switch ((status || '').trim()) {
    case 'Da fare':
      return 'New'
    case 'Da Richiamare':
      return 'Contacted'
    case 'In Attesa':
      return 'Interested'
    case 'In corso':
    case 'Revisione':
      return 'Call booked'
    case 'Completato':
      return 'Closed'
    case 'Non Interessato':
    case 'Perso':
      return 'Lost'
    default:
      return 'New'
  }
}

export function mapLegacyPriority(priority?: string | null) {
  switch ((priority || '').trim().toLowerCase()) {
    case 'alta':
      return 3
    case 'media':
      return 2
    case 'bassa':
      return 1
    default:
      return 0
  }
}

/** Match come RLS/API: responsible o assigned_agent uguale al nome (trim + lower). */
export function contactMatchesAssigneeName(contact: CRMContact, memberName: string) {
  const t = (memberName || '').trim().toLowerCase()
  if (!t) return false
  const r = (contact.responsible || '').trim().toLowerCase()
  const a = (contact.assigned_agent || '').trim().toLowerCase()
  return r === t || a === t
}

/**
 * True se il contatto risulta assegnato (responsible o assigned_agent) a un altro membro del team:
 * il nome coincide (case-insensitive) con un membro la cui email NON è quella dell’utente loggato.
 * Usato sulla dashboard admin quando `member_name` API non coincide col testo in scheda.
 */
export function contactAssigneeIsOtherTeammate(
  contact: CRMContact,
  otherTeammateNamesNorm: Set<string>
) {
  for (const raw of [contact.responsible, contact.assigned_agent]) {
    const v = (raw || '').trim().toLowerCase()
    if (v && otherTeammateNamesNorm.has(v)) return true
  }
  return false
}

export function contactIsUnassigned(contact: CRMContact) {
  return !(contact.responsible || '').trim() && !(contact.assigned_agent || '').trim()
}
