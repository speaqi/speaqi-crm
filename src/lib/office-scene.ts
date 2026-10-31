import { OFFICE_DEPARTMENTS, OFFICE_RUN_LABELS, type OfficeOverview } from './office'
import { officeAgentActivity, OFFICE_ACTION_NAMES } from './office-activity'

export const OFFICE_SECTORS = Object.entries(OFFICE_DEPARTMENTS).map(([id, name], index) => ({
  id, name, color: ['#9b83d9', '#48bba6', '#62a9da', '#e48d67', '#d9b552', '#d77fa7', '#829ca8', '#a4c639'][index],
}))

/** Proiezione per l'iframe: nessuna credenziale, impostazione o corpo delle bozze. */
export function officeSceneSnapshot(overview: OfficeOverview, updatedAt = new Date().toISOString()) {
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
          spend: agent.spend, lastRun: last ? { status: last.status, label: OFFICE_RUN_LABELS[last.status],
            summary: last.summary, startedAt: last.started_at } : null }
      }),
    })),
    works: (overview.works || []).map((work) => ({ id: work.id, agentId: work.agent_id, status: work.status,
      fromDirector: !!work.order_id && work.agent_id !== 'director', createdAt: work.created_at })),
    outputs: overview.outputs.map((output) => ({ id: output.id, agentId: output.agent_id, title: output.title })),
    runs: overview.runs.slice(0, 6).map((run) => ({ id: run.id, agentId: run.agent_id, summary: run.summary,
      label: OFFICE_RUN_LABELS[run.status], startedAt: run.started_at })),
  }
}

export type OfficeSceneSnapshot = ReturnType<typeof officeSceneSnapshot>
