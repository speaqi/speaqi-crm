import { DEFAULT_EMAIL_AI_FRAMEWORK } from '@/lib/email-ai-framework'

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
  email_goal?: string | null
  email_strategy?: string | null
  email_positioning?: string | null
  email_do_not_say?: string | null
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
  'email_goal',
  'email_strategy',
  'email_positioning',
  'email_do_not_say',
] as const
const PRE_POSITIONING_EXTENDED_COLUMNS = EXTENDED_COLUMNS.filter(
  (column) => column !== 'email_positioning' && column !== 'email_do_not_say'
)
const PRE_GOAL_EXTENDED_COLUMNS = PRE_POSITIONING_EXTENDED_COLUMNS.filter(
  (column) => column !== 'email_goal' && column !== 'email_strategy'
)

export const EMPTY_USER_SETTINGS: UserSettings = {
  speaqi_context: DEFAULT_EMAIL_AI_FRAMEWORK.speaqi_context,
  email_tone: DEFAULT_EMAIL_AI_FRAMEWORK.email_tone,
  email_signature: null,
  email_target_audience: DEFAULT_EMAIL_AI_FRAMEWORK.email_target_audience,
  email_value_proposition: DEFAULT_EMAIL_AI_FRAMEWORK.email_value_proposition,
  email_offer_details: DEFAULT_EMAIL_AI_FRAMEWORK.email_offer_details,
  email_proof_points: DEFAULT_EMAIL_AI_FRAMEWORK.email_proof_points,
  email_objection_notes: DEFAULT_EMAIL_AI_FRAMEWORK.email_objection_notes,
  email_call_to_action: DEFAULT_EMAIL_AI_FRAMEWORK.email_call_to_action,
  email_goal: DEFAULT_EMAIL_AI_FRAMEWORK.email_goal,
  email_strategy: DEFAULT_EMAIL_AI_FRAMEWORK.email_strategy,
  email_positioning: DEFAULT_EMAIL_AI_FRAMEWORK.email_positioning,
  email_do_not_say: DEFAULT_EMAIL_AI_FRAMEWORK.email_do_not_say,
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
  const columnMissing =
    message.includes('email_target_audience') ||
    message.includes('email_value_proposition') ||
    message.includes('email_offer_details') ||
    message.includes('email_proof_points') ||
    message.includes('email_objection_notes') ||
    message.includes('email_call_to_action') ||
    message.includes('email_goal') ||
    message.includes('email_strategy') ||
    message.includes('email_positioning') ||
    message.includes('email_do_not_say')

  return columnMissing &&
    (message.includes('schema cache') || message.includes('column') || message.includes('could not find'))
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
    email_goal: normalizeSetting(input.email_goal),
    email_strategy: normalizeSetting(input.email_strategy),
    email_positioning: normalizeSetting(input.email_positioning),
    email_do_not_say: normalizeSetting(input.email_do_not_say),
  }
}

function mergeLoadedSettings(data?: Partial<UserSettings> | null): UserSettings {
  const nonEmptyValues = Object.fromEntries(
    Object.entries(data || {}).filter(([key, value]) =>
      key === 'email_signature' || String(value || '').trim()
    )
  )

  return { ...EMPTY_USER_SETTINGS, ...nonEmptyValues }
}

export async function loadUserSettings(supabase: any, userId: string): Promise<UserSettings> {
  const extended = await supabase
    .from('user_settings')
    .select(EXTENDED_COLUMNS.join(', '))
    .eq('user_id', userId)
    .maybeSingle()

  if (!extended.error) {
    return mergeLoadedSettings(extended.data)
  }

  if (!isMissingSettingsColumn(extended.error)) throw extended.error

  const prePositioning = await supabase
    .from('user_settings')
    .select(PRE_POSITIONING_EXTENDED_COLUMNS.join(', '))
    .eq('user_id', userId)
    .maybeSingle()

  if (!prePositioning.error) {
    return mergeLoadedSettings(prePositioning.data)
  }

  const preGoal = await supabase
    .from('user_settings')
    .select(PRE_GOAL_EXTENDED_COLUMNS.join(', '))
    .eq('user_id', userId)
    .maybeSingle()

  if (!preGoal.error) {
    return mergeLoadedSettings(preGoal.data)
  }

  const base = await supabase
    .from('user_settings')
    .select(BASE_COLUMNS.join(', '))
    .eq('user_id', userId)
    .maybeSingle()

  if (base.error) throw base.error
  return mergeLoadedSettings(base.data)
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

  const prePositioningPayload = {
    user_id: userId,
    speaqi_context: normalized.speaqi_context,
    email_tone: normalized.email_tone,
    email_signature: normalized.email_signature,
    email_target_audience: normalized.email_target_audience,
    email_value_proposition: normalized.email_value_proposition,
    email_offer_details: normalized.email_offer_details,
    email_proof_points: normalized.email_proof_points,
    email_objection_notes: normalized.email_objection_notes,
    email_call_to_action: normalized.email_call_to_action,
    email_goal: normalized.email_goal,
    email_strategy: normalized.email_strategy,
    updated_at: new Date().toISOString(),
  }

  const prePositioning = await supabase
    .from('user_settings')
    .upsert(prePositioningPayload, { onConflict: 'user_id' })

  if (!prePositioning.error) return

  const preGoalPayload = {
    ...prePositioningPayload,
    email_goal: undefined,
    email_strategy: undefined,
  }
  const preGoal = await supabase.from('user_settings').upsert(preGoalPayload, { onConflict: 'user_id' })
  if (!preGoal.error) return

  const basePayload = {
    user_id: userId,
    speaqi_context: normalized.speaqi_context,
    email_tone: normalized.email_tone,
    email_signature: normalized.email_signature,
    updated_at: new Date().toISOString(),
  }
  const fallback = await supabase.from('user_settings').upsert(basePayload, { onConflict: 'user_id' })
  if (fallback.error) throw fallback.error
}
