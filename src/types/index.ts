export interface PipelineStage {
  id: string
  user_id?: string
  name: string
  order: number
  color?: string | null
  system_key?: string | null
  created_at?: string
}

export interface CRMContact {
  id: string
  user_id?: string
  name: string
  email?: string | null
  phone?: string | null
  status: string
  source?: string | null
  priority: number
  responsible?: string | null
  value?: number | null
  note?: string | null
  legacy_id?: string | null
  last_activity_summary?: string | null
  last_contact_at?: string | null
  next_followup_at?: string | null
  created_at: string
  updated_at: string
}

export interface Activity {
  id: string
  contact_id: string
  user_id?: string
  type: string
  content?: string | null
  created_at: string
}

export interface Task {
  id: string
  contact_id: string
  user_id?: string
  type: string
  due_date?: string | null
  status: 'pending' | 'done'
  note?: string | null
  completed_at?: string | null
  created_at: string
  updated_at: string
}

export interface TaskWithContact extends Task {
  contact?: {
    id: string
    name: string
    status: string
    source?: string | null
    priority: number
    next_followup_at?: string | null
  } | null
}

export interface ContactDetail {
  contact: CRMContact
  activities: Activity[]
  tasks: Task[]
  emails: GmailMessage[]
  gmail: GmailAccountStatus
}

export interface CRMState {
  stages: PipelineStage[]
  contacts: CRMContact[]
  tasks: TaskWithContact[]
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

export interface ContactInput {
  name: string
  email?: string
  phone?: string
  status: string
  source?: string
  priority: number
  responsible?: string
  value?: number | null
  note?: string
  next_followup_at?: string | null
}

export interface ActivityInput {
  type: string
  content: string
  next_followup_at?: string | null
  task_type?: string
}

export interface TaskInput {
  type: string
  due_date: string
  note?: string
}

export interface GmailAccountStatus {
  connected: boolean
  email?: string | null
  last_sync_at?: string | null
}

export interface GmailMessage {
  id: string
  user_id?: string
  gmail_account_id: string
  contact_id?: string | null
  gmail_message_id: string
  gmail_thread_id?: string | null
  direction: 'inbound' | 'outbound'
  subject?: string | null
  from_email?: string | null
  to_emails: string[]
  cc_emails: string[]
  snippet?: string | null
  body_text?: string | null
  body_html?: string | null
  sent_at?: string | null
  synced_at: string
  created_at: string
}
