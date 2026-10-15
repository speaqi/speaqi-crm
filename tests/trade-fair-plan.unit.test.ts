import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { buildVisitPlan, groupStops, hallBlock, isCityDestination, isIncomingAgency, planAudienceRows, planDays, selectTopTargets, standNumber } from '../src/lib/trade-fair-plan'

const t = (id: string, hall: string | null, stand: string | null, score: number, extra: Record<string, unknown> = {}) =>
  ({ id, name: id, hall, stand, status: 'new', organization_type: 'dmo', lead_class: null, ttg_priority_score: score, score, contact_person: null, country: 'Italia', source_url: null, ...extra }) as any

describe('piano di visita', () => {
  test('numero di padiglione e di stand', () => {
    assert.equal(hallBlock('A3'), 3)
    assert.equal(hallBlock('Hall A7-C7'), 7)
    assert.equal(hallBlock(null), 99)
    assert.equal(standNumber('435-542-235-406'), 435)
    assert.equal(standNumber('AREA DESK'), 99999)
  })
  test('scelta: solo tipologie in linea, con stand, non scartati, i migliori', () => {
    const rows = [t('a', 'A1', '1', 40), t('b', 'A1', '2', 30), t('c', 'A1', '3', 50, { organization_type: 'tecnologico' }), t('d', null, null, 60), t('e', 'A1', '4', 45, { status: 'not_interested' })]
    assert.deepEqual(selectTopTargets(rows, 5).map((r) => r.id), ['a', 'b'])
    assert.deepEqual(selectTopTargets(rows, 1).map((r) => r.id), ['a'])
  })
  test('solo Italia', () => {
    const rows = [t('it', 'A1', '1', 40), t('uk', 'A1', '2', 50, { country: 'Regno Unito' })]
    assert.deepEqual(selectTopTargets(rows, 5, { italyOnly: true }).map((r) => r.id), ['it'])
  })
  test('shortlist città, estero e incoming distingue città da macro-aree', () => {
    const rows = [
      t('Comune di Trento', 'A1', '1', 60),
      t('Regione Toscana', 'A1', '2', 90),
      t('Visit Bologna', 'A1', '3', 50),
      t('Fondazione Asiago 7 Comuni', 'A1', '7', 95, { category: 'DESTINAZIONI/PROMOZIONE DEL TERRITORIO: ENTI ITALIANI DI PROMOZIONE TURISTICA' }),
      t('Visit Oman', 'A1', '4', 55, { country: 'Oman' }),
      t('Alpine Trips', 'A1', '5', 70, { organization_type: 'tour_operator', category: 'Incoming DMC' }),
      t('Generic Tours', 'A1', '6', 80, { organization_type: 'tour_operator', category: 'Outgoing leisure' }),
    ]
    assert.deepEqual(planAudienceRows(rows, 'italian-cities').map((row) => row.id), ['Comune di Trento', 'Visit Bologna'])
    assert.deepEqual(planAudienceRows(rows, 'foreign-destinations').map((row) => row.id), ['Visit Oman'])
    assert.deepEqual(planAudienceRows(rows, 'incoming-agencies').map((row) => row.id), ['Alpine Trips'])
    assert.equal(isCityDestination(rows[1]), false)
    assert.equal(isCityDestination(rows[3]), false)
    assert.equal(isIncomingAgency(rows[6]), false)
  })
  test('shortlist breve seleziona un solo interlocutore per stand', () => {
    const rows = [t('first', 'A1', '1', 90), t('second same stand', 'A1', '1', 100), t('third', 'A1', '2', 80)]
    assert.deepEqual(selectTopTargets(rows, 2, { onePerStand: true }).map((row) => row.id), ['second same stand', 'third'])
    const plan = buildVisitPlan(rows, 2, 1, { onePerStand: true })
    assert.equal(plan.targets.length, 2)
    assert.equal(plan.stops.length, 2)
  })
  test('uno stand collettivo e\' una tappa sola', () => {
    const stops = groupStops([t('a', 'A1', '435-542', 40), t('b', 'A1', '435-542', 44), t('c', 'A1', '100', 30)])
    assert.equal(stops.length, 2)
    assert.equal(stops.find((s) => s.stand === '435-542')!.targets.length, 2)
    assert.equal(stops.find((s) => s.stand === '435-542')!.score, 44)
  })
  test('ordine: numero di padiglione, poi A prima di C, poi numero di stand', () => {
    const stops = groupStops([t('1', 'C3', '10', 1), t('2', 'A3', '300', 1), t('3', 'A3', '20', 1), t('4', 'A1', '500', 1)])
    assert.deepEqual(stops.map((s) => `${s.hall}/${s.stand}`), ['A1/500', 'A3/20', 'A3/300', 'C3/10'])
  })
  test('giorni bilanciati e padiglioni non spezzati quando possibile', () => {
    const rows: any[] = []
    for (const [hall, n] of [['A1', 10], ['C1', 10], ['A3', 10], ['C3', 10], ['A5', 10], ['C5', 10]] as const) {
      for (let i = 0; i < n; i += 1) rows.push(t(`${hall}-${i}`, hall, String(100 + i), 40 - i * 0.1))
    }
    const plan = buildVisitPlan(rows, 60, 3)
    assert.deepEqual(plan.days.map((d) => d.stops.length), [20, 20, 20])
    for (const d of plan.days) assert.equal(new Set(d.stops.map((s) => s.hall)).size, 2)
    assert.equal(planDays([], 3).length, 3)
  })
})
