import { runPresentations } from './presentations'
import { runMapsQuality } from './maps-quality'
import { runMyMaps } from './mymaps'
import { runSalesFollowup } from './sales-followup'
import { runDirector } from './director'
import { runFinance } from './finance'
import { runDbCleaner } from './db-cleaner'
import type { AgentHandler } from '../office-agents'

/** Registro dei compiti installati. Ogni nuovo prompt aggiunge qui il suo handler
 * e una riga in AUTOMATION_JOBS, con il percorso /api/automation/agents/<id>/run.
 * Il contesto consente di preparare uscite, mai di inviarle o pubblicarle.
 */
export const OFFICE_AGENT_HANDLERS: Readonly<Record<string, AgentHandler>> = Object.freeze({ presentations:runPresentations, maps_quality:runMapsQuality, mymaps_builder:runMyMaps, finance: runFinance, sales_followup: runSalesFollowup, director: runDirector, db_cleaner: runDbCleaner })

export function officeAgentHandler(id: string): AgentHandler | null {
  return Object.hasOwn(OFFICE_AGENT_HANDLERS, id) ? OFFICE_AGENT_HANDLERS[id] : null
}
