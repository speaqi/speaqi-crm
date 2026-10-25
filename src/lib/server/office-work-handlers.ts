import { randomUUID } from 'node:crypto'
import type { OfficeWorkItem, OfficeWorkSpec, WorkOutcome } from '../office-work'
import { DIRECTOR_ORDER_SCHEMA, directorOrderPrompt, interpretDirectorOrder, type DirectorOrderPlan } from '../office/director-orders'
import { officeRomeDay } from '../office/finance'
import { officeMapSlot } from '../office/maps'
import { officeIsNaples } from '../office/director'
import { cityForEntity, websiteFromText } from '../office/entity-activation'
import { callModel, officeModelKey, type AgentContext, type AgentHandler } from './office-agents'
import { executePlan, findEntity, orderImages, type DirectorOrderRow } from './office-director-orders'
import { officeAgentHandler } from './office-agents/registry'
import { myMapsHandler } from './office-agents/mymaps'
import { mapsQualityHandler } from './office-agents/maps-quality'
import { languagesVoiceHandler, speaqiTranslationsApi } from './office-agents/languages-voice'
import { presentationsHandler } from './office-agents/presentations'
import { verifyTourismWork, preparePresentationWork } from './office-work-tourism'

const checked = (value: any) => { if (value.error) throw value.error; return value.data }
export function blockedWork(reason: string, requiredAction: string, responsible = 'Direttore', reasonCode = 'missing_data'): WorkOutcome {
  return { status: 'blocked', reason_code: reasonCode, reason, required_action: requiredAction, responsible, next_check_at: null, result_summary: reason }
}

async function checkpoint(admin: any, work: OfficeWorkItem, patch: Record<string, unknown>) {
  checked(await admin.rpc('office_work_transition', { p_work_id: work.id, p_token: work.lease_token,
    p_patch: { status: 'running', ...patch } }))
}

/** Le proposte del piano attendono una decisione, senza deleghe libere. */
export function planProposalWorks(work: OfficeWorkItem, outputs: Array<{ id: string; kind: string; status: string; body: any; target_id?: string }>): OfficeWorkSpec[] {
  return outputs.flatMap((output) => {
    if (output.kind !== 'proposal' || output.status !== 'pending') return []
    const body = output.body || {}
    const binding = body.action === 'build_map' ? { agent_id: 'mymaps_builder', action: 'import_mymaps' }
      : body.action === 'publication_review' ? { agent_id: 'maps_quality', action: 'check_map' }
        : body.action === 'complete_languages' ? { agent_id: 'languages_voice', action: 'complete_languages' } : null
    if (!binding || binding.agent_id !== body.recipient_agent_id) return []
    return [{ ...binding, origin: 'director_plan' as const, source_key: `plan:${output.id}`, deal_id: work.deal_id,
      source_output_id: output.id, approval_output_id: output.id, status: 'waiting_owner' as const,
      payload: body.action === 'complete_languages' ? { map_id: output.target_id, city: body.city, map_slug: body.map_slug }
        : { city: body.city, ...(body.map_slug ? { map_slug: body.map_slug } : {}) },
      reason_code: 'approval_required', reason: 'Il piano propone questo incarico: aspetta la decisione del titolare.',
      required_action: 'Leggi le fonti e decidi la proposta collegata.', responsible: 'Titolare' }]
  })
}

