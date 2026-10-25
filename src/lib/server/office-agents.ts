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

export const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions'

/** Stati con cui OpenRouter respinge una richiesta senza farla generare, e quindi senza addebito:
 * chiave, credito finito (402), moderazione, modello, richiesta troppo grande, limiti. */
const OPENROUTER_REFUSED = new Set([400, 401, 402, 403, 404, 413, 422, 429])

/** Chiave dell'Ufficio: `OPENROUTER_API_KEY_OFFICE` se c'e' (su OpenRouter si leggono
 * i suoi consumi da soli), altrimenti quella generale, come per le traduzioni di Speaqi. */
export function officeModelKey(): string | undefined {
  return process.env.OPENROUTER_API_KEY_OFFICE?.trim() || process.env.OPENROUTER_API_KEY?.trim() || undefined
}

/** `gpt-5-mini` → `openai/gpt-5-mini`; un id con `/` resta com'e'. */
export function toOpenRouterModel(model: string): string {
  const trimmed = model.trim()
  return trimmed.includes('/') ? trimmed : `openai/${trimmed.replace(/-\d{4}-\d{2}-\d{2}$/, '')}`
}

/** Credito OpenRouter (dollari) in centesimi EUR arrotondati per eccesso, a interi come il listino. */
export function creditCostCents(credits: number, usdToEur = 1): number | null {
  if (typeof credits !== 'number' || !Number.isFinite(credits) || credits < 0 || credits > 1000) return null
  // Stessa verifica del cambio del listino: un valore storto non diventa uno sconto.
  modelCostCents('gpt-5-mini', 0, 0, usdToEur)
  const usdMicros = BigInt(Math.ceil(credits * 1_000_000 - 1e-6))
  const rate = BigInt(Math.round(usdToEur * 1_000_000))
  // microdollari × cambio in milionesimi × 100 / 10^12 = centesimi EUR
  const denominator = BigInt('1000000000000')
  return Number((usdMicros * rate * BigInt(100) + denominator - BigInt(1)) / denominator)
}

/** Una chiamata di solo testo (piu' eventuali immagini) via OpenRouter, senza strumenti esterni.
 * Si prenota dal listino prima di spendere; si salda col costo che OpenRouter dichiara. */
/** Token d'ingresso prenotati per ogni risultato della ricerca web e costo della ricerca (Exa 0,007 $) arrotondato su. */
export const WEB_RESULT_RESERVE_TOKENS = 1500
export const WEB_SEARCH_RESERVE_CENTS = 2

