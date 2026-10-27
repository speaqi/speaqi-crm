import type { OfficeSceneSnapshot } from './office-scene'

export type OfficeSceneEvent = { key: string; from: string; to: string }
/** Ogni messaggio è legato a un cambiamento persistito; il primo snapshot non rianima lo storico. */
export function officeSceneEvents(previous: OfficeSceneSnapshot | null, next: OfficeSceneSnapshot): OfficeSceneEvent[] {
  if (!previous) return []
  const before = new Map((previous.works || []).map((work) => [work.id, work]))
  const events: OfficeSceneEvent[] = []
  for (const work of next.works || []) {
    const old = before.get(work.id)
    if (!old && work.fromDirector && work.status !== 'cancelled') {
      events.push({ key: `assigned:${work.id}`, from: 'director', to: work.agentId })
    }
    if (old?.status !== 'succeeded' && work.status === 'succeeded' && work.agentId !== 'director') {
      events.push({ key: `result:${work.id}`, from: work.agentId, to: 'kiosk' })
    }
  }
  const outputs = new Set(previous.outputs.map((output) => output.id))
  for (const output of next.outputs) if (!outputs.has(output.id)) {
    events.push({ key: `output:${output.id}`, from: output.agentId, to: 'kiosk' })
  }
  return events
}
