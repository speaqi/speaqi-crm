/**
 * La sala di controllo dell'Ufficio: ogni città di StudioMap è una riga che attraversa
 * le stesse otto fasi, dai luoghi all'online. Qui solo forma e regole di lettura (puro):
 * i dati arrivano da StudioMap (`POST /api/office/production/read`) e non si fidano.
 */
export const PRODUCTION_PHASES = ['places', 'texts', 'themes', 'intro', 'routes', 'checks', 'speaqi', 'live'] as const
export type ProductionPhaseKey = typeof PRODUCTION_PHASES[number]
export type ProductionPhaseState = 'done' | 'partial' | 'todo'

export const PRODUCTION_PHASE_LABELS: Record<ProductionPhaseKey, string> = {
  places: 'Luoghi', texts: 'Testi', themes: 'Temi', intro: 'Presentazione',
  routes: 'Itinerari', checks: 'Controlli', speaqi: 'Su Speaqi', live: 'Online',
}
/** La sezione di StudioMap dove si lavora quella fase (`/?map=<slug>&view=…`). */
export const PRODUCTION_PHASE_VIEW: Record<ProductionPhaseKey, string> = {
  places: 'luoghi', texts: 'luoghi', themes: 'temi', intro: 'presentazione',
  routes: 'itinerari', checks: 'controlli', speaqi: 'lancio', live: 'lancio',
}

export type ProductionPhase = { key: ProductionPhaseKey; state: ProductionPhaseState; detail: string }
export type ProductionRow = {
  slug: string; name: string; protected: boolean; live: boolean; public_url: string | null
  places: number; phases: ProductionPhase[]; done: number
  next: { phase: ProductionPhaseKey; text: string } | null
  error: string | null; writing_usd: number | null
}
export type ProductionOverview = {
  available: true; generated_at: string; studio_url: string; rows: ProductionRow[]
  totals: { cities: number; live: number; live_behind: number; in_progress: number; places: number; writing_usd: number }
  credit_usd: number | null
} | { available: false; reason: string }

const text = (value: unknown, max: number) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : ''
const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0
const money = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value * 100) / 100 : null
const SLUG = /^[a-z0-9][a-z0-9_-]{0,120}$/i
const STATES: readonly string[] = ['done', 'partial', 'todo']

function phases(raw: unknown): ProductionPhase[] | null {
  if (!Array.isArray(raw)) return null
  const byKey = new Map<string, ProductionPhase>()
  for (const item of raw as Array<Record<string, unknown>>) {
    const key = text(item?.key, 20), state = text(item?.state, 10)
    if ((PRODUCTION_PHASES as readonly string[]).includes(key) && STATES.includes(state)) {
      byKey.set(key, { key: key as ProductionPhaseKey, state: state as ProductionPhaseState, detail: text(item.detail, 80) })
    }
  }
  // Tutte e otto, nell'ordine di sempre: una riga a metà non si disegna.
  return byKey.size === PRODUCTION_PHASES.length ? PRODUCTION_PHASES.map((key) => byKey.get(key)!) : null
}

function publicUrl(value: unknown): string | null {
  try { const url = new URL(text(value, 300)); return url.protocol === 'https:' ? url.toString() : null } catch { return null }
}

/** Dal corpo del bridge alle righe da mostrare: ciò che non torna si scarta, non si indovina. */
export function normalizeProduction(raw: unknown, studioUrl: string): ProductionOverview {
  const body = raw as Record<string, unknown> | null
  if (!body || !Array.isArray(body.rows)) return { available: false, reason: 'StudioMap ha risposto in una forma inattesa.' }
  const rows: ProductionRow[] = []
  for (const item of body.rows as Array<Record<string, unknown>>) {
    const slug = text(item?.slug, 121), list = phases(item?.phases)
    if (!SLUG.test(slug) || !list) continue
    const isProtected = item.protected === true || /napoli|naples/i.test(`${slug} ${text(item.name, 120)}`)
    const first = list.find((phase) => phase.state !== 'done')
    const nextText = text((item.next as Record<string, unknown> | null)?.text, 160)
    rows.push({
      slug, name: text(item.name, 120) || slug, protected: isProtected,
      live: list[list.length - 1].state === 'done', public_url: publicUrl(item.public_url),
      places: count(item.places), phases: list, done: list.filter((phase) => phase.state === 'done').length,
      next: first && !isProtected ? { phase: first.key, text: nextText || PRODUCTION_PHASE_LABELS[first.key] } : null,
      error: text(item.error, 300) || null, writing_usd: isProtected ? null : money(item.writing_usd),
    })
  }
  return {
    available: true, generated_at: text(body.generated_at, 40), studio_url: studioUrl, rows,
    totals: {
      cities: rows.length, live: rows.filter((row) => row.live).length,
      live_behind: rows.filter((row) => row.live && row.next).length,
      in_progress: rows.filter((row) => !row.live && !row.protected).length,
      places: rows.reduce((sum, row) => sum + row.places, 0),
      writing_usd: Math.round(rows.reduce((sum, row) => sum + (row.writing_usd ?? 0), 0) * 100) / 100,
    },
    credit_usd: money(body.credit_usd),
  }
}

