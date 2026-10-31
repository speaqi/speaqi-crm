import { randomUUID } from 'node:crypto'
import type { OfficeWorkItem, OfficeWorkSpec, WorkOutcome } from '../office-work'
import { DIRECTOR_ORDER_SCHEMA, directorFollowUp, directorOrderPrompt, interpretDirectorOrder, type DirectorOrderPlan } from '../office/director-orders'
import { officeRomeDay } from '../office/finance'
import { officeMapSlot } from '../office/maps'
import { officeIsNaples } from '../office/director'
import { cityForEntity, websiteFromText } from '../office/entity-activation'
import { callModel, createOfficeStore, officeModelKey, runAgent, type AgentContext, type AgentHandler } from './office-agents'
import { researchLocation, type ResearchLocation } from './office-agents/researcher'
import { ensureOfficeResearcher } from './office-agents/definitions'
import { nextOfficeBudgetCheck } from '../office-work'
import { DESTINATION_TYPES, ensureCatalogEntity, executePlan, findEntity, orderImages, pendingDirectorQuestion, type DirectorOrderRow } from './office-director-orders'
import { officeAgentHandler } from './office-agents/registry'
import { myMapsHandler } from './office-agents/mymaps'
import { mapsQualityHandler } from './office-agents/maps-quality'
import { languagesVoiceHandler, speaqiTranslationsApi } from './office-agents/languages-voice'
import { presentationEntities, presentationsHandler } from './office-agents/presentations'
import { verifyTourismWork, preparePresentationWork } from './office-work-tourism'

const checked = (value: any) => { if (value.error) throw value.error; return value.data }
class ResearchDeferred extends Error {
  constructor(readonly code: 'research_budget' | 'research_busy' | 'research_disabled', readonly next: string) { super(code) }
}
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

/**
 * Un ente già verificato, con prove proprie e una destinazione legata da una prova verificata,
 * non si verifica di nuovo: rileggere il sito costerebbe una ricerca e, con un sito che non
 * risponde, fermerebbe una presentazione che ha già tutto quello che serve.
 */
export async function verifiedPresentationSource(admin: any, userId: string, entityId: string) {
  let source: Awaited<ReturnType<typeof presentationEntities>>
  try { source = await presentationEntities(admin, userId, { entity_id: entityId }) } catch { return null }
  // Un'etichetta VERIFIED senza prove proprie non basta: allora si verifica come sempre.
  const proofs = checked(await admin.from('tourism_evidence').select('id').eq('user_id', userId)
    .eq('entity_id', entityId).eq('status', 'VERIFIED').limit(1)) || []
  return proofs.length ? source : null
}

const fold = (value: string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]+/g, ' ').trim()
/** «Venezuela», «Italia», «Spain»: il nome di un paese, non di un ente. */
export function isCountryName(target: string, countryCode: string | null) {
  if (!countryCode) return false
  const wanted = fold(target)
  return ['it', 'en', 'es', 'fr'].some((lang) => {
    try { return fold(new Intl.DisplayNames([lang], { type: 'region' }).of(countryCode) || '') === wanted } catch { return false }
  })
}

/** L'ente nazionale del turismo di un paese, se nel catalogo ce n'è uno solo. */
async function nationalTourismBody(admin: any, userId: string, countryCode: string) {
  const rows = checked(await admin.from('tourism_entities').select('id,name,kind,status,website,email,phone,country_code,type_code,aliases,disabled,version')
    .eq('user_id', userId).eq('kind', 'organization').eq('disabled', false).eq('country_code', countryCode)
    .in('type_code', ['nto', 'ministry']).not('status', 'in', '(INACTIVE,DUPLICATE)').limit(3)) || []
  return rows.length === 1 ? rows[0] : null
}

