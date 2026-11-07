/**
 * Oggi = una sola lista di lavoro. Si lavora su mappe e Tourism Intelligence:
 * i contatti "in focus" stanno in "Da fare ora", tutti gli altri (la massa di
 * follow-up vecchi) in "Arretrati", che resta consultabile e riprogrammabile ma
 * non copre quello che serve oggi.
 */
import { dueAtLocalDateKey, type ScheduledCall } from '@/lib/schedule'

export type WorkQueueSplit = {
  /** Contatti in focus con scadenza oggi o già scaduta. */
  now: ScheduledCall[]
  /** Tutti gli altri con scadenza oggi o già scaduta. */
  backlog: ScheduledCall[]
  /** Scadenze future (le mostra la pianificazione). */
  upcoming: ScheduledCall[]
}

/**
 * `focusIds` null = non so chi è in focus (rete giù): niente divisione, tutto
 * in "Da fare ora", come prima. Meglio una lista lunga che un lavoro nascosto.
 */
export function splitWorkQueue(
  calls: ScheduledCall[],
  focusIds: ReadonlySet<string> | null,
  todayKey: string
): WorkQueueSplit {
  const out: WorkQueueSplit = { now: [], backlog: [], upcoming: [] }
  for (const call of calls) {
    const key = dueAtLocalDateKey(call.due_at)
    if (!key || key > todayKey) {
      out.upcoming.push(call)
      continue
    }
    const inFocus = !focusIds || focusIds.has(call.contact.id) || call.contact.is_partner === true
    if (inFocus) out.now.push(call)
    else out.backlog.push(call)
  }
  return out
}

/** Domani alle 9, o il lunedì se domani è weekend: il "riprendo dopo" di un blocco di arretrati. */
export function nextWorkMorning(from: Date, extraDays = 0): Date {
  const d = new Date(from)
  d.setDate(d.getDate() + 1 + extraDays)
  d.setHours(9, 0, 0, 0)
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1)
  return d
}
