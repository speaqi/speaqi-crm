import { DEFAULT_PIPELINE_STAGES, isClosedStatus, mapLegacyPriority, mapLegacyStatus } from '@/lib/data'

export async function ensurePipelineStages(
  supabase: any,
  userId: string
) {
  const { data, error } = await supabase
    .from('pipeline_stages')
    .select('*')
    .eq('user_id', userId)
    .order('order', { ascending: true })

  if (error) throw error

  if (data?.length) return data

  const { data: inserted, error: insertError } = await supabase
    .from('pipeline_stages')
    .insert(
      DEFAULT_PIPELINE_STAGES.map((stage) => ({
        ...stage,
        user_id: userId,
      }))
    )
    .select('*')
    .order('order', { ascending: true })

  if (insertError) throw insertError
  return inserted || []
}

export async function getPendingTaskCount(
  supabase: any,
  userId: string,
  contactId: string
) {
  const { count, error } = await supabase
    .from('tasks')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('contact_id', contactId)
    .eq('status', 'pending')

  if (error) throw error
  return count || 0
}

export async function updateContactAfterActivity(
  supabase: any,
  contactId: string,
  content: string,
  nextFollowupAt?: string | null
) {
  const summary = content.trim().slice(0, 180)
  const payload: Record<string, unknown> = {
    last_contact_at: new Date().toISOString(),
    last_activity_summary: summary,
    updated_at: new Date().toISOString(),
  }

  if (nextFollowupAt) {
    payload.next_followup_at = nextFollowupAt
  }

  const { error } = await supabase
    .from('contacts')
    .update(payload)
    .eq('id', contactId)

  if (error) throw error
}

export async function ensureNextAction(
  supabase: any,
  userId: string,
  contactId: string,
  status: string,
  nextFollowupAt?: string | null
) {
  if (isClosedStatus(status)) return

  if (nextFollowupAt) return

  const pendingCount = await getPendingTaskCount(supabase, userId, contactId)
  if (pendingCount > 0) return

  throw new Error('Ogni contatto aperto deve avere un prossimo follow-up o un task pending')
}

export async function mapLegacyStateToRecords(userState: any, userId: string) {
  const cards = Array.isArray(userState?.cards) ? userState.cards : []
  const contacts = Array.isArray(userState?.contacts) ? userState.contacts : []
  const speaqi = Array.isArray(userState?.speaqi) ? userState.speaqi : []
  const callScheduled = userState?.call_scheduled || {}

  const legacyContacts = [
    ...cards.map((card: any) => ({
      user_id: userId,
      name: card.n || card.name || 'Lead legacy',
      email: '',
      phone: '',
      status: mapLegacyStatus(card.s || card.status),
      source: 'legacy-kanban',
      priority: mapLegacyPriority(card.p || card.priority),
      responsible: card.r || '',
      value: card.$ ? Number(card.$) : null,
      note: [card.note, card.id ? `Legacy ID: ${card.id}` : null].filter(Boolean).join('\n'),
      legacy_id: card._u || card.uid || card.id || null,
      last_activity_summary: card.note || null,
      next_followup_at: callScheduled[card._u || card.uid]
        ? new Date(`${callScheduled[card._u || card.uid]}T09:00:00`).toISOString()
        : card.d
          ? new Date(`${card.d}T09:00:00`).toISOString()
          : isClosedStatus(mapLegacyStatus(card.s || card.status))
            ? null
            : new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    })),
    ...contacts.map((contact: any) => ({
      user_id: userId,
      name: contact.n || contact.name || 'Contatto legacy',
      email: contact.email || '',
      phone: contact.phone || '',
      status: contact.st === 'contattato' ? 'Contacted' : contact.st === 'referenziato' ? 'Interested' : 'New',
      source: 'import',
      priority: mapLegacyPriority(contact.p || contact.priority),
      responsible: '',
      value: null,
      note: [contact.ref, contact.role, contact.comune, contact.notes].filter(Boolean).join('\n'),
      legacy_id: contact._u || contact.uid || null,
      last_activity_summary: null,
      next_followup_at: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
    })),
    ...speaqi.map((contact: any) => ({
      user_id: userId,
      name: contact.n || contact.name || 'Lead Speaqi legacy',
      email: contact.email || '',
      phone: '',
      status: contact.st === 'contattato' ? 'Contacted' : 'New',
      source: 'speaqi',
      priority: mapLegacyPriority(contact.p || contact.priority),
      responsible: '',
      value: null,
      note: [contact.role, contact.note].filter(Boolean).join('\n'),
      legacy_id: contact._u || contact.uid || null,
      last_activity_summary: null,
      next_followup_at: contact.st === 'contattato'
        ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
        : new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
    })),
  ]

  return legacyContacts
}
