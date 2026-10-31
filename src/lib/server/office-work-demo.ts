import { officeIsNaples } from '../office/director'
import type { OfficeWorkItem, WorkOutcome } from '../office-work'
import type { AgentContext } from './office-agents'
import { officeStudioRequest } from './office-agents/maps-bridge'

/** Conserva la riserva per tutta la durata del job remoto; nessun retry alla cieca. */
export async function createDemoWork(ctx: AgentContext, work: OfficeWorkItem, admin: any, bridge: typeof officeStudioRequest = officeStudioRequest): Promise<WorkOutcome> {
  if (ctx.agent.id !== 'demo_builder' || ctx.agent.user_id !== work.user_id) throw new Error('Lavoro demo non autorizzato')
  const city = String(work.payload.city || '').trim()
  if (!city || city.length > 70 || officeIsNaples(city, typeof work.payload.slug === 'string' ? work.payload.slug : null)) throw new Error('Destinazione non valida o protetta')
  const previous = work.checkpoint || {}
  let ledger = typeof previous.demo_ledger_id === 'string' ? previous.demo_ledger_id : ''
  if (!ledger) {
    ledger = await ctx.reserve(900)
    await ctx.assertActive?.()
    const saved = await admin.rpc('office_work_transition', { p_work_id: work.id, p_token: work.lease_token,
      p_patch: { phase: 'await_remote', checkpoint: { ...previous, demo_ledger_id: ledger } } })
    if (saved.error) throw saved.error
  } else {
    const found = await admin.from('office_budget_ledger').select('id,actual_cents,reserved_cents')
      .eq('id', ledger).eq('user_id', work.user_id).eq('agent_id', 'demo_builder').maybeSingle()
    if (found.error) throw found.error
    if (!found.data || found.data.reserved_cents !== 900) throw new Error('Riserva demo da riconciliare')
  }
  await ctx.assertActive?.()
  let response
  try { response = await bridge('/api/office/demo', { request_id: work.id, city, budget_usd: 9, theme_budget_usd: 2, google_budget_usd: 2 }) }
  catch (error) { throw new Error(`Riserva mantenuta: esito demo da verificare (${error instanceof Error ? error.message : 'bridge non disponibile'}).`) }
  if (!response || response.job_id !== `office-demo-${work.id}` || typeof response.done !== 'boolean') throw new Error('Ricevuta demo non valida: riconcilia prima di riprovare')
  if (!response.done) {
    const next = new Date(Date.now() + 120_000).toISOString()
    return { status: 'waiting', phase: 'await_remote', checkpoint: { ...previous, demo_ledger_id: ledger }, reason_code: 'demo_running',
      reason: `Demo di ${city} in preparazione.`, responsible: 'Demo e temi', required_action: 'Il lavoro controlla automaticamente il risultato.',
      next_check_at: next, available_at: next }
  }
  if (response.error || response.interrupted || !response.result) throw new Error(`Riserva mantenuta: demo interrotta (${String(response.error || 'esito da verificare')}).`)
  const result = response.result
  const costs = [result.google_usd, result.theme_usd, result.map_ai_usd]
  if (typeof result.slug !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,99}$/.test(result.slug) || officeIsNaples(result.slug) || result.city !== city
    || typeof result.complete !== 'boolean' || !Number.isSafeInteger(result.point_count) || result.point_count < 0 || result.point_count > 100000 || !Number.isSafeInteger(result.theme_count) || result.theme_count < 0 || result.theme_count > 7 || (result.complete && (result.point_count < 10 || result.theme_count !== 7))
    || costs.some((v) => typeof v !== 'number' || !Number.isFinite(v) || v < 0)) throw new Error('Ricevuta demo non valida: riconcilia prima di riprovare')
  const cents = Math.ceil(costs.reduce((a, b) => a + b, 0) * 100)
  await ctx.assertActive?.()
  const settled = await admin.rpc('settle_agent_budget', { p_ledger_id: ledger, p_actual_cents: cents, p_model: 'studiomap-demo' })
  if (settled.error) throw settled.error
  const complete = result.complete && cents <= 900
  return { status: complete ? 'succeeded' : 'blocked', phase: 'result_saved', result: { map_slug: result.slug, point_count: result.point_count, theme_count: result.theme_count },
    result_summary: `Demo di ${city}: ${result.point_count} luoghi e ${result.theme_count} temi. ${complete ? 'Pronta per la revisione.' : 'Contenuti o spesa da verificare.'}`,
    ...(!complete ? { reason_code: cents > 900 ? 'demo_cost_overrun' : 'demo_incomplete', reason: cents > 900 ? 'La spesa effettiva supera la riserva.' : 'La demo non ha completato tutti i contenuti.', required_action: 'Verifica il dettaglio in StudioMap.', responsible: 'Demo e temi', next_check_at: null } : {}) }
}
