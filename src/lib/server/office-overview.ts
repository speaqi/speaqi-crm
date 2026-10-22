import type { SupabaseClient } from '@supabase/supabase-js'
import type { OfficeAgent, OfficeOutput, OfficeOverview, OfficeRun, OfficeSpend } from '../office'

const emptySpend = (agentId: string): OfficeSpend => ({ agent_id: agentId, day_actual: 0, day_reserved: 0,
  week_actual: 0, week_reserved: 0, month_actual: 0, month_reserved: 0 })

export async function loadOfficeOverview(admin: SupabaseClient, userId: string, outputOffset = 0): Promise<OfficeOverview> {
  const agents: OfficeAgent[] = []
  for (let from = 0; ; from += 1000) {
    const result = await admin.from('office_agents').select('*').eq('user_id', userId).order('id').range(from, from + 999)
    if (result.error) throw result.error
    agents.push(...(result.data || []))
    if ((result.data || []).length < 1000) break
  }
  const [spendRes, runsRes, outputsRes, lastRuns] = await Promise.all([
    admin.rpc('office_budget_summary', { p_user_id: userId }),
    admin.from('office_agent_runs').select('*').eq('user_id', userId).order('started_at', { ascending: false }).limit(30),
    admin.from('office_agent_outputs').select('*', { count: 'exact' }).eq('user_id', userId).eq('status', 'pending')
      .order('created_at', { ascending: false }).order('id').range(outputOffset, outputOffset + 49),
    Promise.all(agents.map(async (agent) => {
      const result = await admin.from('office_agent_runs').select('*').eq('user_id', userId).eq('agent_id', agent.id)
        .order('started_at', { ascending: false }).limit(1)
      if (result.error) throw result.error
      return (result.data?.[0] as OfficeRun | undefined) || null
    })),
  ])
  for (const result of [spendRes, runsRes, outputsRes]) if (result.error) throw result.error
  const spending = new Map((spendRes.data as OfficeSpend[]).map((spend) => [spend.agent_id, spend]))
  const totals = { day_actual: 0, day_reserved: 0, week_actual: 0, week_reserved: 0, month_actual: 0, month_reserved: 0 }
  const rows = agents.map((agent, index) => {
    const spend = spending.get(agent.id) || emptySpend(agent.id)
    for (const key of Object.keys(totals) as Array<keyof typeof totals>) totals[key] += Number(spend[key])
    return { ...agent, spend, last_run: lastRuns[index] }
  })
  return { agents: rows, runs: runsRes.data as OfficeRun[], outputs: outputsRes.data as OfficeOutput[],
    pending_count: outputsRes.count || 0, totals, active_agents: agents.filter((agent) => agent.enabled).length }
}
