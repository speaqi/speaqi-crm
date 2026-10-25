import type { OfficeWorkItem, OfficeWorkSpec } from '../office-work'
import { officeWorkSpec } from '../office-work'

/** Il passaggio al worker è esplicito: il deploy non accende gli agenti. */
export function officeWorkEnabled() { return process.env.OFFICE_WORKER_ENABLED?.trim().toLowerCase() === 'true' }
export function missingWorkSchema(error: unknown) {
  const e = error as { code?: string; message?: string }
  return ['42P01', '42883', 'PGRST202', 'PGRST205'].includes(e?.code || '')
}
export async function enqueueOfficeWork(admin: any, userId: string, input: OfficeWorkSpec): Promise<OfficeWorkItem> {
  const spec = officeWorkSpec(input)
  const { data, error } = await admin.rpc('office_work_enqueue', { p_user_id: userId, p_spec: spec })
  if (error) throw error
  if (!data?.id) throw new Error('Il lavoro non è stato registrato')
  return data as OfficeWorkItem
}

export const QUEUE_WORK_ACTION: Readonly<Record<string, string>> = {
  mymaps_builder: 'import_mymaps', maps_quality: 'check_map', languages_voice: 'complete_languages', presentations: 'prepare_presentation',
}

export async function enqueueAgentTurn(admin: any, userId: string, agentId: string, key: string, origin: 'schedule' | 'order' = 'schedule') {
  return enqueueOfficeWork(admin, userId, { agent_id: agentId, action: 'agent_run', origin,
    source_key: `${origin}:${agentId}:${key}`, payload: { slot: key }, status: 'ready' })
}
