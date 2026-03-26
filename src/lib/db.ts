'use client'
import { createClient } from '@/lib/supabase'

// ── TYPES ──────────────────────────────────────────────────────────────────

export interface CRMContact {
  id: string
  user_id: string
  name: string
  email?: string
  phone?: string
  status: string
  source?: string
  priority?: string
  responsible?: string
  value?: number
  note?: string
  legacy_id?: string
  last_contact_at?: string
  next_followup_at?: string
  created_at: string
  updated_at: string
}

export interface Activity {
  id: string
  contact_id: string
  user_id: string
  type: string // call, email, msg, note
  content?: string
  created_at: string
  contact?: { name: string }
}

export interface Task {
  id: string
  contact_id: string
  user_id: string
  type: string // follow-up, call
  due_date?: string
  status: string // pending, done
  note?: string
  created_at: string
  contact?: { name: string }
}

// ── CONTACTS CRUD ──────────────────────────────────────────────────────────

export async function dbGetContacts(userId: string): Promise<CRMContact[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('contacts')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[dbGetContacts error]', error)
    return []
  }
  return data || []
}

export async function dbGetContact(id: string): Promise<CRMContact | null> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('contacts')
    .select('*')
    .eq('id', id)
    .single()

  if (error) {
    console.error('[dbGetContact error]', error)
    return null
  }
  return data
}

export async function dbCreateContact(
  userId: string,
  data: Partial<CRMContact>
): Promise<CRMContact | null> {
  const supabase = createClient()
  const { data: created, error } = await supabase
    .from('contacts')
    .insert({
      user_id: userId,
      name: data.name || '',
      email: data.email,
      phone: data.phone,
      status: data.status || 'da-contattare',
      source: data.source,
      priority: data.priority,
      responsible: data.responsible,
      value: data.value,
      note: data.note,
      legacy_id: data.legacy_id,
      last_contact_at: data.last_contact_at,
      next_followup_at: data.next_followup_at,
    })
    .select()
    .single()

  if (error) {
    console.error('[dbCreateContact error]', error)
    return null
  }
  return created
}

export async function dbUpdateContact(
  id: string,
  data: Partial<CRMContact>
): Promise<CRMContact | null> {
  const supabase = createClient()
  const { data: updated, error } = await supabase
    .from('contacts')
    .update({
      ...data,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('[dbUpdateContact error]', error)
    return null
  }
  return updated
}

export async function dbDeleteContact(id: string): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase.from('contacts').delete().eq('id', id)
  if (error) console.error('[dbDeleteContact error]', error)
}

// ── ACTIVITIES CRUD ────────────────────────────────────────────────────────

export async function dbGetActivities(
  userId: string,
  contactId?: string
): Promise<Activity[]> {
  const supabase = createClient()
  let query = supabase
    .from('activities')
    .select('*, contact:contacts(name)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (contactId) {
    query = query.eq('contact_id', contactId)
  } else {
    query = query.limit(50)
  }

  const { data, error } = await query
  if (error) {
    console.error('[dbGetActivities error]', error)
    return []
  }
  return (data || []).map((row: any) => ({
    ...row,
    contact: Array.isArray(row.contact) ? row.contact[0] : row.contact,
  }))
}

export async function dbAddActivity(
  userId: string,
  contactId: string,
  type: string,
  content: string
): Promise<Activity | null> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('activities')
    .insert({
      user_id: userId,
      contact_id: contactId,
      type,
      content,
    })
    .select('*, contact:contacts(name)')
    .single()

  if (error) {
    console.error('[dbAddActivity error]', error)
    return null
  }
  return {
    ...data,
    contact: Array.isArray(data.contact) ? data.contact[0] : data.contact,
  }
}

// ── TASKS CRUD ─────────────────────────────────────────────────────────────

export async function dbGetTasks(
  userId: string,
  status?: string
): Promise<Task[]> {
  const supabase = createClient()
  let query = supabase
    .from('tasks')
    .select('*, contact:contacts(name)')
    .eq('user_id', userId)
    .order('due_date', { ascending: true })

  if (status) {
    query = query.eq('status', status)
  }

  const { data, error } = await query
  if (error) {
    console.error('[dbGetTasks error]', error)
    return []
  }
  return (data || []).map((row: any) => ({
    ...row,
    contact: Array.isArray(row.contact) ? row.contact[0] : row.contact,
  }))
}

export async function dbGetTasksForContact(
  userId: string,
  contactId: string
): Promise<Task[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('tasks')
    .select('*, contact:contacts(name)')
    .eq('user_id', userId)
    .eq('contact_id', contactId)
    .order('due_date', { ascending: true })

  if (error) {
    console.error('[dbGetTasksForContact error]', error)
    return []
  }
  return (data || []).map((row: any) => ({
    ...row,
    contact: Array.isArray(row.contact) ? row.contact[0] : row.contact,
  }))
}

export async function dbAddTask(
  userId: string,
  contactId: string,
  type: string,
  due_date: string,
  note?: string
): Promise<Task | null> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('tasks')
    .insert({
      user_id: userId,
      contact_id: contactId,
      type,
      due_date,
      note,
      status: 'pending',
    })
    .select('*, contact:contacts(name)')
    .single()

  if (error) {
    console.error('[dbAddTask error]', error)
    return null
  }
  return {
    ...data,
    contact: Array.isArray(data.contact) ? data.contact[0] : data.contact,
  }
}

export async function dbCompleteTask(id: string): Promise<void> {
  const supabase = createClient()
  const { error } = await supabase
    .from('tasks')
    .update({ status: 'done', updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) console.error('[dbCompleteTask error]', error)
}

// ── MIGRATION: from user_state JSON blobs to Supabase tables ──────────────

export async function migrateFromUserState(
  userId: string,
  cards: any[]
): Promise<number> {
  const supabase = createClient()

  // Fetch already-migrated legacy IDs to avoid duplicates
  const { data: existing } = await supabase
    .from('contacts')
    .select('legacy_id')
    .eq('user_id', userId)
    .not('legacy_id', 'is', null)

  const migratedIds = new Set((existing || []).map((r: any) => r.legacy_id))

  const toInsert = cards
    .filter((c) => {
      const legacyId = c._u || c.uid || c.id
      return legacyId && !migratedIds.has(legacyId)
    })
    .map((c) => ({
      user_id: userId,
      name: c.n || c.name || 'Senza nome',
      status: c.s || c.status || 'Da Richiamare',
      priority: c.p || c.priority,
      responsible: c.r || c.responsible,
      value: c.$ ? Number(c.$) : c.value,
      note: c.note,
      source: 'kanban',
      legacy_id: c._u || c.uid || c.id,
    }))

  if (!toInsert.length) return 0

  const { data: inserted, error } = await supabase
    .from('contacts')
    .insert(toInsert)
    .select('id')

  if (error) {
    console.error('[migrateFromUserState error]', error)
    return 0
  }

  return inserted?.length || 0
}