/** Il piano è validato contro l'ordine. Non viene eseguita una delega libera del modello. */
export async function interpretOrderWork(ctx: AgentContext, work: OfficeWorkItem, admin: any,
  deps: { model?: typeof callModel; now?: () => Date } = {}): Promise<WorkOutcome> {
  const order = checked(await admin.from('office_director_orders').select('*').eq('id', work.order_id || work.payload.order_id)
    .eq('user_id', work.user_id).single()) as DirectorOrderRow
  const text = typeof work.payload.text === 'string' ? work.payload.text : order.text
  const currentOrder = { ...order, text }
  const now = deps.now?.() || new Date()
  let plan: DirectorOrderPlan
  const saved = work.checkpoint?.payload_version === work.payload_version ? work.checkpoint?.plan : null
  if (saved) plan = saved as DirectorOrderPlan
  else {
    if (!deps.model && !officeModelKey()) return { ...blockedWork('La chiave del servizio di interpretazione non è configurata.',
      'Configura il servizio e riprendi questo lavoro.', 'Titolare', 'configuration'), phase: 'ready' }
    const images = await orderImages(admin, order)
    await checkpoint(admin, work, { phase: 'effect_started' })
    const response = await (deps.model || callModel)(ctx, { model: typeof ctx.agent.settings.model === 'string' ? ctx.agent.settings.model : ctx.agent.model,
      input: directorOrderPrompt(text, images.length, officeRomeDay(now)), images, maxOutputTokens: 1500,
      jsonSchema: { name: 'director_order', schema: DIRECTOR_ORDER_SCHEMA as unknown as Record<string, unknown> } })
    let parsed: unknown
    try { parsed = JSON.parse(response.text) } catch { return { ...blockedWork('Non ho capito l’ordine: la risposta non era leggibile.', 'Correggi o completa il testo di questo lavoro; non serve un nuovo ordine.', 'Titolare', 'needs_information'), phase: 'result_saved' } }
    plan = interpretDirectorOrder(parsed, { text, today: officeRomeDay(now), images: images.length })
    await checkpoint(admin, work, { phase: 'planned', checkpoint: { plan, payload_version: work.payload_version } })
  }
  await ctx.assertActive?.()
  checked(await admin.from('office_director_orders').update({ intent: plan.intent, interpretation: plan }).eq('id', order.id).eq('user_id', work.user_id))
  if (plan.intent === 'unknown') return blockedWork(plan.question, 'Completa i dati o il testo nella scheda Lavori dello stesso ordine.', 'Titolare', 'needs_information')

  const child = (agent_id: string, action: string, payload: Record<string, unknown>, suffix: string): OfficeWorkSpec => ({
    agent_id, action, origin: 'order', order_id: order.id, deal_id: work.deal_id,
    source_key: `order:${order.id}:${suffix}:v${work.payload_version}`, payload, priority: work.priority, status: 'ready',
  })
  let children: OfficeWorkSpec[] = []
  if (plan.intent === 'build_map') children = [child('mymaps_builder', 'import_mymaps', { slug: plan.slug, city: plan.city, source: plan.source }, 'map')]
  if (plan.intent === 'check_map') children = [child('maps_quality', 'check_map', { slug: plan.slug, city: plan.city }, 'quality')]
  if (plan.intent === 'presentation') {
    const entity = await findEntity(admin, work.user_id, [plan.target])
    if (!entity) return blockedWork(`Non trovo un ente univoco per «${plan.target}» nel catalogo Tourism.`, 'Indica l’ente del catalogo o collega il contatto all’ente, poi riprendi questo lavoro.', 'Titolare', 'entity_missing')
    const city = typeof work.payload.city === 'string' ? work.payload.city : cityForEntity({ proposed: plan.city || null,
      entityName: entity.name, orderText: text })
    if (officeIsNaples(entity.name, city)) return blockedWork('Napoli è esclusa dal lavoro degli agenti.', 'Scegli una destinazione diversa nello stesso incarico.', 'Titolare', 'protected_destination')
    // Anche un'etichetta VERIFIED priva di prove non aggira la verifica puntuale.
    const verifyId = randomUUID()
    const verify: OfficeWorkSpec = { ...child('entity_enricher', 'verify_tourism_entity', {
      entity_id: entity.id, city, website: websiteFromText(text) || entity.website || null, order_text: text,
    }, 'verify'), id: verifyId }
    const presentation: OfficeWorkSpec = { ...child('presentations', 'prepare_presentation', { entity_id: entity.id, city }, 'presentation'),
      status: 'waiting', depends_on: [verifyId] }
    children = [verify, presentation]
  }
  if (children.length) return { status: 'succeeded', phase: 'result_saved', close_plan: true, children,
    result: { intent: plan.intent, assigned: children.map((item) => ({ agent: item.agent_id, action: item.action })) },
    result_summary: 'Ordine compreso. I lavori sono registrati e verranno seguiti fino al risultato.' }

  // Riutilizza risposte deterministiche, To Do idempotenti e proposta contatto, senza vecchi avvii.
  const outcome = await executePlan(admin, ctx, currentOrder, plan, now)
  if (outcome.status === 'waiting_you') return { status: 'waiting_owner', phase: 'result_saved', close_plan: true,
    output_ids: outcome.outputs, approval_output_id: outcome.outputs[0] || null, result_summary: outcome.reply,
    reason: outcome.reply, reason_code: 'approval_required', required_action: 'Leggi e decidi la proposta collegata.', responsible: 'Titolare', next_check_at: null }
  if (outcome.status === 'failed') return blockedWork(outcome.reply, 'Completa i dati di questo lavoro.', 'Titolare')
  return { status: 'succeeded', phase: 'result_saved', close_plan: true, output_ids: outcome.outputs,
    result: { intent: plan.intent, reply: outcome.reply }, result_summary: outcome.reply }
}

