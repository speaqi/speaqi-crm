export interface Card {
  id?: string
  uid?: string
  _u?: string
  n: string
  s: string
  p?: string
  r?: string
  d?: string
  $?: string
  note?: string
  created_at?: string
  updated_at?: string
}

export interface Contact {
  uid?: string
  _u?: string
  n: string
  ref?: string
  role?: string
  comune?: string
  st: 'contattato' | 'da-contattare' | 'referenziato'
  p?: string
  cat: string
  notes?: string
  email?: string
  phone?: string
}

export interface SpeaqiContact {
  uid?: string
  _u?: string
  n: string
  role?: string
  cat: string
  st: 'contattato' | 'da-contattare'
  p?: string
  note?: string
  email?: string
}

export interface VoiceNote {
  uid?: string
  _u?: string
  title?: string
  ts?: string
  duration?: number
  dur?: number
  transcript?: string
  created_at?: string
}

export type KanbanColumn = {
  id: string
  label: string
  color: string
  e: string
}

export interface CRMState {
  cards: Card[]
  contacts: Contact[]
  speaqi: SpeaqiContact[]
  vNotes: VoiceNote[]
  callDone: Record<string, boolean>
  callScheduled: Record<string, string>
}
