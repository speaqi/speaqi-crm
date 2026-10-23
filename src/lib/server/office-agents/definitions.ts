import type { OfficeAgent } from '@/lib/office'

export type OfficeAgentDefinition = Omit<OfficeAgent, 'user_id'>
/** Ogni installazione parte spenta; i budget salvati dal titolare non si riscrivono. */
export const OFFICE_AGENT_DEFINITIONS: Readonly<Record<string, OfficeAgentDefinition>> = Object.freeze({
  news_watch:{id:'news_watch',name:'Osservatorio novità',department:'ricerca',description:'Rassegna con fonti delle ultime 48 ore, Telegram solo dopo clic.',enabled:false,schedule_job:'office-news-watch',model:'gpt-5-mini',daily_budget_cents:30,weekly_budget_cents:210,monthly_budget_cents:930,settings:{feeds:[],competitors:['STQRY','Cuseum','SmartGuide','VoiceMap','Locatify'],telegram:false}},
  director: {id:'director',name:'Direttore',department:'direzione',description:'Priorità settimanali con fonti e proposte da decidere.',enabled:false,schedule_job:'office-director',model:'gpt-5-mini',daily_budget_cents:100,weekly_budget_cents:100,monthly_budget_cents:500,settings:{}},
  sales_followup: { id:'sales_followup',name:'Commerciale',department:'commerciale',description:'Bozze di follow-up con fonti CRM, al massimo 15 al giorno.',enabled:false,schedule_job:'office-sales-followup',model:'gpt-5-mini',daily_budget_cents:100,weekly_budget_cents:700,monthly_budget_cents:3100,settings:{} },
  finance: { id: 'finance', name: 'Finanza', department: 'finanza', description: 'Bozze fattura, solleciti da rivedere e chiusura del mese.',
    enabled: false, schedule_job: 'office-finance', model: 'gpt-5-mini',
    daily_budget_cents: 20, weekly_budget_cents: 140, monthly_budget_cents: 620, settings: {} },
})

/** Il registro a slug univoco della base comune appartiene al workspace
 * configurato per le automazioni. Nessun altro utente puo' appropriarsi degli id.
 */
export async function ensureOfficeAgents(admin: any, userId: string) {
  if (!process.env.AUTOMATION_WORKSPACE_USER_ID || userId !== process.env.AUTOMATION_WORKSPACE_USER_ID) return
  for (const definition of Object.values(OFFICE_AGENT_DEFINITIONS)) {
    const { error } = await admin.from('office_agents').upsert({ ...definition, user_id: userId }, { onConflict: 'id', ignoreDuplicates: true })
    if (error) throw error
    const result = await admin.from('office_agents').select('id').eq('id', definition.id).eq('user_id', userId).maybeSingle()
    if (result.error) throw result.error
    if (!result.data) throw new Error(`L’agente ${definition.id} appartiene a un altro workspace: verifica il registro`)
  }
}