export type ProductionFilter = 'all' | 'progress' | 'behind' | 'live'
export function filterProduction(rows: ProductionRow[], filter: ProductionFilter, query = ''): ProductionRow[] {
  const q = query.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
  return rows.filter((row) => {
    if (q && !`${row.name} ${row.slug}`.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().includes(q)) return false
    if (filter === 'progress') return !row.live && !row.protected
    if (filter === 'behind') return row.live && !!row.next
    if (filter === 'live') return row.live
    return true
  })
}

/** L'ordine che il Direttore sa già eseguire per quella fase; null = si lavora in StudioMap. */
export function productionOrder(row: Pick<ProductionRow, 'name' | 'protected'>, phase: ProductionPhaseKey): string | null {
  if (row.protected) return null
  if (phase === 'checks') return `Controlla la mappa di ${row.name}`
  return null
}

export function productionStudioLink(studioUrl: string, slug: string, phase?: ProductionPhaseKey): string {
  const url = new URL('/', studioUrl)
  url.searchParams.set('map', slug)
  if (phase) url.searchParams.set('view', PRODUCTION_PHASE_VIEW[phase])
  return url.toString()
}

// --- Comandi dalla sala di controllo ---------------------------------------------------------
// Il clic è del titolare. Il lavoro (e la spesa, sul credito OpenRouter di StudioMap) lo fa
// StudioMap con le stesse funzioni dei suoi bottoni; qui: quale comando per quale fase, e la
// lettura prudente di piano e stato.

export const PRODUCTION_ACTIONS = ['write_texts', 'write_guide', 'publish', 'go_live'] as const
export type ProductionAction = typeof PRODUCTION_ACTIONS[number]
export const PRODUCTION_ACTION_LABELS: Record<ProductionAction, string> = {
  write_texts: 'Scrivi i testi', write_guide: 'Scrivi temi e presentazione', publish: 'Invia a Speaqi', go_live: 'Metti online',
}
export const isProductionAction = (value: unknown): value is ProductionAction =>
  typeof value === 'string' && (PRODUCTION_ACTIONS as readonly string[]).includes(value)
export const isProductionSlug = (value: unknown): value is string => typeof value === 'string' && SLUG.test(value)
export const isRequestId = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)

/** Il comando che fa avanzare quella fase; null = si lavora in StudioMap (o lo fa il Direttore). */
export function productionActionFor(row: Pick<ProductionRow, 'protected'>, phase: ProductionPhase): ProductionAction | null {
  if (row.protected || phase.state === 'done') return null
  if (phase.key === 'texts') return 'write_texts'
  if (phase.key === 'themes' || phase.key === 'intro') return 'write_guide'
  if (phase.key === 'speaqi') return 'publish'
  if (phase.key === 'live') return phase.state === 'partial' ? 'go_live' : null
  return null
}

export type ProductionPlan = {
  action: ProductionAction; name: string; allowed: boolean; reason: string
  estimate_usd: number; estimate_max_usd: number; warning: string | null; credit_usd: number | null
}
export function normalizeProductionPlan(raw: unknown, action: ProductionAction): ProductionPlan | null {
  const body = raw as { plan?: Record<string, unknown>; credit_usd?: unknown } | null
  const plan = body?.plan
  if (!plan || typeof plan.allowed !== 'boolean') return null
  const estimate = money(plan.estimate_usd) ?? 0
  return { action, name: text(plan.name, 120), allowed: plan.allowed, reason: text(plan.reason, 300),
    estimate_usd: estimate, estimate_max_usd: Math.max(estimate, money(plan.estimate_max_usd) ?? 0),
    warning: text(plan.warning, 300) || null, credit_usd: money(body?.credit_usd) }
}

export type ProductionJob = { done: boolean; interrupted: boolean; phase: string | null; last: string | null; error: string | null }
export function normalizeProductionJob(raw: unknown): ProductionJob | null {
  const body = raw as Record<string, unknown> | null
  if (!body || typeof body.done !== 'boolean') return null
  return { done: body.done, interrupted: body.interrupted === true, phase: text(body.phase, 120) || null,
    last: text(body.last, 300) || null, error: text(body.error, 400) || null }
}

