/** Contratto dell'agenda: il fuso e il calcolo del prossimo turno sono del database. */
export type RecurringOrder = {
  id: string; title: string; instruction: string; every_days: 1 | 2 | 7; local_time: string
  next_local_date: string; next_due_at: string; enabled: boolean; revision: number
  last_order_id: string | null; last_scheduled_at: string | null; last_skipped_at: string | null
}
export type RecurringInput = Pick<RecurringOrder, 'title' | 'instruction' | 'every_days' | 'local_time' | 'next_local_date' | 'enabled'>
export type ReportConfig = Pick<RecurringOrder, 'every_days' | 'local_time' | 'next_local_date' | 'enabled' | 'revision'> & { next_due_at: string; last_report_at: string | null }

export function parseReportConfig(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Impostazioni report non valide')
  const value = raw as Record<string, unknown>
  if (Object.keys(value).some((key) => !['every_days', 'local_time', 'next_local_date', 'enabled', 'revision'].includes(key))) throw new Error('Campi non validi')
  const parsed = parseRecurringInput({ ...value, title: 'Report', instruction: 'Report' })
  const revision = value.revision
  if (revision !== null && (!Number.isSafeInteger(revision) || (revision as number) < 1)) throw new Error('Revisione non valida')
  return { ...parsed, revision: revision as number | null }
}

export function parseRecurringInput(raw: unknown): RecurringInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Incarico non valido')
  const item = raw as Record<string, unknown>
  if (Object.keys(item).some((key) => !['title', 'instruction', 'every_days', 'local_time', 'next_local_date', 'enabled', 'revision'].includes(key))) throw new Error('Campi non validi')
  const title = typeof item.title === 'string' ? item.title.trim() : ''
  const instruction = typeof item.instruction === 'string' ? item.instruction.trim() : ''
  const date = typeof item.next_local_date === 'string' ? item.next_local_date : ''
  const inputTime = typeof item.local_time === 'string' ? item.local_time : ''
  const time = /^([01]\d|2[0-3]):[0-5]\d(?::00(?:\.0+)?)?$/.test(inputTime) ? inputTime.slice(0, 5) : ''
  if (!title || title.length > 160 || !instruction || instruction.length > 4000) throw new Error('Scrivi titolo e istruzioni')
  if (![1, 2, 7].includes(item.every_days as number)) throw new Error('Frequenza non valida')
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || !/^20\d\d-\d\d-\d\d$/.test(date)) throw new Error('Data o ora non valida')
  const parsed = new Date(`${date}T00:00:00Z`)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new Error('Data non valida')
  if (typeof item.enabled !== 'boolean') throw new Error('Stato non valido')
  return { title, instruction, every_days: item.every_days as 1 | 2 | 7, local_time: time, next_local_date: date, enabled: item.enabled }
}
