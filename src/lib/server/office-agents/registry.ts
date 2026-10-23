import { runAgency } from './agency'
import { runEventsScout } from './events-scout'
import { runNewsWatch } from './news-watch'
import { runSocial } from './social'
import { runPresentations } from './presentations'
import { runMapsQuality } from './maps-quality'
import { runMyMaps } from './mymaps'
import { runSalesFollowup } from './sales-followup'
import { runDirector } from './director'
import { runFinance } from './finance'
import { runDbCleaner } from './db-cleaner'
import { runLanguagesVoice } from './languages-voice'
import { runEntityEnricher } from './entity-enricher'
import type { AgentHandler } from '../office-agents'

/** Registro dei compiti installati. Ogni nuovo prompt aggiunge qui il suo handler
 * e una riga in AUTOMATION_JOBS, con il percorso /api/automation/agents/<id>/run.
 * Il contesto consente di preparare uscite, mai di inviarle o pubblicarle.
 */
export const OFFICE_AGENT_HANDLERS: Readonly<Record<string, AgentHandler>> = Object.freeze({ agency: runAgency, events_scout:runEventsScout, maps_quality: runMapsQuality, mymaps_builder: runMyMaps, finance: runFinance, sales_followup: runSalesFollowup, director: runDirector, db_cleaner: runDbCleaner, languages_voice: runLanguagesVoice, news_watch: runNewsWatch, social: runSocial, presentations: runPresentations, entity_enricher: runEntityEnricher })

export function officeAgentHandler(id: string): AgentHandler | null {
  return Object.hasOwn(OFFICE_AGENT_HANDLERS, id) ? OFFICE_AGENT_HANDLERS[id] : null
}
