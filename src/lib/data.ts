import type { CRMContact, ContactInput, PipelineStage } from '@/types'

export const DEFAULT_PIPELINE_STAGES: Array<Omit<PipelineStage, 'id'>> = [
  { name: 'New', order: 0, color: '#3b82f6', system_key: 'new' },
  { name: 'Contacted', order: 1, color: '#f59e0b', system_key: 'contacted' },
  { name: 'Interested', order: 2, color: '#10b981', system_key: 'interested' },
  { name: 'Call booked', order: 3, color: '#7c3aed', system_key: 'call_booked' },
  { name: 'Closed', order: 4, color: '#059669', system_key: 'closed' },
]

export const SOURCE_OPTIONS = ['manual', 'speaqi', 'evento', 'import', 'legacy-kanban']

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
    case 'import':
      return 'Import'
    case 'legacy-kanban':
      return 'Legacy Kanban'
    default:
      return source || 'Manuale'
  }
}

export function activityTypeLabel(type: string) {
  switch (type) {
    case 'call':
      return 'Chiamata'
    case 'email':
      return 'Email'
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
  return status.toLowerCase() === 'closed'
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
    case 'Non Interessato':
    case 'Perso':
      return 'Closed'
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
