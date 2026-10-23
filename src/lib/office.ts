import { nonNegativeInteger } from './office-pricing'

export const OFFICE_DEPARTMENTS = {
  direzione: 'Direzione', mappe: 'Mappe', ricerca: 'Ricerca', commerciale: 'Commerciale',
  finanza: 'Finanza', marketing: 'Marketing', operazioni: 'Operazioni',
} as const
export type OfficeRunStatus = 'running' | 'done' | 'partial' | 'failed' | 'skipped_budget' | 'skipped_disabled'
export const OFFICE_RUN_LABELS: Record<OfficeRunStatus, string> = {
  running: 'In corso', done: 'Conclusa', partial: 'Parziale', failed: 'Non riuscita',
  skipped_budget: 'Budget esaurito', skipped_disabled: 'Agente spento',
}
export type OfficeAgent = {
  id: string; user_id: string; name: string; department: keyof typeof OFFICE_DEPARTMENTS
  description: string; enabled: boolean; schedule_job: string | null; model: string
  daily_budget_cents: number; weekly_budget_cents: number; monthly_budget_cents: number
  settings: Record<string, unknown>
}
export type OfficeRun = {
  id: string; agent_id: string; user_id: string; started_at: string; finished_at: string | null
  status: OfficeRunStatus; summary: string; items_created: number
  cost_cents_reserved: number; cost_cents_actual: number; error: string | null; details: Record<string, unknown>
}
export type OfficeOutputKind = 'draft_email' | 'draft_post' | 'task' | 'report' | 'proposal' | 'data_fix' | 'map_job'
export type OfficeOutput = {
  id: string; agent_id: string; kind: OfficeOutputKind; title: string; body: Record<string, unknown>
  status: 'pending' | 'approved' | 'rejected' | 'done'; target_table: string | null; target_id: string | null
  created_at: string; decided_at: string | null
}
export type OfficeSpend = {
  agent_id: string; day_actual: number; day_reserved: number
  week_actual: number; week_reserved: number; month_actual: number; month_reserved: number
}
export type OfficeOverview = {
  agents: Array<OfficeAgent & { last_run: OfficeRun | null; spend: OfficeSpend }>
  runs: OfficeRun[]; outputs: OfficeOutput[]; pending_count: number
  totals: Omit<OfficeSpend, 'agent_id'>; active_agents: number
}

/** Effetto concreto della decisione, coerente con decide_office_output. */
export function officeApprovalEffect(output: Pick<OfficeOutput, 'agent_id' | 'kind' | 'body'>) {
  if (output.agent_id === 'db_cleaner' && output.kind === 'data_fix' && output.body.action === 'merge_contacts') {
    return { label: 'Approva e unisci', description: 'Unisce i gruppi di contatti compatibili nel CRM e conserva i doppioni nascosti. Controlla i gruppi prima di approvare.',
      notice: 'Unione elaborata. I gruppi compatibili sono stati uniti; eventuali gruppi saltati sono registrati nel risultato della proposta.' }
  }
  if (output.agent_id === 'entity_enricher' && output.kind === 'proposal' && output.body.action === 'enrich_entity') {
    return { label: 'Approva e importa nel CRM', description: 'Aggiorna l’ente, lo porta nel CRM e lo accoda alle Presentazioni nella stessa operazione.',
      notice: 'Ente aggiornato e portato nel CRM; lavoro accodato alle Presentazioni.' }
  }
  if (output.agent_id === 'director' && output.kind === 'proposal') {
    return { label: 'Approva e accoda', description: 'Aggiunge il lavoro alla coda dell’agente destinatario. L’esecuzione segue il suo interruttore, orario e budget.',
      notice: 'Lavoro approvato e accodato all’agente destinatario.' }
  }
  if (output.agent_id === 'languages_voice' && output.kind === 'proposal' && output.body.action === 'refresh_outdated') {
    return { label: 'Approva aggiornamento', description: 'Autorizza il rifacimento delle traduzioni indicate alla prossima corsa, entro il budget dell’agente.',
      notice: 'Aggiornamento autorizzato per la prossima corsa, entro il budget.' }
  }
  return { label: 'Approva', description: 'Registra l’approvazione. Non invia email, fatture o pubblicazioni.',
    notice: 'Approvata. La decisione è registrata; nessun invio eseguito.' }
}

/** Solo campi modificabili dal titolare; gli id e il proprietario vengono dal server. */
export function officeAgentPatch(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Impostazioni non valide')
  const source = raw as Record<string, unknown>
  const patch: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(source)) {
    if (key === 'enabled') {
      if (typeof value !== 'boolean') throw new Error('Interruttore non valido')
    } else if (['daily_budget_cents', 'weekly_budget_cents', 'monthly_budget_cents'].includes(key)) {
      if (!nonNegativeInteger(value)) throw new Error('I budget devono essere centesimi interi non negativi')
    } else if (key === 'settings') {
      if (!value || typeof value !== 'object' || Array.isArray(value) || JSON.stringify(value).length > 20_000) {
        throw new Error('Le impostazioni devono essere un oggetto JSON fino a 20 KB')
      }
    } else throw new Error(`Campo non modificabile: ${key}`)
    patch[key] = value
  }
  if (!Object.keys(patch).length) throw new Error('Nessuna modifica richiesta')
  return patch
}
