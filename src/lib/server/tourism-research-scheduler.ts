import { createServiceRoleClient } from './supabase'
import { runSiteResearch } from './tourism-research'

/** Independent of outreach automation. Eligible sources are queued checks or enabled recurring sites. */
export async function runTourismResearchTick(
  sb: ReturnType<typeof createServiceRoleClient>,
  now = new Date()
) {
  const slot = new Date(now)
  slot.setUTCSeconds(0, 0)
  const { data: source, error } = await sb
    .from('tourism_site_work_queue')
    .select('id,user_id')
    .lte('next_run_at', now.toISOString())
    .or(`leased_until.is.null,leased_until.lt.${now.toISOString()}`)
    .order('qualification_pending', { ascending: false })
    .order('next_run_at')
    .order('id')
    .limit(1)
    .maybeSingle()
  if (error) throw error
  if (!source) return { skipped: true }
  // Durable per-minute reservation across replicas; never run without the reservation table.
  const { error: claimError } = await sb
    .from('automation_job_runs')
    .insert({ job: 'tourism-site-research', slot: slot.toISOString() })
  if (claimError?.code === '23505') return { skipped: true }
  if (claimError) throw claimError
  const start = Date.now()
  try {
    const result = await runSiteResearch(sb, source.user_id, source.id)
    const report = 'report' in result ? result.report : null
    const failure =
      report && ['blocked', 'failed'].includes(report.state)
        ? report.errors
            .map((e) => e.message)
            .join('; ')
            .slice(0, 500)
        : null
    const finished = await sb
      .from('automation_job_runs')
      .update({
        finished_at: new Date().toISOString(),
        ok: !failure,
        error: failure,
        steps: [
          {
            path: 'tourism-site-research',
            ok: !failure,
            ms: Date.now() - start,
            source_id: source.id,
            state: report?.state || 'skipped',
            requests: report?.requests || 0
          }
        ]
      })
      .eq('job', 'tourism-site-research')
      .eq('slot', slot.toISOString())
    if (finished.error) throw finished.error
    return result
  } catch (error) {
    await sb
      .from('automation_job_runs')
      .update({
        finished_at: new Date().toISOString(),
        ok: false,
        error: (error instanceof Error
          ? error.message
          : 'Research failed'
        ).slice(0, 500)
      })
      .eq('job', 'tourism-site-research')
      .eq('slot', slot.toISOString())
    throw error
  }
}

let started = false
export function startTourismResearchScheduler() {
  if (
    started ||
    process.env.TOURISM_RESEARCH_ENABLED === 'false' ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  )
    return
  started = true
  const sb = createServiceRoleClient()
  let running = false
  const tick = () => {
    if (!running) {
      running = true
      runTourismResearchTick(sb)
        .catch((error) =>
          console.error(
            '[tourism-site-research]',
            error instanceof Error ? error.message : 'Research failed'
          )
        )
        .finally(() => {
          running = false
        })
    }
    setTimeout(tick, 60000 - (Date.now() % 60000) + 1500).unref()
  }
  // Source leases and the database daily request cap also apply to manual scans.
  setTimeout(tick, 10000).unref()
  console.log(
    '[tourism-site-research] queue worker ready; one-time sitemap checks and enabled recurring sites, no paid AI'
  )
}
