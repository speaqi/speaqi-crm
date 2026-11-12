import { createServiceRoleClient } from '@/lib/server/supabase'
import type { OfficeSceneSystem } from '@/lib/office-scene'

let cached: { at: number; value: OfficeSceneSystem } | null = null

/** Pianificatore e ultimo backup, per l'orologio del campus. Sola lettura, in memoria cinque minuti, mai un errore. */
export async function loadOfficeSystem(now = Date.now()): Promise<OfficeSceneSystem> {
  if (cached && now - cached.at < 300_000) return cached.value
  const value: OfficeSceneSystem = {
    schedulerOn: String(process.env.AUTOMATION_SCHEDULER_ENABLED || '').trim().toLowerCase() === 'true',
    schedulerJobs: String(process.env.AUTOMATION_SCHEDULER_JOBS || '').trim().slice(0, 200),
    lastBackupAt: null, backupOk: null,
  }
  try {
    const { data } = await createServiceRoleClient().from('automation_job_runs').select('slot,ok,finished_at')
      .eq('job', 'backup').order('slot', { ascending: false }).limit(1)
    const row = data?.[0] as { slot: string; ok: boolean | null; finished_at: string | null } | undefined
    if (row) { value.lastBackupAt = row.finished_at || row.slot; value.backupOk = row.ok }
  } catch { /* senza storico l'orologio dice «nessuno registrato» */ }
  cached = { at: now, value }
  return value
}
