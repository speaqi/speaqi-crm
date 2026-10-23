import type { AgentHandler } from '../office-agents'

/** Prompt 0: solo infrastruttura. I prompt 1–12 aggiungeranno qui gli handler
 * e una riga in AUTOMATION_JOBS, con il percorso /api/automation/agents/<id>/run.
 * Il contesto consente di preparare uscite, mai di inviarle o pubblicarle.
 */
export const OFFICE_AGENT_HANDLERS: Readonly<Record<string, AgentHandler>> = Object.freeze({})

export function officeAgentHandler(id: string): AgentHandler | null {
  return Object.hasOwn(OFFICE_AGENT_HANDLERS, id) ? OFFICE_AGENT_HANDLERS[id] : null
}
