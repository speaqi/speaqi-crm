import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { classFromScore, evaluateExhibitor, factorOption, FACTOR_DEFS, scoreColumns } from '../src/lib/opportunity-score'

const manual = (entries: Record<string, string>) =>
  Object.fromEntries(Object.entries(entries).map(([key, option]) => [key, { option, at: '2026-10-11T10:00:00Z' }]))

describe('struttura del punteggio', () => {
  test('i pesi dei criteri sommano a 100 e ogni opzione sta sotto il massimo', () => {
    assert.equal(FACTOR_DEFS.reduce((sum, def) => sum + def.max, 0), 100)
    for (const def of FACTOR_DEFS) {
      assert.equal(Math.max(...def.options.map((o) => o.points)), def.max, def.key)
    }
  })
  test('soglie delle classi', () => {
    assert.deepEqual([100, 85, 84, 70, 69, 55, 54, 40, 39, 0].map(classFromScore), ['S', 'S', 'A', 'A', 'B', 'B', 'C', 'C', 'D', 'D'])
  })
})

describe('tipologia dedotta', () => {
  test('un ente del turismo e\' una DMO, e la categoria e\' un dato', () => {
    const ev = evaluateExhibitor({ name: 'ATL Terre del Sud', category: 'DESTINAZIONI/PROMOZIONE DEL TERRITORIO: ENTI ITALIANI DI PROMOZIONE TURISTICA' })
    assert.equal(ev.factors[0].option, 'dmo')
    assert.equal(ev.factors[0].source, 'category')
  })
  test('piu\' caselle senza conferma dal nome: ipotesi, non dato', () => {
    const ev = evaluateExhibitor({ name: 'Rossi Srl', category: 'DESTINAZIONI/PROMOZIONE DEL TERRITORIO: ENTI DEL TURISMO ESTERI / TRASPORTI: COMPAGNIE AEREE' })
    assert.equal(ev.factors[0].source, 'type')
  })
  test('il nome conferma: una compagnia aerea non diventa una DMO', () => {
    const ev = evaluateExhibitor({ name: 'AER LINGUS', category: 'DESTINAZIONI/PROMOZIONE DEL TERRITORIO: ENTI DEL TURISMO ESTERI / TRASPORTI: COMPAGNIE AEREE' })
    assert.equal(ev.factors[0].option, 'trasporto')
  })
  test('un fornitore tecnologico che cita i tour operator resta tecnologico', () => {
    const ev = evaluateExhibitor({ name: 'Zucchetti', category: 'TECNOLOGIA/WEB: SOFTWARE HOUSE / TOUR OPERATOR' })
    assert.equal(ev.factors[0].option, 'tecnologico')
  })
  test('il noleggio non e\' una societa\' di trasporto', () => {
    const ev = evaluateExhibitor({ name: 'Alfa', category: 'TRASPORTI: SERVIZI DI NOLEGGIO' })
    assert.notEqual(ev.factors[0].option, 'trasporto')
  })
  test('senza categoria ne\' indizi nel nome la tipologia e\' sconosciuta, non zero', () => {
    const ev = evaluateExhibitor({ name: 'Caseificio 4 Madonne' })
    assert.equal(ev.factors[0].points, null)
    assert.equal(ev.unknown.some((f) => f.key === 'organization_type'), true)
  })
})

