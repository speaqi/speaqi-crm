import { OFFICE_DEPARTMENTS, OFFICE_RUN_LABELS, type OfficeOverview } from './office'

export const OFFICE_SECTORS = Object.entries(OFFICE_DEPARTMENTS).map(([id, name], index) => ({
  id, name, color: ['#a899ef', '#64cbb5', '#6db9e8', '#849dff', '#d8b576', '#e69ab7', '#9eafb9'][index],
}))

/** Proiezione per l'iframe: nessuna credenziale, impostazione o corpo delle bozze. */
export function officeSceneSnapshot(overview: OfficeOverview, updatedAt = new Date().toISOString()) {
  return {
    updatedAt, pendingCount: overview.pending_count, totals: overview.totals,
    departments: OFFICE_SECTORS.map((sector) => ({ ...sector,
      agents: overview.agents.filter((agent) => agent.department === sector.id).map((agent) => {
        const last = agent.last_run
        const status = last?.status === 'running' ? 'running' : !agent.enabled ? 'off'
          : last?.status === 'failed' || last?.status === 'partial' || last?.status === 'skipped_budget' ? 'attention' : 'ready'
        return { id: agent.id, name: agent.name, description: agent.description, model: agent.model,
          enabled: agent.enabled, status, monthlyBudget: agent.monthly_budget_cents,
          spend: agent.spend, lastRun: last ? { status: last.status, label: OFFICE_RUN_LABELS[last.status],
            summary: last.summary, startedAt: last.started_at } : null }
      }),
    })),
    outputs: overview.outputs.map((output) => ({ id: output.id, agentId: output.agent_id, title: output.title })),
    runs: overview.runs.slice(0, 6).map((run) => ({ id: run.id, agentId: run.agent_id, summary: run.summary,
      label: OFFICE_RUN_LABELS[run.status], startedAt: run.started_at })),
  }
}

export type OfficeSceneSnapshot = ReturnType<typeof officeSceneSnapshot>
