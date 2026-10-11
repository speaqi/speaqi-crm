import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { buildOutreach, isOutreachAligned, outreachHasFooter, outreachLanguage, planOutreach } from '../src/lib/trade-fair-outreach'
import type { FairExhibitor } from '../src/lib/trade-fair'

const base = { name: 'APT Trento', country: 'Italia', hall: 'Hall C1', stand: '101', contact_person: null, organization_type: 'dmo' } as const

function row(partial: Partial<FairExhibitor> & { id: string }) {
  return { name: partial.id, email: 'a@b.it', status: 'new', contact_id: null, organization_type: 'dmo', lead_class: null, score: 10, ttg_priority_score: 10, ...partial } as FairExhibitor
}

describe('selezione', () => {
  test('in linea: tipologia giusta, email, ancora da contattare', () => {
    assert.equal(isOutreachAligned(row({ id: 'x' })), true)
    assert.equal(isOutreachAligned(row({ id: 'x', email: null })), false)
    assert.equal(isOutreachAligned(row({ id: 'x', status: 'contacted' })), false)
    assert.equal(isOutreachAligned(row({ id: 'x', contact_id: 'c' })), false)
    assert.equal(isOutreachAligned(row({ id: 'x', organization_type: 'tecnologico' })), false)
    assert.equal(isOutreachAligned(row({ id: 'x', organization_type: null })), false)
    assert.equal(isOutreachAligned(row({ id: 'x', lead_class: 'D' })), false)
  })
  test('la stessa email non riceve due messaggi: resta il piu\' prioritario', () => {
    const plan = planOutreach([row({ id: 'a', ttg_priority_score: 20 }), row({ id: 'b', ttg_priority_score: 40 })])
    assert.deepEqual(plan.map((p) => [p.row.id, p.duplicate]), [['b', false], ['a', true]])
  })
})

describe('testo', () => {
  test('italiano per l\'Italia, inglese per l\'estero', () => {
    assert.equal(outreachLanguage('Italia'), 'it')
    assert.equal(outreachLanguage(null), 'it')
    assert.equal(outreachLanguage('Oman'), 'en')
    const en = buildOutreach({ ...base, country: 'Oman' })!
    assert.equal(en.lang, 'en')
    assert.match(en.body, /Kind regards/)
  })
  test('porta nome, stand e footer con disiscrizione; ogni tipologia ha il suo testo', () => {
    const it = buildOutreach(base)!
    assert.match(it.subject, /APT Trento/)
    assert.match(it.body, /Pad\. C1 · Stand 101/)
    assert.ok(outreachHasFooter(it.body))
    assert.match(it.body, /no grazie/)
    const nav = buildOutreach({ ...base, organization_type: 'navigazione' })!
    assert.match(nav.body, /codici a tempo/)
    assert.notEqual(nav.body, it.body)
  })
  test('saluta per nome solo se il referente e\' un nome vero', () => {
    assert.match(buildOutreach({ ...base, contact_person: 'Mario Rossi' })!.body, /^Buongiorno Mario,/)
    assert.match(buildOutreach({ ...base, contact_person: 'info@apt.it' })!.body, /^Buongiorno,/)
  })
  test('senza stand non promette di passare', () => {
    assert.doesNotMatch(buildOutreach({ ...base, hall: null, stand: null })!.body, /vostro stand/)
  })
  test('tipologie fuori bersaglio non hanno testo', () => {
    assert.equal(buildOutreach({ ...base, organization_type: 'tecnologico' }), null)
  })
})