describe('dati sconosciuti', () => {
  test('con pochi dati la classe non esce: da qualificare, non scartato', () => {
    const ev = evaluateExhibitor({ name: 'Visit Oman', category: 'DESTINAZIONI/PROMOZIONE DEL TERRITORIO: ENTI DEL TURISMO ESTERI' })
    assert.equal(ev.confidence, 'LOW')
    assert.equal(ev.leadClass, null)
    assert.equal(ev.recommendedAction, 'Da qualificare')
    assert.ok(ev.unknown.length >= 3)
  })
  test('budget, distribuzione e potenziale non si deducono mai da soli', () => {
    const ev = evaluateExhibitor({ name: 'Visit Oman', category: 'DESTINAZIONI/PROMOZIONE DEL TERRITORIO', description: 'ricco budget' })
    for (const key of ['distribution_reach', 'budget_capacity', 'commercial_potential']) {
      assert.equal(ev.factors.find((f) => f.key === key)?.points, null)
    }
  })
  test('lo zero verificato a mano e\' diverso dallo sconosciuto', () => {
    const ev = evaluateExhibitor({ name: 'Alfa', sos_manual: manual({ budget_capacity: 'none' }) })
    assert.equal(ev.factors.find((f) => f.key === 'budget_capacity')?.points, 0)
  })
  test('un espositore ignoto non supera uno noto e adatto', () => {
    const noto = evaluateExhibitor({ name: 'APT Trento', category: 'DESTINAZIONI/PROMOZIONE DEL TERRITORIO: ENTI ITALIANI DI PROMOZIONE TURISTICA' })
    const ignoto = evaluateExhibitor({ name: 'Caseificio' })
    assert.ok(noto.ttgPriorityScore > ignoto.ttgPriorityScore)
  })
})

describe('qualificato a mano', () => {
  const base = {
    name: 'APT Trento', category: 'DESTINAZIONI/PROMOZIONE DEL TERRITORIO: ENTI ITALIANI DI PROMOZIONE TURISTICA',
    contact_person: 'Mario Rossi',
    sos_manual: manual({ distribution_reach: 'gt100k', budget_capacity: 'dedicated', commercial_potential: 'multi', map_need: 'paper' }),
  }
  test('confidenza alta, classe e azione consigliata', () => {
    const ev = evaluateExhibitor(base)
    assert.equal(ev.confidence, 'HIGH')
    assert.ok(ev.leadClass === 'S' || ev.leadClass === 'A')
    assert.ok(ev.opportunityScore! >= 70)
    assert.equal(ev.topFactors.length, 3)
  })
  test('i criteri manuali vincono sulla deduzione', () => {
    const ev = evaluateExhibitor({ ...base, sos_manual: { ...base.sos_manual, organization_type: { option: 'hotel', at: '' } } })
    assert.equal(ev.factors[0].option, 'hotel')
    assert.equal(ev.factors[0].source, 'manual')
  })
  test('azienda non turistica confermata a mano: scartata', () => {
    const ev = evaluateExhibitor({ ...base, sos_manual: { ...base.sos_manual, organization_type: { option: 'non_turistica', at: '' } } })
    assert.equal(ev.leadClass, 'D')
  })
})

describe('TTG action e priorita\'', () => {
  test('bonus massimo 50 e formula 0,8 / 0,4', () => {
    const ev = evaluateExhibitor({
      name: 'SNAV', category: 'COMPAGNIE DI NAVIGAZIONE', stand: 'B12', contact_person: 'Anna', status: 'meeting',
      ttg_flags: { decision_maker_present: true, partner_intro: true },
    })
    assert.equal(ev.ttgActionScore, 50)
    assert.equal(ev.ttgPriorityScore, Math.round((ev.rankScore * 0.8 + 50 * 0.4) * 10) / 10)
  })
  test('un operatore pronto a incontrarti supera uno simile ma irraggiungibile', () => {
    const cold = { name: 'DMC Uno', category: 'MEETING INDUSTRY: DMC' }
    const warm = { ...cold, name: 'DMC Due', stand: 'A1', contact_person: 'Luca', status: 'interested', ttg_flags: { decision_maker_present: true } }
    assert.ok(evaluateExhibitor(warm).ttgPriorityScore > evaluateExhibitor(cold).ttgPriorityScore)
  })
  test('scoreColumns riempie le colonne da salvare', () => {
    const cols = scoreColumns({ name: 'Visit Oman', category: 'DESTINAZIONI/PROMOZIONE DEL TERRITORIO' })
    assert.equal(cols.organization_type, 'dmo')
    assert.equal(cols.lead_class, null)
    assert.equal(cols.data_confidence, 'LOW')
    assert.ok(cols.score >= 0 && cols.score <= 100)
    assert.equal(factorOption('organization_type', cols.organization_type)?.points, 20)
  })
})
