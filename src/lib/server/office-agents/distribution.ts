import { createServiceRoleClient } from '../supabase'
import { prepareDistributionMessages } from '../distribution-outreach'
import type { AgentHandler } from '../office-agents'

/**
 * Agente Distribuzione: ogni mattina feriale prepara i primi contatti di oggi (fascia A e B di
 * Tourism Intelligence, legati a una guida) e i promemoria dovuti. Non invia: l'invio parte dal
 * job `distribution-outreach`, in orario d'ufficio, dopo il clic del titolare (o subito, con
 * `settings.autopilot`).
 */
export function distributionHandler(admin: any, options: { now?: () => Date } = {}): AgentHandler {
  return async (ctx) => {
    const result = await prepareDistributionMessages(admin, ctx, options.now?.() || new Date())
    const how = result.autopilot ? 'in coda per l’invio' : 'da approvare (anche su Telegram)'
    return { summary: `Preparati ${result.created} primi contatti e ${result.followups} promemoria, ${how}; saltati ${result.skipped}.` }
  }
}
export const runDistribution: AgentHandler = (ctx) => distributionHandler(createServiceRoleClient())(ctx)
