import { createHash } from 'node:crypto'
import { BudgetExceeded, type AgentContext, type AgentHandler } from '../office-agents'
import { createServiceRoleClient } from '../supabase'
import { officeIsNaples } from '@/lib/office/director'
import { officeRomeDay } from '@/lib/office/finance'
import {
  LANGUAGES_INCLUDE, MAX_MAPS_PER_NIGHT, euro, nightWindow, languagesQueue, launchOptions, percentDone, progressCheck, summaryLine, usdToCents,
  type FillDryRun, type LanguagesQueueEntry, type TranslationsSummary,
} from '@/lib/office/languages-voice'
import { addOfficeOutputOnce } from './shared'

type MapStatus = { map_id: string; slug: string; name: string; studiomap_slug: string | null; live: boolean; target_languages: string[] }
type FillResponse = FillDryRun & { started?: boolean; already_running?: boolean; reason?: string; run_id?: string; dry_run?: boolean }
type RunState = { state?: string } | null

/** Le sole chiamate Speaqi dell'agente: lettura, stima e "Genera le mancanti". Mai sync o pubblicazione. */
export type SpeaqiTranslationsApi = {
  status(mapId: string): Promise<MapStatus>
  translations(mapId: string): Promise<{ target_languages: string[]; summary: TranslationsSummary; run: RunState }>
  fill(mapId: string, body: { include: string[]; audio: boolean; dry_run: boolean; request_id?: string }): Promise<FillResponse>
}