/** Dispatch chiuso; gli handler ricevono il solo incarico, mai tutta la coda di lavoro. */
export async function executeOfficeWork(ctx: AgentContext, work: OfficeWorkItem, admin: any,
  deps: { handler?: AgentHandler } = {}): Promise<WorkOutcome> {
  if (work.action === 'interpret_order') return interpretOrderWork(ctx, work, admin)
  if (work.action === 'verify_tourism_entity') return verifyTourismWork(ctx, work, admin)
  if (work.action === 'prepare_presentation') return preparePresentationWork(ctx, work, admin)
  if (work.action === 'agent_run' && ['mymaps_builder', 'maps_quality', 'presentations'].includes(work.agent_id)) {
    const imported = checked(await admin.rpc('office_work_import_queue', { p_user_id: work.user_id }))
    // Gli incarichi espliciti sono consumati soltanto dal registro. Restano i
    // controlli periodici dell'inventario e le bozze di deck già approvati.
    if (work.agent_id === 'mymaps_builder') return { status: 'succeeded', phase: 'result_saved', result: { queue_import: imported || {} },
      result_summary: 'Code controllate: gli incarichi sono seguiti nel registro Lavori.' }
  }
  if (['complete_languages', 'refresh_outdated'].includes(work.action)) {
    const api = speaqiTranslationsApi()
    const mapId = String(work.payload.map_id || work.payload.target_id || '')
    if (!api || !mapId) return blockedWork('Mancano API Speaqi o identificativo della mappa.', 'Completa la configurazione o collega la mappa a questo incarico.', 'Titolare', 'configuration')
    const identity = await api.status(mapId)
    if (officeIsNaples(identity.name, identity.slug, identity.studiomap_slug)) return blockedWork('Napoli è esclusa dal lavoro degli agenti.', 'Scegli un’altra destinazione.', 'Titolare', 'protected_destination')
    const progress = await api.translations(mapId)
    if (!progress.target_languages?.length) return blockedWork('Nessuna lingua di destinazione è configurata.', 'Scegli le lingue della mappa su Speaqi e riprendi lo stesso lavoro.', 'Titolare', 'languages_missing')
    const pending = [progress.summary.text, progress.summary.audio].some((counts) => counts.missing + counts.failed + counts.stuck + counts.processing + counts.outdated > 0)
    if (!pending) return { status: 'succeeded', phase: 'result_saved', result: { map_id: mapId, summary: progress.summary }, result_summary: 'Testi e audio risultano completi nelle lingue configurate.' }
  }
  if (!deps.handler && (['import_mymaps', 'check_map'].includes(work.action)
    || (work.action === 'agent_run' && work.agent_id === 'maps_quality'))) {
    if (!process.env.OFFICE_BRIDGE_SECRET || process.env.OFFICE_BRIDGE_SECRET.length < 32) {
      return { ...blockedWork('Il collegamento a StudioMap non è configurato.', 'Configura il segreto del bridge e riprendi questo lavoro.', 'Titolare', 'configuration'), phase: 'ready' }
    }
    try {
      const origin = new URL(process.env.OFFICE_STUDIOMAP_URL || 'https://studiomap.speaqi.com')
      if (origin.protocol !== 'https:' || origin.username || origin.password) throw new Error('origine')
    } catch { return { ...blockedWork('L’indirizzo del bridge StudioMap non è valido.', 'Configura un’origine HTTPS valida e riprendi il lavoro.', 'Titolare', 'configuration'), phase: 'ready' } }
  }
  let handler = deps.handler || (work.action === 'import_mymaps' ? myMapsHandler(admin)
    : work.action === 'check_map' ? mapsQualityHandler(admin)
    : ['complete_languages', 'refresh_outdated'].includes(work.action) ? languagesVoiceHandler(admin)
    : work.action === 'agent_run' && work.agent_id === 'maps_quality' ? mapsQualityHandler(admin)
    : work.action === 'agent_run' && work.agent_id === 'presentations' ? presentationsHandler(admin)
    : work.action === 'agent_run' ? officeAgentHandler(work.agent_id) : null)
  if (!handler) return blockedWork('Questo incarico non ha un esecutore installato.', 'Controlla il registro delle azioni prima di riprenderlo.', 'Direttore', 'action_unavailable')
  const monitorQueue = work.agent_id === 'languages_voice' && Array.isArray(ctx.agent.settings.queue)
    ? ctx.agent.settings.queue.filter((entry: any) => !entry || typeof entry !== 'object'
      || (!Object.hasOwn(entry, 'source_output_id') && entry.origin !== 'director_order')) : ctx.agent.settings.queue
  const monitor = work.action === 'agent_run' && ['maps_quality', 'presentations', 'languages_voice'].includes(work.agent_id)
  const scoped: AgentContext = monitor ? { ...ctx, agent: Object.freeze({ ...ctx.agent,
    settings: { ...ctx.agent.settings, queue: work.agent_id === 'languages_voice' ? monitorQueue : [] } }) }
    : work.action === 'agent_run' ? ctx : { ...ctx,
    agent: Object.freeze({ ...ctx.agent, settings: { ...ctx.agent.settings, queue: [{ ...work.payload,
      ...(work.action === 'import_mymaps' ? { key: `work:${work.id}:v${work.payload_version}` } : {}) }] } }) }
  await checkpoint(admin, work, { phase: 'effect_started' })
  const answer = await handler(scoped)
  let outputs = checked(await admin.from('office_agent_outputs').select('id,kind,body,target_id,status').eq('user_id', work.user_id).eq('run_id', ctx.runId)) || []
  if (work.action === 'import_mymaps' && !outputs.length) {
    // Una ricevuta dello stesso turno può essere stata salvata prima dell'interruzione.
    outputs = checked(await admin.from('office_agent_outputs').select('id,kind,body,target_id,status')
      .eq('user_id', work.user_id).eq('agent_id', work.agent_id)
      .eq('output_key', `mymaps:${officeMapSlot(new Date())}:work:${work.id}:v${work.payload_version}`).limit(1)) || []
  }
  if (work.action === 'import_mymaps' && !outputs.some((o: any) => o.body?.cost_cents === 0 && typeof o.body?.created === 'number')) {
    return blockedWork('L’import non ha ancora prodotto una ricevuta verificabile per questa mappa.', 'Attendi il prossimo turno o controlla la ricevuta StudioMap prima di riprovare.', 'Costruttore My Maps', 'receipt_missing')
  }
  if (work.action === 'check_map' && !outputs.some((o: any) => o.kind === 'report')) return blockedWork('Il controllo non ha prodotto un rapporto collegato.', 'Controlla il rapporto già esistente e collega il risultato.', 'Controllo qualità mappe', 'receipt_missing')
  if (['complete_languages', 'refresh_outdated'].includes(work.action)) {
    const approval = outputs.find((o: any) => o.kind === 'proposal' && o.status === 'pending')
    if (approval) return { status: 'waiting_owner', phase: 'result_saved', approval_output_id: approval.id, output_ids: outputs.map((o: any) => o.id),
      reason_code: 'outdated_approval', reason: 'Le traduzioni obsolete richiedono una decisione.', required_action: 'Approva o rifiuta la proposta collegata.', responsible: 'Titolare', next_check_at: null }
    const next = new Date(Date.now() + 10 * 60_000).toISOString()
    return { status: 'waiting', phase: 'await_remote', checkpoint: { map_id: work.payload.map_id || work.payload.target_id },
      output_ids: outputs.map((o: any) => o.id), available_at: next, next_check_at: next, reason_code: 'remote_processing',
      reason: 'Il completamento di testi e audio viene verificato su Speaqi.', required_action: 'Attendi il controllo del risultato remoto.', responsible: 'Lingue e voce' }
  }
  if (outputs.some((o: any) => o.body?.sources_checked === 0 || o.body?.feeds_checked === 0)) return { ...blockedWork('Il compito non ha fonti configurate da leggere.', 'Aggiungi le fonti nelle impostazioni dell’agente e riprendi questo lavoro.', 'Titolare', 'sources_missing'), phase: 'result_saved' }
  if (!outputs.length && !answer?.summary) return blockedWork('Il compito è terminato senza un risultato registrato.', 'Controlla la corsa e collega il risultato prima di chiudere il lavoro.', work.agent_id, 'receipt_missing')
  return { status: 'succeeded', phase: 'result_saved', output_ids: outputs.map((o: any) => o.id),
    ...(work.action === 'agent_run' && work.agent_id === 'director' ? { children: planProposalWorks(work, outputs) } : {}),
    result: { output_ids: outputs.map((o: any) => o.id) }, result_summary: answer?.summary || 'Compito concluso con esito registrato.' }
}