export async function callModel(ctx: AgentContext, options: { model: string; input: string; maxOutputTokens: number;
  jsonSchema?: { name: string; schema: Record<string, unknown> }
  /** Immagini come data URL (JPEG/PNG/WebP), gia' ridotte da chi chiama. */
  images?: string[]
  /** Ricerca web di OpenRouter (Exa, 0,007 $ a ricerca più i token dei risultati): niente schema JSON insieme. */
  webSearch?: { maxResults?: number } }) {
  const apiKey = officeModelKey()
  if (!apiKey) throw new Error('OPENROUTER_API_KEY non configurata nelle variabili del CRM')
  const usdToEur = Number(process.env.OFFICE_USD_TO_EUR || '1')
  const images = options.images || []
  if (images.length > 4 || images.some((url) => !/^data:image\/(jpeg|png|webp);base64,/.test(url))) throw new Error('Immagini non valide per il modello')
  const webResults = options.webSearch ? Math.min(10, Math.max(1, options.webSearch.maxResults || 5)) : 0
  const estimate = estimateModelCost(options.model, options.input, options.maxOutputTokens, usdToEur,
    images.length * OFFICE_IMAGE_RESERVE_TOKENS + webResults * WEB_RESULT_RESERVE_TOKENS)
  // La ricerca si paga a parte (Exa): si prenota per eccesso, il saldo è il costo dichiarato da OpenRouter.
  const ledgerId = await ctx.reserve(estimate.cents + (webResults ? WEB_SEARCH_RESERVE_CENTS : 0))
  // Su timeout, errore HTTP o token assenti, la riserva resta impegnata:
  // una risposta persa potrebbe essere gia' stata fatturata dal fornitore.
  const response = await fetch(OPENROUTER_CHAT_URL, {
    method: 'POST', signal: AbortSignal.timeout(120_000),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://crm.speaqi.com', 'X-Title': 'Speaqi CRM - Ufficio' },
    body: JSON.stringify({ model: toOpenRouterModel(options.model), max_tokens: options.maxOutputTokens,
      messages: [{ role: 'user', content: images.length ? [{ type: 'text', text: options.input },
        ...images.map((url) => ({ type: 'image_url', image_url: { url, detail: 'high' } }))] : options.input }],
      // Con uno schema, solo un fornitore che lo rispetta davvero.
      ...(webResults ? { plugins: [{ id: 'web', engine: 'exa', max_results: webResults }] } : {}),
      ...(options.jsonSchema ? { response_format: { type: 'json_schema', json_schema: { name: options.jsonSchema.name, strict: true, schema: options.jsonSchema.schema } },
        provider: { require_parameters: true } } : {}) }),
  })
  if (!response.ok) {
    // Richiesta respinta prima di generare: non fatturata, quindi la riserva si libera.
    // Un 5xx o un timeout resta incerto e la riserva rimane.
    if (OPENROUTER_REFUSED.has(response.status)) {
      await ctx.settle(ledgerId, 0, { model: options.model })
      throw new Error(response.status === 401 || response.status === 403
        ? `OpenRouter ha rifiutato la richiesta (HTTP ${response.status}): controlla OPENROUTER_API_KEY nelle variabili del CRM su Railway. Nulla speso.`
        : response.status === 402
          ? 'Credito OpenRouter esaurito: ricaricalo su openrouter.ai. Nulla speso.'
          : `OpenRouter ha respinto la richiesta (HTTP ${response.status}). Nulla speso.`)
    }
    throw new Error(`OpenRouter non disponibile (HTTP ${response.status}); riserva mantenuta`)
  }
  const payload = await response.json()
  const usage = payload.usage
  if (!nonNegativeInteger(usage?.prompt_tokens) || !nonNegativeInteger(usage?.completion_tokens)) {
    throw new Error('OpenRouter non ha restituito i consumi; riserva mantenuta')
  }
  const tokensIn = usage.prompt_tokens as number
  const tokensOut = usage.completion_tokens as number
  const cachedTokens = Math.min(tokensIn, nonNegativeInteger(usage.prompt_tokens_details?.cached_tokens) ? usage.prompt_tokens_details.cached_tokens : 0)
  // Il costo dichiarato da OpenRouter e' quello addebitato; senza, il listino.
  const cost = creditCostCents(usage.cost, usdToEur) ?? modelCostCents(options.model, tokensIn, tokensOut, usdToEur, cachedTokens)
  await ctx.settle(ledgerId, cost, { tokensIn, tokensOut, model: options.model, cachedTokens })
  const choice = Array.isArray(payload.choices) ? payload.choices[0] : undefined
  const content = choice?.message?.content
  if (!choice || choice.finish_reason === 'length' || typeof content !== 'string' || (choice.message?.refusal && !content)) {
    throw new Error('Risposta del modello incompleta; costo registrato')
  }
  // Con la ricerca web, le pagine citate: chi chiama le controlla prima di fidarsi.
  const citations: string[] = Array.isArray(choice.message?.annotations)
    ? choice.message.annotations.filter((a: any) => a?.type === 'url_citation' && typeof a.url_citation?.url === 'string').map((a: any) => a.url_citation.url)
    : []
  return { text: content, costCents: cost, tokensIn, tokensOut, citations }
}
