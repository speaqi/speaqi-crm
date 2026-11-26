import { createServiceRoleClient } from '../supabase'
import { prepareDistributionMessages } from '../distribution-outreach'
import type { AgentHandler } from '../office-agents'

/**
 * Agente Distribuzione: ogni mattina feriale aggiorna i profili dei partner, legge i siti
 * che servono (pochi, dal valore più alto), prepara i primi contatti di oggi fra le aziende
 * che lavorano dove la guida è online e i promemoria dovuti. Non invia: l'invio parte dal
 * job `distribution-outreach`, in orario d'ufficio, dopo il clic del titolare (o subito, con
 * `settings.autopilot`).
 */
export function distributionHandler(admin: any, options: { now?: () => Date } = {}): AgentHandler {
  return async (ctx) => {
    const result = await prepareDistributionMessages(admin, ctx, options.now?.() || new Date())
    const how = result.autopilot ? 'in coda per l’invio' : 'da approvare (anche su Telegram)'
    const sites = result.sites?.read ? ` Siti letti ${result.sites.read} (email trovate ${result.sites.emails}).` : ''
    const profiles = result.profiles ? ` Profili aggiornati: ${result.profiles}.` : ''
    return { summary: `Preparati ${result.created} primi contatti e ${result.followups} promemoria, ${how}; saltati ${result.skipped}.${sites}${profiles}` }
  }
}
export const runDistribution: AgentHandler = (ctx) => distributionHandler(createServiceRoleClient())(ctx)
