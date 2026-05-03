export type ContactScope = 'crm' | 'holding' | 'personal'
export type MarketingStatus =
  | 'not_ready'
  | 'ready_to_draft'
  | 'draft_created'
  | 'ready_to_send'
  | 'sent'
  | 'followup_due'
  | 'paused'
  | 'unsubscribed'

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
  category?: string | null
  company?: string | null
  event_tag?: string | null
  list_name?: string | null
  country?: string | null
  language?: string | null
  status: string
  source?: string | null
  priority: number
  score?: number | null
  assigned_agent?: string | null
  responsible?: string | null
  value?: number | null
  note?: string | null
  email_draft_note?: string | null
  legacy_id?: string | null
  contact_scope?: ContactScope | null
  personal_section?: string | null
  promoted_at?: string | null
  last_activity_summary?: string | null
  last_contact_at?: string | null
  next_followup_at?: string | null
  next_action_at?: string | null
  email_open_count?: number | null
  email_click_count?: number | null
  last_email_open_at?: string | null
  last_email_click_at?: string | null
  email_unsubscribed_at?: string | null
  email_unsubscribe_source?: string | null
  marketing_status?: MarketingStatus | null
  marketing_paused_until?: string | null
  created_at: string
  updated_at: string
}

export interface Activity {
  id: string
  contact_id: string
  user_id?: string
  type: string
  content?: string | null
  metadata?: Record<string, unknown> | null
  created_at: string
}

export interface ActivityContactSnapshot {
  id: string
  name: string
  email?: string | null
  status?: string | null
  priority?: number | null
  contact_scope?: ContactScope | null
  personal_section?: string | null
  responsible?: string | null
}

export interface ActivityWithContact extends Activity {
  contact?: ActivityContactSnapshot | null
}

export interface Task {
  id: string
  contact_id: string
  user_id?: string
  type: string
  action?: 'send_email' | 'call' | 'wait' | null
  due_date?: string | null
  priority?: 'low' | 'medium' | 'high' | null
  status: 'pending' | 'done'
  note?: string | null
  idempotency_key?: string | null
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
    category?: string | null
    company?: string | null
    phone?: string | null
    responsible?: string | null
    event_tag?: string | null
    last_activity_summary?: string | null
    contact_scope?: ContactScope | null
    personal_section?: string | null
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

export interface TeamMember {
  id: string
  user_id?: string
  auth_user_id?: string | null
  is_current_admin?: boolean
  name: string
  email?: string | null
  color?: string | null
  created_at: string
  updated_at: string
}

export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'paid' | 'cancelled'
export type QuotePaymentMethod = 'bank_transfer' | 'stripe' | 'both'
export type QuotePaymentState = 'pending' | 'deposit_requested' | 'paid' | 'waived'

export interface QuoteLineItem {
  id?: string
  description: string
  details?: string | null
  quantity: number
  /** Prezzo effettivo in offerta (netto IVA) */
  unit_price: number
  /** Prezzo di listino / prima dello sconto, solo espositivo (stesso criterio di unit_price) */
  list_unit_price?: number | null
  line_total?: number
}

export interface QuoteContactSnapshot {
  id: string
  name: string
  email?: string | null
  company?: string | null
  phone?: string | null
  status?: string | null
  responsible?: string | null
  assigned_agent?: string | null
}

export interface Quote {
  id: string
  user_id?: string
  contact_id?: string | null
  contact?: QuoteContactSnapshot | null
  quote_number: string
  public_token: string
  status: QuoteStatus
  title: string
  customer_name: string
  customer_email?: string | null
  customer_company?: string | null
  customer_tax_id?: string | null
  customer_address?: string | null
  items: QuoteLineItem[]
  currency: string
  subtotal_amount: number
  discount_amount: number
  tax_rate: number
  tax_amount: number
  total_amount: number
  deposit_percent: number
  deposit_amount: number
  balance_amount: number
  payment_method: QuotePaymentMethod
  payment_state: QuotePaymentState
  bank_transfer_instructions?: string | null
  stripe_checkout_url?: string | null
  stripe_checkout_session_id?: string | null
  stripe_payment_status?: string | null
  contract_auto_accepted: boolean
  contract_terms?: string | null
  contract_accepted_at?: string | null
  contract_signer_email?: string | null
  valid_until?: string | null
  public_note?: string | null
  internal_note?: string | null
  sent_at?: string | null
  accepted_at?: string | null
  paid_at?: string | null
  created_at: string
  updated_at?: string
}

export interface QuoteInput {
  contact_id?: string | null
  quote_number?: string
  status?: QuoteStatus
  title: string
  customer_name: string
  customer_email?: string | null
  customer_company?: string | null
  customer_tax_id?: string | null
  customer_address?: string | null
  items: QuoteLineItem[]
  discount_amount?: number | null
  tax_rate?: number | null
  deposit_percent?: number | null
  payment_method?: QuotePaymentMethod
  bank_transfer_instructions?: string | null
  contract_terms?: string | null
  valid_until?: string | null
  public_note?: string | null
  internal_note?: string | null
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
  category?: string
  company?: string
  event_tag?: string
  list_name?: string
  country?: string
  language?: string
  status: string
  source?: string
  priority: number
  score?: number | null
  assigned_agent?: string
  responsible?: string
  value?: number | null
  note?: string
  email_draft_note?: string
  contact_scope?: ContactScope
  personal_section?: string
  next_followup_at?: string | null
  next_action_at?: string | null
  initial_task_note?: string
}

export interface ActivityInput {
  type: string
  content: string
  metadata?: Record<string, unknown>
  next_followup_at?: string | null
  task_type?: string
  task_note?: string
  task_priority?: 'low' | 'medium' | 'high'
}

export interface TaskInput {
  type: string
  action?: 'send_email' | 'call' | 'wait'
  due_date: string
  priority?: 'low' | 'medium' | 'high'
  note?: string
  idempotency_key?: string
}

export interface GmailAccountStatus {
  connected: boolean
  email?: string | null
  last_sync_at?: string | null
  signature_readable?: boolean
  needs_reconnect_for_signature?: boolean
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

export interface SentMessageHistoryItem {
  id: string
  source: string
  subject?: string | null
  recipient: string
  status?: string | null
  sent_at: string
  contact?: {
    id: string
    name: string
  } | null
}

export interface LeadMemory {
  id?: string
  lead_id: string
  summary?: string | null
  last_intent?: string | null
  tone?: string | null
  language_detected?: string | null
  last_updated?: string
  created_at?: string
}

export interface SpecLead {
  id: string
  email?: string | null
  phone?: string | null
  name: string
  category?: string | null
  company?: string | null
  country?: string | null
  language?: string | null
  status: string
  score: number
  source?: string | null
  assigned_agent?: string | null
  last_contact_at?: string | null
  next_action_at?: string | null
  created_at: string
  updated_at: string
}

export interface NextActionSuggestion {
  action: 'send_email' | 'call' | 'wait'
  delay_hours: number
  priority: 'low' | 'medium' | 'high'
  reason?: string | null
}
