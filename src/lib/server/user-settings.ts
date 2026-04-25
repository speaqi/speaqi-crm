export type UserSettings = {
  speaqi_context?: string | null
  email_tone?: string | null
  email_signature?: string | null
  email_target_audience?: string | null
  email_value_proposition?: string | null
  email_offer_details?: string | null
  email_proof_points?: string | null
  email_objection_notes?: string | null
  email_call_to_action?: string | null
}

const BASE_COLUMNS = ['speaqi_context', 'email_tone', 'email_signature'] as const
const EXTENDED_COLUMNS = [
  ...BASE_COLUMNS,
  'email_target_audience',
  'email_value_proposition',
  'email_offer_details',
  'email_proof_points',
  'email_objection_notes',
  'email_call_to_action',
] as const

export const EMPTY_USER_SETTINGS: UserSettings = {
  speaqi_context: null,
  email_tone: null,
  email_signature: null,
  email_target_audience: null,
  email_value_proposition: null,
  email_offer_details: null,
  email_proof_points: null,
  email_objection_notes: null,
  email_call_to_action: null,
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message || '')
  }
  return ''
}

function isMissingSettingsColumn(error: unknown) {
  const message = errorMessage(error).toLowerCase()
  return (
    (message.includes('email_target_audience') ||
      message.includes('email_value_proposition') ||
      message.includes('email_offer_details') ||
      message.includes('email_proof_points') ||
      message.includes('email_objection_notes') ||
      message.includes('email_call_to_action')) &&
    (message.includes('schema cache') || message.includes('column') || message.includes('could not find'))
  )
}

function normalizeSetting(value: unknown) {
  const normalized = String(value || '').trim()
  return normalized || null
}

function normalizePayload(input: Partial<UserSettings>) {
  return {
    speaqi_context: normalizeSetting(input.speaqi_context),
    email_tone: normalizeSetting(input.email_tone),
    email_signature: normalizeSetting(input.email_signature),
    email_target_audience: normalizeSetting(input.email_target_audience),
    email_value_proposition: normalizeSetting(input.email_value_proposition),
    email_offer_details: normalizeSetting(input.email_offer_details),
    email_proof_points: normalizeSetting(input.email_proof_points),
    email_objection_notes: normalizeSetting(input.email_objection_notes),
    email_call_to_action: normalizeSetting(input.email_call_to_action),
  }
}

export async function loadUserSettings(supabase: any, userId: string): Promise<UserSettings> {
  const extended = await supabase
    .from('user_settings')
    .select(EXTENDED_COLUMNS.join(', '))
    .eq('user_id', userId)
    .maybeSingle()

  if (!extended.error) {
    return { ...EMPTY_USER_SETTINGS, ...(extended.data || {}) }
  }

  if (!isMissingSettingsColumn(extended.error)) throw extended.error

  const base = await supabase
    .from('user_settings')
    .select(BASE_COLUMNS.join(', '))
    .eq('user_id', userId)
    .maybeSingle()

  if (base.error) throw base.error
  return { ...EMPTY_USER_SETTINGS, ...(base.data || {}) }
}

export async function saveUserSettings(supabase: any, userId: string, input: Partial<UserSettings>) {
  const normalized = normalizePayload(input)
  const payload = {
    user_id: userId,
    ...normalized,
    updated_at: new Date().toISOString(),
  }

  const extended = await supabase
    .from('user_settings')
    .upsert(payload, { onConflict: 'user_id' })

  if (!extended.error) return
  if (!isMissingSettingsColumn(extended.error)) throw extended.error

  const fallbackPayload = {
    user_id: userId,
    speaqi_context: normalized.speaqi_context,
    email_tone: normalized.email_tone,
    email_signature: normalized.email_signature,
    updated_at: new Date().toISOString(),
  }

  const fallback = await supabase
    .from('user_settings')
    .upsert(fallbackPayload, { onConflict: 'user_id' })

  if (fallback.error) throw fallback.error
}