/** Il piano è validato contro l'ordine. Non viene eseguita una delega libera del modello. */
export async function interpretOrderWork(ctx: AgentContext, work: OfficeWorkItem, admin: any,
  deps: { model?: typeof callModel; now?: () => Date; research?: (target: string, website: string | null, country: string | null) => Promise<ResearchLocation | null> } = {}): Promise<WorkOutcome> {
  const order = checked(await admin.from('office_director_orders').select('*').eq('id', work.order_id || work.payload.order_id)
    .eq('user_id', work.user_id).single()) as DirectorOrderRow
  let text = typeof work.payload.text === 'string' ? work.payload.text : order.text
  const now = deps.now?.() || new Date()
  if (!work.checkpoint?.plan && !order.attachments?.length && order.created_at) {
    const pending = await pendingDirectorQuestion(admin, work.user_id, { source: order.source,
      chatId: order.telegram_chat_id, before: order.created_at, now })
    const resumedText = pending && directorFollowUp(pending.awaiting, text)
    if (resumedText) {
      const verification = pending.awaiting.need === 'site' && websiteFromText(text)
        ? checked(await admin.from('office_work_items').select('id,revision').eq('user_id', work.user_id)
          .eq('order_id', pending.id).eq('action', 'verify_tourism_entity').eq('status', 'blocked').maybeSingle()) : null
      const previous = verification || checked(await admin.from('office_work_items').select('id,revision').eq('user_id', work.user_id)
        .eq('order_id', pending.id).eq('action', 'interpret_order').eq('status', 'blocked').maybeSingle())
      if (previous) {
        const resumed = checked(await admin.rpc('office_work_owner_action', { p_user_id: work.user_id, p_work_id: previous.id,
          p_action: 'update_payload', p_patch: { expected_revision: previous.revision,
            payload: verification ? { website: websiteFromText(text) } : { text: resumedText } } }))
        if (!resumed?.work) return blockedWork('Il lavoro della domanda è cambiato.', 'Aggiorna il lavoro originale prima di riprendere.', 'Titolare', 'revision_conflict')
        checked(await admin.from('office_director_orders').update({ interpretation: { resumed_from: pending.id, resumed_work_id: previous.id } })
          .eq('id', order.id).eq('user_id', work.user_id))
        return { status: 'succeeded', phase: 'result_saved', close_plan: true,
          result: { resumed_order_id: pending.id, resumed_work_id: previous.id },
          result_summary: 'Risposta collegata al lavoro originale: il Direttore riprende da lì.' }
      }
      // Nessun lavoro da correggere (per esempio «lascia perdere il sito, fammi la presentazione»):
      // la richiesta completa si lavora qui, e i lavori fermi dell'ordine di prima si chiudono.
      text = resumedText
      const stale = checked(await admin.from('office_work_items').select('id').eq('user_id', work.user_id)
        .eq('order_id', pending.id).in('status', ['blocked', 'waiting'])) || []
      for (const item of stale) {
        await admin.rpc('office_work_owner_action', { p_user_id: work.user_id, p_work_id: item.id, p_action: 'cancel', p_patch: {} })
      }
      checked(await admin.from('office_director_orders').update({ interpretation: { resumed_from: pending.id } })
        .eq('id', order.id).eq('user_id', work.user_id))
    }
  }
  const currentOrder = { ...order, text }
  let plan: DirectorOrderPlan
  let rawPlan: Record<string, unknown> | null = work.checkpoint?.raw_plan && typeof work.checkpoint.raw_plan === 'object'
    ? work.checkpoint.raw_plan as Record<string, unknown> : null
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
    rawPlan = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
    plan = interpretDirectorOrder(parsed, { text, today: officeRomeDay(now), images: images.length })
    await checkpoint(admin, work, { phase: 'planned', checkpoint: { plan, raw_plan: rawPlan, payload_version: work.payload_version } })
  }
  const state: Record<string, any> = { ...work.checkpoint, plan, raw_plan: rawPlan, payload_version: work.payload_version }
  const researchFor = async (target: string, website: string | null, country: string | null, index: number) => {
    const key = `${index}:${target}`
    const saved = state.research_results && typeof state.research_results === 'object' ? state.research_results as Record<string, ResearchLocation | null> : {}
    if (Object.hasOwn(saved, key)) return saved[key]
    if (!deps.research) await ensureOfficeResearcher(admin, work.user_id)
    await checkpoint(admin, work, { phase: 'effect_started', checkpoint: state })
    let result: ResearchLocation | null = null
    if (deps.research) result = await deps.research(target, website, country)
    else {
      const run = await runAgent('office_researcher', async (researchCtx) => {
        result = await researchLocation(researchCtx, { target, website, country })
        // Salvare il risultato prima di chiudere la corsa permette di riprendere senza ripagare.
        state.research_results = { ...saved, [key]: result }
        await checkpoint(admin, work, { phase: 'planned', checkpoint: state })
        return { summary: result ? `Fonti trovate per ${target}.` : `Nessuna prova sufficiente per ${target}.` }
      }, { userId: work.user_id, key: `work:${work.id}:research:${index}:v${work.payload_version}:attempt:${work.attempt_count}`,
        store: createOfficeStore(admin), assertActive: ctx.assertActive })
      if (run.skipped === 'disabled') throw new ResearchDeferred('research_disabled', new Date(now.getTime() + 60_000).toISOString())
      if (run.skipped === 'running') throw new ResearchDeferred('research_busy', new Date(now.getTime() + 60_000).toISOString())
      if (run.run?.status === 'skipped_budget') {
        const ledger = checked(await admin.from('office_budget_ledger').select('actual_cents,reserved_cents')
          .eq('user_id', work.user_id).eq('run_id', run.run.id)) || []
        if (ledger.some((entry: any) => entry.actual_cents === null || Number(entry.actual_cents) > 0)) {
          throw new Error('Ricerca parziale con spesa registrata: riconcilia prima di riprovare')
        }
        const agent = checked(await admin.from('office_agents').select('weekly_budget_cents,monthly_budget_cents')
          .eq('user_id', work.user_id).eq('id', 'office_researcher').maybeSingle())
        const summary = checked(await admin.rpc('office_budget_summary', { p_user_id: work.user_id })) || []
        const spent = summary.find((entry: any) => entry.agent_id === 'office_researcher')
        const periods: Array<'day' | 'week' | 'month'> = ['day']
        if (agent && spent && spent.week_actual + spent.week_reserved >= agent.weekly_budget_cents) periods.push('week')
        if (agent && spent && spent.month_actual + spent.month_reserved >= agent.monthly_budget_cents) periods.push('month')
        throw new ResearchDeferred('research_budget', periods.map((period) => nextOfficeBudgetCheck(now, period)).sort().at(-1)!)
      }
      if (run.skipped || run.error || !run.run) {
        throw new Error(run.error || run.run?.error || 'Ricerca da riconciliare prima di riprovare')
      }
    }
    state.research_results = { ...saved, [key]: result }
    await checkpoint(admin, work, { phase: 'planned', checkpoint: state })
    return result
  }
  const researchOrWait = async (target: string, website: string | null, country: string | null, index: number) => {
    try { return { result: await researchFor(target, website, country, index) } }
    catch (error) {
      if (!(error instanceof ResearchDeferred)) throw error
      return { outcome: { status: 'waiting', phase: 'planned', checkpoint: state, reason_code: error.code,
        reason: error.code === 'research_budget' ? 'Il Ricercatore attende il rinnovo del budget.'
          : error.code === 'research_disabled' ? 'Il Ricercatore è spento.' : 'Il Ricercatore sta completando un altro incarico.',
        required_action: error.code === 'research_disabled' ? 'Riaccendi il Ricercatore per riprendere.' : 'Il lavoro riprende automaticamente.', responsible: 'Ricercatore', available_at: error.next,
        next_check_at: error.next } as WorkOutcome }
    }
  }
  if (plan.intent === 'unknown' && plan.awaiting?.need === 'country' && rawPlan?.intent === 'add_entity'
    && typeof rawPlan.target === 'string' && rawPlan.target.trim()) {
    const found = await researchOrWait(rawPlan.target.trim(), websiteFromText(text), null, 0)
    if (found.outcome) return found.outcome
    if (found.result?.country_code) {
      plan = interpretDirectorOrder({ ...rawPlan, country_code: found.result.country_code }, { text, today: officeRomeDay(now), images: 0 })
      state.plan = plan
      await checkpoint(admin, work, { phase: 'planned', checkpoint: state })
    }
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
  // In inglese la presentazione è un deck a parte, fatto dal Direttore stesso (`englishPresentation`, via `executePlan`):
  // non passa dal compito dell'agente Presentazioni, che ha un solo lavoro per ente.
  if (plan.intent === 'presentation' && plan.audience !== 'partner' && plan.language !== 'en') {
    let targets = plan.targets
    if (!targets.length && plan.count) {
      const decks = checked(await admin.from('tourism_decks').select('entity_id').eq('user_id', work.user_id)) || []
      const done = new Set(decks.map((deck: any) => deck.entity_id))
      const candidates = checked(await admin.from('tourism_entities').select('id,name,website,aliases,type_code,status,outreach_priority')
        .eq('user_id', work.user_id).eq('kind', 'organization').eq('disabled', false)
        .in('type_code', DESTINATION_TYPES)
        .in('status', ['VERIFIED', 'UNVERIFIED', 'NEEDS_REVIEW'])
        .order('outreach_priority', { ascending: true }).limit(200)) || []
      targets = candidates.filter((entity: any) => !done.has(entity.id) && entity.website && !officeIsNaples(entity.name)
        && cityForEntity({ proposed: null, entityName: entity.name, aliases: entity.aliases, orderText: '' }))
        .slice(0, plan.count).map((entity: any) => entity.name)
      if (!targets.length) return blockedWork('Non trovo destinazioni con fonte e città da proporre.', 'Indica un ente e la destinazione nello stesso lavoro.', 'Titolare', 'entity_missing')
    }
    for (const [index, target] of targets.entries()) {
      let entity = await findEntity(admin, work.user_id, [target])
      let research: ResearchLocation | null = null
      // «Presentazione per Venezuela»: il paese non è un ente da creare. Vale l'ente nazionale
      // del turismo se ce n'è uno solo, altrimenti si chiede quale.
      if (!entity && isCountryName(target, plan.country_code)) {
        entity = await nationalTourismBody(admin, work.user_id, plan.country_code!)
        if (!entity) {
          checked(await admin.from('office_director_orders').update({ interpretation: { ...plan,
            awaiting: { need: 'target', resume: 'presentazione per {}' } } }).eq('id', order.id).eq('user_id', work.user_id))
          return blockedWork(`«${target}» è un paese: per quale ente del turismo preparo la presentazione?`,
            'Rispondi con il nome dell’ente.', 'Titolare', 'needs_information')
        }
      }
      if (!entity && !plan.country_code) {
        const found = await researchOrWait(target, null, null, index)
        if (found.outcome) return found.outcome
        research = found.result || null
      }
      const countryCode = plan.country_code || research?.country_code || null
      // Una città non è automaticamente il nome di un'organizzazione del turismo.
      if (!entity && countryCode && !(plan.city && fold(target) === fold(plan.city))) {
        await checkpoint(admin, work, { phase: 'effect_started' })
        const found = await ensureCatalogEntity(admin, work.user_id, order.id, { name: target,
          country_code: countryCode, type_code: plan.type_code || 'dmo', website: research?.website || null })
        if ('entity' in found) entity = { ...found.entity, kind: 'organization' }
        await checkpoint(admin, work, { phase: 'planned' })
      }
      if (!entity) {
        if (countryCode && plan.city && fold(target) === fold(plan.city)) {
          checked(await admin.from('office_director_orders').update({ interpretation: { ...plan,
            awaiting: { need: 'target', resume: 'presentazione per {}' } } }).eq('id', order.id).eq('user_id', work.user_id))
          return blockedWork(`Ho trovato il paese di «${target}», ma non un ente del turismo univoco.`,
            'Indica quale ente deve ricevere la presentazione.', 'Titolare', 'entity_missing')
        }
        checked(await admin.from('office_director_orders').update({ interpretation: { ...plan,
          awaiting: { need: 'country', resume: `presentazione per ${target}${plan.city ? `, ${plan.city}` : ''}` } } })
          .eq('id', order.id).eq('user_id', work.user_id))
        return blockedWork(`Non trovo un ente univoco per «${target}» nel catalogo Tourism. Specifica il paese per aggiungerlo.`, 'Rispondi con il paese oppure indica l’ente del catalogo nello stesso lavoro.', 'Titolare', 'entity_missing')
      }
      // Un ente già verificato con la sua destinazione non ha bisogno di una città dal titolare:
      // vale il nome della destinazione legata. La città si chiede solo quando c'è da verificare.
      const ready = await verifiedPresentationSource(admin, work.user_id, entity.id)
      let city = ready?.destination.name || (typeof work.payload.city === 'string' ? work.payload.city : cityForEntity({ proposed: plan.city || null,
        entityName: entity.name, orderText: text }))
      if (!city) {
        if (!research) {
          const found = await researchOrWait(target, entity.website || null, entity.country_code || null, index)
          if (found.outcome) return found.outcome
          research = found.result || null
        }
        city = research && (!research.country_code || research.country_code === entity.country_code) ? research.city : null
      }
      if (!city) {
        checked(await admin.from('office_director_orders').update({ interpretation: { ...plan,
          awaiting: { need: 'city', resume: `presentazione per ${target}` } } }).eq('id', order.id).eq('user_id', work.user_id))
        return blockedWork('Per quale città preparo la presentazione?', 'Rispondi con la città oppure completa il testo dello stesso lavoro.', 'Titolare', 'needs_information')
      }
      if (officeIsNaples(entity.name, city)) return blockedWork('Napoli è esclusa dal lavoro degli agenti.', 'Scegli una destinazione diversa nello stesso incarico.', 'Titolare', 'protected_destination')
      const photos = targets.length === 1 ? { photos: (order.attachments || []).map((item) => item.path) } : {}
      if (ready) {
        children.push(child('presentations', 'prepare_presentation', { entity_id: entity.id, city: ready.destination.name || city,
          destination_id: ready.destination.id, ...photos }, `presentation:${index}`))
        continue
      }
      // Anche un'etichetta VERIFIED priva di prove non aggira la verifica puntuale.
      const verifyId = randomUUID()
      const verify: OfficeWorkSpec = { ...child('entity_enricher', 'verify_tourism_entity', {
        entity_id: entity.id, city, website: websiteFromText(text) || entity.website || research?.website || null, order_text: text,
        ...(research ? { research_sources: research.sources } : {}),
      }, `verify:${index}`), id: verifyId }
      const presentation: OfficeWorkSpec = { ...child('presentations', 'prepare_presentation', { entity_id: entity.id, city,
        ...photos }, `presentation:${index}`),
        status: 'waiting', depends_on: [verifyId] }
      children.push(verify, presentation)
    }
  }
  if (children.length) return { status: 'succeeded', phase: 'result_saved', close_plan: true, children,
    result: { intent: plan.intent, assigned: children.map((item) => ({ agent: item.agent_id, action: item.action })) },
    result_summary: 'Ordine compreso. I lavori sono registrati e verranno seguiti fino al risultato.' }

  // Riutilizza risposte deterministiche, To Do idempotenti e proposta contatto, senza vecchi avvii.
  await checkpoint(admin, work, { phase: 'effect_started' })
  const outcome = await executePlan(admin, ctx, currentOrder, plan, now)
  if (outcome.status === 'waiting_you' && !outcome.outputs.length) {
    if (outcome.awaiting) checked(await admin.from('office_director_orders').update({ interpretation: { ...plan, awaiting: outcome.awaiting } })
      .eq('id', order.id).eq('user_id', work.user_id))
    return { ...blockedWork(outcome.reply, 'Rispondi alla domanda del Direttore oppure completa il testo dello stesso lavoro.', 'Titolare', 'needs_information'), phase: 'result_saved' }
  }
  if (outcome.status === 'waiting_you') return { status: 'waiting_owner', phase: 'result_saved', close_plan: true,
    output_ids: outcome.outputs, approval_output_id: outcome.outputs[0] || null, result_summary: outcome.reply,
    reason: outcome.reply, reason_code: 'approval_required', required_action: 'Leggi e decidi la proposta collegata.', responsible: 'Titolare', next_check_at: null }
  if (outcome.status === 'failed') return blockedWork(outcome.reply, 'Completa i dati di questo lavoro.', 'Titolare')
  return { status: 'succeeded', phase: 'result_saved', close_plan: true, output_ids: outcome.outputs,
    result: { ...outcome.result, intent: plan.intent, reply: outcome.reply }, result_summary: outcome.reply }
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
