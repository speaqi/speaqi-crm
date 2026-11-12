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
