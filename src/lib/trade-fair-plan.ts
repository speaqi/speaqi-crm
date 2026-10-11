/**
 * Piano di visita della fiera: i migliori espositori raggruppati per stand (uno stand
 * collettivo e' una sola tappa), ordinati per padiglione e numero di stand, divisi in
 * giorni a blocchi di padiglioni vicini. Solo logica pura.
 *
 * Assunzione dichiarata: i padiglioni con lo stesso numero (A3 e C3, A5-C5…) sono affiancati,
 * quindi si visitano di seguito. La vicinanza fra gli stand dello stesso padiglione e' quella
 * dei numeri: serve a mettere vicini quelli con numero vicino, non e' una piantina.
 */
import { OUTREACH_TARGET_TYPES } from './trade-fair-outreach'
import { standLabel, type FairExhibitor } from './trade-fair'

export type PlanTarget = Pick<FairExhibitor, 'id' | 'name' | 'hall' | 'stand' | 'status' | 'organization_type' | 'lead_class' | 'ttg_priority_score' | 'score' | 'contact_person' | 'country' | 'source_url'>

export type PlanStop = {
  key: string
  hall: string
  block: number
  stand: string
  label: string
  score: number
  targets: PlanTarget[]
}

export type PlanDay = { day: number; stops: PlanStop[]; blocks: number[] }

function hallsOf(hall: string | null | undefined) {
  return Array.from(String(hall || '').toUpperCase().matchAll(/\b([AC])\s?(\d)\b/g)).map((m) => ({ side: m[1], n: Number(m[2]) }))
}

/** Numero del padiglione (A3 e C3 -> 3). "Hall A7-C7" -> 7. Senza numero: 99 (in fondo). */
export function hallBlock(hall: string | null | undefined) {
  return hallsOf(hall)[0]?.n ?? 99
}

function hallSide(hall: string | null | undefined) {
  return hallsOf(hall)[0]?.side === 'C' ? 1 : 0
}

export function standNumber(stand: string | null | undefined) {
  const n = parseInt(String(stand || '').replace(/\D+/g, ' ').trim().split(' ')[0] || '', 10)
  return Number.isFinite(n) ? n : 99999
}

export function isPlanCandidate(row: PlanTarget) {
  if (!row.hall || !row.stand || row.status === 'not_interested') return false
  if (row.lead_class === 'D') return false
  return (OUTREACH_TARGET_TYPES as readonly string[]).includes(row.organization_type || '')
}

/** I `count` migliori per punteggio di priorita'. */
export function selectTopTargets<T extends PlanTarget>(rows: T[], count: number, options: { italyOnly?: boolean } = {}) {
  const italian = (row: PlanTarget) => !row.country || /^ital/i.test(row.country.trim())
  return rows
    .filter(isPlanCandidate)
    .filter((row) => !options.italyOnly || italian(row))
    .sort((a, b) => (b.ttg_priority_score ?? b.score) - (a.ttg_priority_score ?? a.score) || a.name.localeCompare(b.name))
    .slice(0, Math.max(0, count))
}

/** Uno stand (anche collettivo) e' una tappa sola. */
export function groupStops(targets: PlanTarget[]): PlanStop[] {
  const map = new Map<string, PlanStop>()
  for (const t of targets) {
    const hall = String(t.hall).trim()
    const stand = String(t.stand).trim()
    const key = `${hall}|${stand}`.toLowerCase()
    const score = t.ttg_priority_score ?? t.score
    const existing = map.get(key)
    if (existing) {
      existing.targets.push(t)
      existing.score = Math.max(existing.score, score)
    } else {
      map.set(key, { key, hall, block: hallBlock(hall), stand, label: standLabel({ hall, stand }), score, targets: [t] })
    }
  }
  return Array.from(map.values()).sort(compareStops)
}

export function compareStops(a: PlanStop, b: PlanStop) {
  return a.block - b.block || hallSide(a.hall) - hallSide(b.hall) || a.hall.localeCompare(b.hall) || standNumber(a.stand) - standNumber(b.stand) || a.stand.localeCompare(b.stand)
}

/**
 * Divide le tappe in `days` giorni: blocchi di padiglioni consecutivi, il piu' possibile
 * di pari numero di tappe; un padiglione non si spezza fra due giorni a meno che da solo
 * superi il carico di un giorno (allora si spezza per numero di stand).
 */
export function planDays(stops: PlanStop[], days: number): PlanDay[] {
  const d = Math.max(1, Math.min(7, Math.floor(days)))
  const sorted = [...stops].sort(compareStops)
  const target = Math.ceil(sorted.length / d)
  const result: PlanDay[] = Array.from({ length: d }, (_, i) => ({ day: i + 1, stops: [], blocks: [] }))
  // Per padiglione (A3, C3 ...) in ordine di visita.
  const halls: PlanStop[][] = []
  for (const stop of sorted) {
    const last = halls[halls.length - 1]
    if (last && last[0].hall === stop.hall) last.push(stop)
    else halls.push([stop])
  }
  let day = 0
  for (const group of halls) {
    const room = target - result[day].stops.length
    // Se il padiglione non ci sta ma ci starebbe intero il giorno dopo, si passa al giorno dopo.
    if (result[day].stops.length > 0 && group.length > room && group.length <= target && day < d - 1) day += 1
    for (const stop of group) {
      if (result[day].stops.length >= target && day < d - 1) day += 1
      result[day].stops.push(stop)
    }
  }
  for (const r of result) r.blocks = Array.from(new Set(r.stops.map((s) => s.block)))
  return result
}

export function buildVisitPlan<T extends PlanTarget>(rows: T[], count: number, days: number, options: { italyOnly?: boolean } = {}) {
  const targets = selectTopTargets(rows, count, options)
  const stops = groupStops(targets)
  return { targets, stops, days: planDays(stops, days) }
}