// --- Domande al Direttore sulla produzione ---------------------------------------------------
// «Cosa manca a Lisbona?», «a che punto sono le mappe?»: risponde il codice dalla fotografia di
// StudioMap, senza modello. Riconosce solo domande, mai ordini («controlla», «costruisci»…).

const fold = (value: string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const QUESTION = /\b(cosa|che cosa|cos) manca\b|\ba che punto\b|\bcome (sta|stanno|va|vanno|siamo messi)\b|\bstato (di|del|della|delle|dei)\b|\bquanto (costa|manca)\b|\b(quali|quante) (citta|mappe|guide)\b|\bsituazione (delle )?(mappe|citta|guide|produzione)\b|\bproduzione\b/
const ORDER = /^(direttore\s+)?(controlla|costruisci|crea|prepara|pubblica|invia|scrivi|metti|fai|fammi|trovami|aggiungi|rinomina)\b/
const MAPS = /\b(mappa|mappe|citta|guida|guide|produzione|studiomap)\b/

/** Controllo a costo zero prima di leggere StudioMap: è una domanda, non un ordine. */
export function looksLikeProductionQuestion(textValue: string): boolean {
  const q = fold(textValue)
  return !!q && q.length <= 200 && !ORDER.test(q) && QUESTION.test(q)
}

export type ProductionQuestion = { kind: 'city'; slug: string } | { kind: 'all' }
export function productionQuestion(textValue: string, rows: Array<Pick<ProductionRow, 'slug' | 'name'>>): ProductionQuestion | null {
  const q = fold(textValue)
  if (!q || q.length > 200 || ORDER.test(q) || !QUESTION.test(q)) return null
  // La città col nome più lungo vince: «Costiera Amalfitana» prima di «Amalfi».
  const hit = rows.map((row) => ({ row, name: fold(row.name) })).filter(({ name }) => name.length >= 3 && ` ${q} `.includes(` ${name} `))
    .sort((a, b) => b.name.length - a.name.length)[0]
  if (hit) return { kind: 'city', slug: hit.row.slug }
  return MAPS.test(q) ? { kind: 'all' } : null
}

const dollars = (value: number) => `${value.toFixed(2).replace('.', ',')} $`
export function productionReply(data: ProductionOverview, question: ProductionQuestion, officeUrl: string): string {
  if (!data.available) return `Non riesco a leggere StudioMap adesso: ${data.reason}`
  if (question.kind === 'city') {
    const row = data.rows.find((item) => item.slug === question.slug)
    if (!row) return 'Questa città non è più fra le mappe di StudioMap.'
    const done = row.phases.filter((phase) => phase.state === 'done')
    const open = row.phases.filter((phase) => phase.state !== 'done')
    return [
      `${row.name} — ${row.done}/8 fasi${row.live ? ', online' : ''}${row.protected ? ' (protetta: dall’Ufficio si guarda soltanto)' : ''}.`,
      done.length ? `Fatto: ${done.map((phase) => `${PRODUCTION_PHASE_LABELS[phase.key]} (${phase.detail})`).join(', ')}.` : '',
      open.length ? `Manca: ${open.map((phase) => `${PRODUCTION_PHASE_LABELS[phase.key]} (${phase.detail})`).join(', ')}.` : 'Non manca niente.',
      row.error ? `Ultimo invio a Speaqi fallito: ${row.error}` : '',
      row.next ? `Prossimo passo: ${row.next.text}.` : '',
      row.writing_usd !== null ? `Scrivere temi e presentazione che mancano costa circa ${dollars(row.writing_usd)} (stima).` : '',
      `I comandi sono nell’Ufficio, vista Città: ${officeUrl}`,
    ].filter(Boolean).join('\n')
  }
  const working = data.rows.filter((row) => !row.live && !row.protected).slice(0, 5)
  const behind = data.rows.filter((row) => row.live && row.next).slice(0, 5)
  return [
    `Produzione: ${data.totals.cities} città, ${data.totals.live} online, ${data.totals.in_progress} in produzione, ${data.totals.live_behind} online con arretrati.`,
    working.length ? 'Più vicine all’online:' : '',
    ...working.map((row) => `• ${row.name} ${row.done}/8 — ${row.next?.text || 'pronta'}`),
    behind.length ? 'Online con qualcosa indietro:' : '',
    ...behind.map((row) => `• ${row.name} — ${row.next!.text}`),
    data.totals.writing_usd > 0 ? `Temi e presentazioni che mancano: circa ${dollars(data.totals.writing_usd)} in tutto (stima).` : '',
    data.credit_usd !== null ? `Credito OpenRouter di StudioMap: ${dollars(data.credit_usd)}.` : '',
    `Tutte le città nell’Ufficio: ${officeUrl}`,
  ].filter(Boolean).join('\n')
}
