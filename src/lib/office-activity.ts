import type { OfficeAgent, OfficeRun } from './office'
import type { OfficeWorkItem } from './office-work'
import { OFFICE_WORK_LABELS } from './office-work'

/** Proiezione del registro: non include payload, checkpoint o credenziali di presa. */
export type OfficeWorkSummary = Pick<OfficeWorkItem, 'id' | 'agent_id' | 'action' | 'status' | 'origin' | 'order_id'
  | 'created_at' | 'updated_at' | 'reason' | 'required_action' | 'result_summary'>
export const OFFICE_OPEN_WORK_STATUSES = ['waiting', 'ready', 'running', 'blocked', 'waiting_owner', 'failed'] as const
export const OFFICE_WORK_SUMMARY_COLUMNS = 'id,agent_id,action,status,origin,order_id,created_at,updated_at,reason,required_action,result_summary'
export const OFFICE_ACTION_NAMES: Record<string, string> = {
  interpret_order: 'Comprendere l’ordine', director_status: 'Situazione dell’ufficio', list_events: 'Prossime fiere ed eventi',
  record_task: 'Annotare l’attività', create_demo: 'Preparare la demo', create_contact: 'Inserire il contatto', import_mymaps: 'Importare la mappa',
  check_map: 'Controllare la mappa', complete_languages: 'Completare lingue e voce', refresh_outdated: 'Aggiornare le traduzioni',
  verify_tourism_entity: 'Verificare l’ente', prepare_presentation: 'Preparare la presentazione', agent_run: 'Turno dell’agente', plan: 'Piano dell’ufficio',
}

/** La fine di una corsa non cancella il blocco dell'incarico che l'ha avviata. */
export function officeAgentActivity(agent: Pick<OfficeAgent, 'id' | 'enabled'> & { last_run: OfficeRun | null }, works: OfficeWorkSummary[] = []) {
  const assigned = works.filter((work) => work.agent_id === agent.id)
  const open = assigned.filter((work) => OFFICE_OPEN_WORK_STATUSES.includes(work.status as typeof OFFICE_OPEN_WORK_STATUSES[number]))
  const rank = { running: 0, blocked: 1, failed: 2, waiting_owner: 3, ready: 4, waiting: 5, succeeded: 6, cancelled: 7 }
  const current = [...open].sort((a, b) => rank[a.status] - rank[b.status] || b.updated_at.localeCompare(a.updated_at))[0] || null
  const latest = [...assigned].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0] || null
  const running = open.some((work) => work.status === 'running') || agent.last_run?.status === 'running'
  const attention = open.some((work) => ['blocked', 'failed', 'waiting_owner'].includes(work.status))
  const key = running ? 'running' : !agent.enabled ? 'off' : attention ? 'attention'
    : agent.last_run && ['failed', 'partial', 'skipped_budget'].includes(agent.last_run.status) ? 'attention' : 'ready'
  const label = key === 'running' ? 'In corso' : key === 'off' ? 'Spento'
    : current ? OFFICE_WORK_LABELS[current.status] : key === 'attention' ? 'Da verificare' : 'Disponibile'
  return { key, label, current, latest, openCount: open.length } as const
}

/** Solo collegamenti interni a risultati identificati, mai URL suggeriti dal modello. */
export function officeResultLink(result: Record<string, unknown>): { href: string; label: string } | null {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (typeof result.map_slug === 'string' && /^demo-[a-z0-9_-]{1,100}$/.test(result.map_slug)) return { href: `https://studiomap.speaqi.com/?map=${encodeURIComponent(result.map_slug)}`, label: 'Apri demo in StudioMap' }
  if (typeof result.deck_id === 'string' && uuid.test(result.deck_id)) return { href: `/tourism/presentazioni/${result.deck_id}`, label: 'Apri presentazione' }
  if (typeof result.invoice_id === 'string' && uuid.test(result.invoice_id)) return { href: `/fatture?invoice=${result.invoice_id}`, label: 'Apri fattura' }
  return null
}