export function speaqiTranslationsApi(): SpeaqiTranslationsApi | null {
  const key = process.env.SPEAQI_API_KEY
  if (!key) return null
  const base = (process.env.SPEAQI_PUBLIC_API_URL || 'https://api.speaqi.com/api/v1').replace(/\/$/, '')
  async function call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const response = await fetch(`${base}${path}`, {
      method: init.method || 'GET', cache: 'no-store', signal: AbortSignal.timeout(30_000),
      headers: { 'x-api-key': key!, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok) throw new Error(`Speaqi ${response.status}: ${payload?.message || 'errore'}`)
    return payload as T
  }
  return {
    status: (id) => call(`/maps/${encodeURIComponent(id)}/studiomap/status`),
    translations: (id) => call(`/maps/${encodeURIComponent(id)}/studiomap/translations`),
    fill: (id, body) => call(`/maps/${encodeURIComponent(id)}/studiomap/translations/fill`, { method: 'POST', body }),
  }
}

/** Stesso giro, stessa richiesta: Speaqi usa request_id come id del lavoro, quindi un nuovo tentativo non raddoppia. */
function requestId(...parts: string[]) {
  const h = createHash('sha256').update(parts.join('|')).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`
}

const ACTIVE = new Set(['active', 'waiting', 'delayed'])

/** Prova a prenotare le opzioni in ordine; la prima che sta nel budget vince. */
async function reserveFirst(ctx: AgentContext, options: ReturnType<typeof launchOptions>) {
  for (const option of options) {
    try { return { option, ledger: await ctx.reserve(option.cents) } } catch (error) { if (!(error instanceof BudgetExceeded)) throw error }
  }
  return null
}

export function languagesVoiceHandler(admin: any, options: { api?: SpeaqiTranslationsApi | null; now?: () => Date } = {}): AgentHandler {
  return async (ctx) => {
    const api = options.api === undefined ? speaqiTranslationsApi() : options.api
    if (!api) return { summary: 'Manca SPEAQI_API_KEY: nessuna mappa lavorata, nessuna spesa.' }
    const userId = ctx.agent.user_id
    const day = officeRomeDay(options.now?.() || new Date())
    const settings = (ctx.agent.settings || {}) as Record<string, unknown>
    const rate = Number(settings.usd_to_eur ?? process.env.OFFICE_USD_TO_EUR ?? 1)
    const usdToEur = Number.isFinite(rate) && rate > 0 && rate < 5 ? rate : 1
    const { entries, rejected } = languagesQueue(settings.queue)
    for (const r of rejected) ctx.log(`Scartata dalla coda: ${r.reason}`)
    if (!entries.length) return { summary: rejected.length ? `Coda senza mappe valide (${rejected.length} scartate).` : 'Nessuna mappa in coda: nessuna spesa.' }

    const previous = await admin.from('office_agent_outputs').select('body').eq('user_id', userId).eq('agent_id', ctx.agent.id)
      .eq('kind', 'report').ilike('output_key', 'languages:night:%').order('created_at', { ascending: false }).limit(1)
    if (previous.error) throw previous.error
    const before = (previous.data?.[0]?.body?.maps || {}) as Record<string, { text: number; audio: number; launched?: string | null }>
    const approved = await admin.from('office_agent_outputs').select('id,body').eq('user_id', userId).eq('agent_id', ctx.agent.id)
      .eq('kind', 'proposal').eq('status', 'approved').limit(200)
    if (approved.error) throw approved.error

    const lines: string[] = []; const maps: Record<string, unknown> = {}; const deferred: string[] = []
    let spent = 0; let launched = 0
    for (const entry of nightWindow(entries, day)) {
      try {
        const result = await workMap(entry)
        if (result) { spent += result.spent; launched += result.launched ? 1 : 0 }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        lines.push(`${entry.city || entry.map_id}: non lavorata (${message}).`)
        ctx.log(`Errore su ${entry.map_id}: ${message}`)
      }
    }
    if (entries.length > MAX_MAPS_PER_NIGHT) deferred.push(`${entries.length - MAX_MAPS_PER_NIGHT} mappe oltre il limite di ${MAX_MAPS_PER_NIGHT} per notte: toccano nelle prossime notti, a rotazione`)

    await addOfficeOutputOnce(admin, ctx, `languages:night:${day}`, { kind: 'report', title: `Lingue e voce — ${day}`,
      body: { righe: lines, maps, rimandate: deferred, speso_cents: spent, cambio_usd_eur: usdToEur,
        costo: 'Stima di Speaqi al lancio (testi in differita a metà prezzo + voce). Il costo vero dei testi è in translation_batches su Speaqi e non è ancora esposto all’API.',
        nota: 'Napoli esclusa. Le traduzioni da aggiornare (outdated) non partono mai da sole: sono proposte da approvare.' } })
    return { summary: `${launched} mappe avviate, speso ${euro(spent)} (stima)${lines.length ? `. ${lines[0]}` : ''}` }

    async function workMap(entry: LanguagesQueueEntry) {
      const status = await api!.status(entry.map_id)
      const name = status.name || entry.city || entry.map_id
      if (officeIsNaples(status.name, status.slug, status.studiomap_slug)) {
        lines.push(`${name}: esclusa, è Napoli.`); return null
      }
      const tr = await api!.translations(entry.map_id)
      if (!tr.target_languages?.length) { lines.push(`${name}: nessuna lingua scelta su Speaqi, niente da fare.`); return null }
      const check = status.live ? progressCheck(before[entry.map_id] || null, tr.summary) : null
      const snapshot = { text: percentDone(tr.summary.text), audio: percentDone(tr.summary.audio), launched: null as string | null, live: status.live, check: check?.note || null }
      maps[entry.map_id] = snapshot
      if (tr.run?.state && ACTIVE.has(tr.run.state)) { lines.push(summaryLine(name, tr.summary, 0, 'esecuzione già in corso')); return null }
      if (check && !check.rose && before[entry.map_id]?.launched && !(tr.summary.text.processing + tr.summary.audio.processing)) {
        lines.push(`${summaryLine(name, tr.summary, 0, 'non rilanciata')}. ${check.note}`); return null
      }

      // Le vecchie si propongono, non si lanciano; dopo l'approvazione partono qui, una volta sola.
      const outdated = await api!.fill(entry.map_id, { include: ['outdated'], audio: true, dry_run: true })
      const approvedOutdated = (approved.data || []).find((o: any) => o.body?.map_id === entry.map_id && o.body?.action === 'refresh_outdated')
      if (outdated.text + outdated.audio > 0 && !approvedOutdated) {
        const cents = usdToCents(outdated.estimate?.total_usd ?? 0, usdToEur)
        await addOfficeOutputOnce(admin, ctx, `languages:outdated:${entry.map_id}:${outdated.text}:${outdated.audio}`, { kind: 'proposal',
          title: `Aggiornare le traduzioni vecchie di ${name}: ${euro(cents)}`,
          body: { action: 'refresh_outdated', map_id: entry.map_id, city: name, testi: outdated.text, audio: outdated.audio, costo_stimato_cents: cents,
            motivo: 'Testi cambiati dopo la traduzione. Approvando, la notte seguente l’agente le rifà entro il budget.' },
          target_table: 'speaqi_maps', target_id: entry.map_id })
      }

      const dry = await api!.fill(entry.map_id, { include: [...LANGUAGES_INCLUDE], audio: true, dry_run: true })
      const runs: Array<{ include: string[]; dry: FillDryRun; tag: string }> = [{ include: [...LANGUAGES_INCLUDE], dry, tag: 'mancanti' }]
      if (approvedOutdated && outdated.text + outdated.audio > 0) runs.push({ include: ['outdated'], dry: outdated, tag: `vecchie:${approvedOutdated.id}` })
      if (runs.every((r) => r.dry.text + r.dry.audio === 0)) { lines.push(summaryLine(name, tr.summary, 0, 'completa')); return null }

      let spentHere = 0; const notes: string[] = []
      for (const run of runs) {
        if (run.dry.text + run.dry.audio === 0) continue
        if (run.tag.startsWith('vecchie:')) {
          const done = await admin.from('office_agent_outputs').select('id').eq('user_id', userId).eq('agent_id', ctx.agent.id)
            .eq('output_key', `languages:outdated-launched:${run.tag.slice(8)}`).limit(1)
          if (done.error) throw done.error
          if (done.data?.length) continue
        }
        const reserved = await reserveFirst(ctx, launchOptions(run.dry, usdToEur))
        if (!reserved) { notes.push(`${run.tag}: rimandate, il budget di oggi non basta`); continue }
        const response = await api!.fill(entry.map_id, { include: run.include, audio: reserved.option.audio, dry_run: false,
          request_id: requestId(ctx.runId, entry.map_id, run.tag, reserved.option.mode) })
        if (!response.started) {
          await ctx.settle(reserved.ledger, 0)
          notes.push(response.already_running ? 'già in corso su Speaqi' : `niente da lanciare (${response.reason || 'nessun motivo'})`); continue
        }
        await ctx.settle(reserved.ledger, reserved.option.cents)
        spentHere += reserved.option.cents
        notes.push(reserved.option.mode === 'all' ? `${run.tag}: testi e audio avviati (${response.text}/${response.audio})`
          : `${run.tag}: solo testi (${response.text}); audio rimandato a domani, non stava nel budget`)
        if (run.tag.startsWith('vecchie:')) await addOfficeOutputOnce(admin, ctx, `languages:outdated-launched:${run.tag.slice(8)}`, { kind: 'report',
          title: `Traduzioni vecchie riavviate: ${name}`, body: { map_id: entry.map_id, proposal_id: run.tag.slice(8), speso_cents: reserved.option.cents } })
      }
      snapshot.launched = spentHere ? day : null
      lines.push(`${summaryLine(name, tr.summary, spentHere, notes.join('; '))}${check ? `. ${check.note}` : ''}`)
      return { spent: spentHere, launched: spentHere > 0 }
    }
  }
}

export const runLanguagesVoice: AgentHandler = (ctx) => languagesVoiceHandler(createServiceRoleClient())(ctx)
