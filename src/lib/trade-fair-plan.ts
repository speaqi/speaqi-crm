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
import { exhibitorOrganizationType, isForeignDestination, isItalianDestination, isTourOperator, standLabel, type FairExhibitor } from './trade-fair'

export type PlanTarget = FairExhibitor
export type PlanAudience = 'italian-cities' | 'foreign-destinations' | 'incoming-agencies' | 'all'

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
  return (OUTREACH_TARGET_TYPES as readonly string[]).includes(exhibitorOrganizationType(row) || '')
}

const ITALIAN_CITIES = ['Ancona', 'Aosta', 'Arezzo', 'Bari', 'Bergamo', 'Bologna', 'Bolzano', 'Brescia', 'Cagliari', 'Catania', 'Como', 'Cosenza', 'Ferrara', 'Firenze', 'Florence', 'Genova', 'Genoa', 'Lecce', 'Livorno', 'Lucca', 'Mantova', 'Matera', 'Messina', 'Milano', 'Milan', 'Modena', 'Napoli', 'Naples', 'Padova', 'Palermo', 'Parma', 'Perugia', 'Pisa', 'Pistoia', 'Ravenna', 'Reggio Calabria', 'Rimini', 'Roma', 'Rome', 'Salerno', 'Siena', 'Siracusa', 'Taranto', 'Torino', 'Turin', 'Trento', 'Trieste', 'Udine', 'Venezia', 'Venice', 'Verona']

function fold(value: string) {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/** Include enti che rappresentano chiaramente una città, escludendo aree e regioni. */
export function isCityDestination(row: FairExhibitor) {
  if (!isItalianDestination(row)) return false
  const name = fold(row.name)
  const category = fold(row.category || '')
  const broadArea = /\b(region|regional|provinc|territor|area vasta|distretto|comprensorio|valle|riviera|coast|lake|montagn|consorzio turistico|tourism board region|unione montana|unione dei comuni|sette comuni|7 comuni|altopiano|ogd)\b/.test(name)
  if (broadArea) return false
  if (/\b(comune|citta|city of|municipality of)\b/.test(name)) return true
  if (/\b(comune|citta|city|municipalita|turismo comunale|ente turistico comunale)\b/.test(category)) return true
  return ITALIAN_CITIES.some((city) => new RegExp(`(?:^|[^a-z])${fold(city)}(?:$|[^a-z])`).test(name))
}

export function isIncomingAgency(row: FairExhibitor) {
  if (!isTourOperator(row)) return false
  if (exhibitorOrganizationType(row) === 'dmc') return true
  return /\b(incoming|receptive|destination management|incoming tour|agenzia incoming|tour operator incoming)\b/i
    .test([row.name, row.category, row.description].filter(Boolean).join(' '))
}

export function planAudienceRows(rows: FairExhibitor[], audience: PlanAudience) {
  if (audience === 'italian-cities') return rows.filter(isCityDestination)
  if (audience === 'foreign-destinations') return rows.filter(isForeignDestination)
  if (audience === 'incoming-agencies') return rows.filter(isIncomingAgency)
  return rows
}

/** I `count` migliori per punteggio di priorita'. */
export function selectTopTargets<T extends PlanTarget>(rows: T[], count: number, options: { italyOnly?: boolean; onePerStand?: boolean } = {}) {
  const italian = (row: PlanTarget) => !row.country || /^ital/i.test(row.country.trim())
  const sorted = rows
    .filter(isPlanCandidate)
    .filter((row) => !options.italyOnly || italian(row))
    .sort((a, b) => (b.ttg_priority_score ?? b.score) - (a.ttg_priority_score ?? a.score) || a.name.localeCompare(b.name))
  if (!options.onePerStand) return sorted.slice(0, Math.max(0, count))
  const selected: T[] = []
  const usedStands = new Set<string>()
  for (const row of sorted) {
    const key = `${row.hall}|${row.stand}`.toLowerCase()
    if (usedStands.has(key)) continue
    usedStands.add(key)
    selected.push(row)
    if (selected.length >= Math.max(0, count)) break
  }
  return selected
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

export function buildVisitPlan<T extends PlanTarget>(rows: T[], count: number, days: number, options: { italyOnly?: boolean; onePerStand?: boolean } = {}) {
  const targets = selectTopTargets(rows, count, options)
  const stops = groupStops(targets)
  return { targets, stops, days: planDays(stops, days) }
}
