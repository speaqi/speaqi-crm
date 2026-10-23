import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceRoleClient } from './supabase'
import { errorMessage } from './http'
import { estimateModelCost, modelCostCents, nonNegativeInteger, OFFICE_IMAGE_RESERVE_TOKENS } from '../office-pricing'
import type { OfficeAgent, OfficeOutputKind, OfficeRun, OfficeRunStatus } from '../office'

export class BudgetExceeded extends Error {
  constructor() { super('Budget esaurito: agente fermato'); this.name = 'BudgetExceeded' }
}
export type AgentOutputInput = {
  kind: OfficeOutputKind; title: string; body: Record<string, unknown>
  key?: string; target_table?: string; target_id?: string
}
export type Settlement = { tokensIn?: number; tokensOut?: number; model?: string; cachedTokens?: number }
/** Il contesto offre solo riserve, bozze e log. Nessun client con cui inviare o pubblicare. */
export type AgentContext = {
  agent: Readonly<OfficeAgent>; runId: string
  reserve(cents: number): Promise<string>
  settle(ledgerId: string, actualCents: number, usage?: Settlement): Promise<void>
  addOutput(output: AgentOutputInput): Promise<string>
  log(message: string): void
}
export type AgentHandler = (ctx: AgentContext) => Promise<{ summary: string } | void>
type Claim = { claimed: boolean; reason: string; run: OfficeRun }
export type OfficeStore = {
  agent(id: string, userId: string): Promise<OfficeAgent | null>
  claim(agentId: string, userId: string, key: string): Promise<Claim>
  reserve(agentId: string, runId: string, cents: number): Promise<string | null>
  settle(id: string, cents: number, usage: Settlement): Promise<void>
  output(runId: string, key: string, input: AgentOutputInput): Promise<string>
  finish(runId: string, status: OfficeRunStatus, summary: string, error: string | null, logs: string[]): Promise<OfficeRun>
}

export function createOfficeStore(admin: SupabaseClient): OfficeStore {
  async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await admin.rpc(name, args)
    if (error) throw error
    return data as T
  }
  return {
    async agent(id, userId) {
      const { data, error } = await admin.from('office_agents').select('*').eq('id', id).eq('user_id', userId).maybeSingle()
      if (error) throw error
      return data as OfficeAgent | null
    },
    claim: (id, userId, key) => rpc('claim_office_agent_run', { p_agent_id: id, p_user_id: userId, p_key: key }),
    reserve: (id, runId, cents) => rpc('reserve_agent_budget', { p_agent_id: id, p_cents: cents, p_run_id: runId }),
    async settle(id, cents, usage) {
      await rpc('settle_agent_budget', { p_ledger_id: id, p_actual_cents: cents, p_tokens_in: usage.tokensIn ?? null,
        p_tokens_out: usage.tokensOut ?? null, p_model: usage.model ?? null, p_tokens_cached: usage.cachedTokens ?? null })
    },
    output: (runId, key, input) => rpc('add_office_agent_output', { p_run_id: runId, p_key: key, p_kind: input.kind,
      p_title: input.title, p_body: input.body, p_target_table: input.target_table ?? null, p_target_id: input.target_id ?? null }),
    finish: (runId, status, summary, error, logs) => rpc('finish_office_agent_run', {
      p_run_id: runId, p_status: status, p_summary: summary, p_error: error, p_details: { logs },
    }),
  }
}

