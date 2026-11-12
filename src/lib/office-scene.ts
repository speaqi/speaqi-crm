import { OFFICE_DEPARTMENTS, OFFICE_RUN_LABELS, type OfficeOverview } from './office'
import { officeAgentActivity, OFFICE_ACTION_NAMES } from './office-activity'
import { PRODUCTION_ACTION_LABELS, type ProductionAction, type ProductionOverview, type ProductionRow } from './office/production'

/** Il comando lanciato dalla riga di una città, com'è adesso in StudioMap. */
export type OfficeSceneCommand = { slug: string; name: string; action: ProductionAction
  phase: string; last: string; done: boolean; error: string | null }
/** Pianificatore e ultimo backup: quello che il campus mostra sull'orologio della piazza. */
export type OfficeSceneSystem = { schedulerOn: boolean; schedulerJobs: string; lastBackupAt: string | null; backupOk: boolean | null }
export type OfficeSceneExtras = { production?: ProductionOverview | null; command?: OfficeSceneCommand | null; system?: OfficeSceneSystem | null }
const SCENE_CITIES = 12
const romeDay = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date(iso))

/** Le città per il plastico e lo schermo: prima quelle in produzione, poi le online con arretrati, poi le altre. Solo fatti, nessun link. */
export function officeSceneProduction(production: ProductionOverview | null | undefined) {
  if (!production) return null
  if (!production.available) return { available: false as const, reason: production.reason }
  const rank = (row: ProductionRow) =>
    row.protected ? 3 : !row.live ? 0 : row.next ? 1 : 2
  const rows = production.rows.map((row, i) => ({ row, i })).sort((a, b) => rank(a.row) - rank(b.row) || a.i - b.i).slice(0, SCENE_CITIES)
  return { available: true as const, creditUsd: production.credit_usd, totals: production.totals, more: Math.max(0, production.rows.length - rows.length),
    cities: rows.map(({ row }) => ({ slug: row.slug, name: row.name, live: row.live, protected: row.protected, done: row.done,
      phases: row.phases.map((phase) => phase.state === 'done' ? 'd' : phase.state === 'partial' ? 'p' : 't').join(''),
      next: row.next?.text || '', error: !!row.error })) }
}

export const OFFICE_SECTORS = Object.entries(OFFICE_DEPARTMENTS).map(([id, name], index) => ({
  id, name, color: ['#9b83d9', '#48bba6', '#62a9da', '#e48d67', '#d9b552', '#d77fa7', '#829ca8', '#a4c639'][index],
}))

/** Proiezione per l'iframe: nessuna credenziale, impostazione o corpo delle bozze. */
export function officeSceneSnapshot(overview: OfficeOverview, updatedAt = new Date().toISOString(), extras: OfficeSceneExtras = {}) {
  const today = romeDay(updatedAt)
  const command = extras.command ? { ...extras.command, label: PRODUCTION_ACTION_LABELS[extras.command.action] } : null
  return {
    updatedAt, pendingCount: overview.decision_count ?? overview.pending_count, totals: overview.totals,
    departments: OFFICE_SECTORS.map((sector) => ({ ...sector,
      agents: overview.agents.filter((agent) => agent.department === sector.id).map((agent) => {
        const last = agent.last_run
        const activity = officeAgentActivity(agent, overview.works)
        const work = activity.current
        const status = activity.key
        return { id: agent.id, name: agent.name, description: agent.description, model: agent.model,
          enabled: agent.enabled, status, monthlyBudget: agent.monthly_budget_cents,
          activityLabel: activity.label, workCount: activity.openCount,
          currentWork: work ? { id: work.id, label: OFFICE_ACTION_NAMES[work.action] || 'Lavoro assegnato',
            status: work.status, reason: work.reason, requiredAction: work.required_action } : null,
          blocked: !!work && ['blocked', 'failed', 'waiting_owner'].includes(work.status),
          spend: agent.spend, lastRun: last ? { status: last.status, label: OFFICE_RUN_LABELS[last.status],
            summary: last.summary, startedAt: last.started_at } : null }
      }),
    })),
    works: (overview.works || []).map((work) => ({ id: work.id, agentId: work.agent_id, status: work.status,
      fromDirector: !!work.order_id && work.agent_id !== 'director', createdAt: work.created_at })),
    outputs: overview.outputs.map((output) => ({ id: output.id, agentId: output.agent_id, title: output.title })),
    production: officeSceneProduction(extras.production), command, system: extras.system || null,
    // La giornata da rivedere: le corse di oggi (ora di Roma), dalla prima all'ultima.
    day: overview.runs.filter((run) => romeDay(run.started_at) === today).map((run) => ({ id: run.id, agentId: run.agent_id,
      at: run.started_at, summary: run.summary, label: OFFICE_RUN_LABELS[run.status], items: run.items_created }))
      .sort((a, b) => a.at.localeCompare(b.at)),
    runs: overview.runs.slice(0, 6).map((run) => ({ id: run.id, agentId: run.agent_id, summary: run.summary,
      label: OFFICE_RUN_LABELS[run.status], startedAt: run.started_at })),
  }
}

export type OfficeSceneSnapshot = ReturnType<typeof officeSceneSnapshot>