export async function runAgent(agentId: string, handler: AgentHandler, options: {
  userId: string; key?: string; store?: OfficeStore
}): Promise<{ run: OfficeRun | null; skipped?: string; error?: string }> {
  let store: OfficeStore | undefined
  let run: OfficeRun | null = null
  let items = 0
  const logs: string[] = []
  try {
    store = options.store || createOfficeStore(createServiceRoleClient())
    const agent = await store.agent(agentId, options.userId)
    if (!agent) return { run: null, error: 'Agente non trovato' }
    const claim = await store.claim(agentId, options.userId, options.key || randomUUID())
    if (!claim.claimed) return { run: claim.run, skipped: claim.reason }
    run = claim.run
    const reservations = new Set<string>()
    let outputSequence = 0
    const context: AgentContext = {
      agent: Object.freeze(agent), runId: run.id,
      async reserve(cents) {
        if (!nonNegativeInteger(cents)) throw new Error('Riserva non valida')
        const id = await store!.reserve(agentId, run!.id, cents)
        if (!id) throw new BudgetExceeded()
        reservations.add(id)
        return id
      },
      async settle(id, cents, usage = {}) {
        if (!reservations.has(id)) throw new Error('Riserva di un’altra corsa')
        if (!nonNegativeInteger(cents)) throw new Error('Costo non valido')
        await store!.settle(id, cents, usage)
      },
      async addOutput(input) {
        const id = await store!.output(run!.id, input.key || `uscita-${++outputSequence}`, input)
        items += 1
        return id
      },
      log(message) { if (logs.length < 100) logs.push(String(message).slice(0, 1000)) },
    }
    const result = await handler(context)
    run = await store.finish(run.id, 'done', result?.summary?.slice(0, 1000) || `Corsa conclusa: ${items} uscite preparate`, null, logs)
    return { run }
  } catch (error) {
    const message = errorMessage(error, 'Errore durante la corsa')
    const status = error instanceof BudgetExceeded ? (items > 0 ? 'partial' : 'skipped_budget') : 'failed'
    if (store && run) {
      try {
        run = await store.finish(run.id, status,
          status === 'partial' ? `Preparate ${items} uscite; budget esaurito` : message, message, logs)
      } catch (finishError) {
        return { run, error: `${message}. Registrazione dell’esito non riuscita: ${errorMessage(finishError, 'Database non disponibile')}` }
      }
    }
    return { run, error: message }
  }
}

/** Stessa API Responses e chiave gia' usate da ai-ready.ts, senza strumenti esterni. */
export async function callModel(ctx: AgentContext, options: { model: string; input: string; maxOutputTokens: number;
  jsonSchema?: { name: string; schema: Record<string, unknown> }
  /** Immagini come data URL (JPEG/PNG/WebP), gia' ridotte da chi chiama. */
  images?: string[] }) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY non configurata')
  const usdToEur = Number(process.env.OFFICE_USD_TO_EUR || '1')
  const images = options.images || []
  if (images.length > 4 || images.some((url) => !/^data:image\/(jpeg|png|webp);base64,/.test(url))) throw new Error('Immagini non valide per il modello')
  const estimate = estimateModelCost(options.model, options.input, options.maxOutputTokens, usdToEur, images.length * OFFICE_IMAGE_RESERVE_TOKENS)
  const ledgerId = await ctx.reserve(estimate.cents)
  // Su timeout, errore HTTP o token assenti, la riserva resta impegnata:
  // una risposta persa potrebbe essere gia' stata fatturata dal fornitore.
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST', signal: AbortSignal.timeout(120_000),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: options.model, max_output_tokens: options.maxOutputTokens, store: false,
      input: images.length ? [{ role: 'user', content: [{ type: 'input_text', text: options.input },
        ...images.map((url) => ({ type: 'input_image', image_url: url, detail: 'high' }))] }] : options.input,
      ...(options.jsonSchema ? { text: { format: { type:'json_schema',name:options.jsonSchema.name,strict:true,schema:options.jsonSchema.schema } } } : {}) }),
  })
  if (!response.ok) throw new Error(`OpenAI non disponibile (HTTP ${response.status}); riserva mantenuta`)
  const payload = await response.json()
  const usage = payload.usage
  if (!nonNegativeInteger(usage?.input_tokens) || !nonNegativeInteger(usage?.output_tokens)) {
    throw new Error('OpenAI non ha restituito i consumi; riserva mantenuta')
  }
  const cachedTokens = usage.input_tokens_details?.cached_tokens ?? 0
  const cost = modelCostCents(options.model, usage.input_tokens, usage.output_tokens, usdToEur, cachedTokens)
  await ctx.settle(ledgerId, cost, { tokensIn: usage.input_tokens, tokensOut: usage.output_tokens, model: options.model, cachedTokens })
  if (payload.status !== 'completed') throw new Error('Risposta del modello incompleta; costo registrato')
  const output = (Array.isArray(payload.output) ? payload.output : []).flatMap((item: { type?: string; content?: Array<{ type: string; text?: string }> }) =>
    item.type === 'message' ? (item.content || []).filter((part) => part.type === 'output_text').map((part) => part.text || '') : []).join('\n')
  return { text: output, costCents: cost, tokensIn: usage.input_tokens, tokensOut: usage.output_tokens }
}
