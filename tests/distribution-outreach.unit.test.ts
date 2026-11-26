import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  acceptHook, acceptableMailbox, addBusinessDays, buildDistributionMessage, classifyReply, isBounce, languageOf, nextDueAfterStep,
  outcomeOf, segmentOf, selectDistributionCandidates, withinSendWindow, type DistributionRow,
} from '../src/lib/office/distribution-outreach'
import { distributionSettings } from '../src/lib/server/distribution-outreach'
import { parseTelegramAction, proposalLines, proposalMessage } from '../src/lib/office/telegram-actions'

const row = (over: Partial<DistributionRow> & { entity_id: string }): DistributionRow => ({
  name: `Ente ${over.entity_id}`, type_code: 'dmc', country_code: 'IT', website: 'https://example.it', email: `info@${over.entity_id}.it`,
  score: 70, tier: 'A', quick_win: false, guide_slugs: ['roma'], commercial_status: 'new', ...over,
})

test('caselle: solo quelle d’ufficio', () => {
  assert.equal(acceptableMailbox('info@viaggi.it'), true)
  assert.equal(acceptableMailbox('booking@hotel.com'), true)
  assert.equal(acceptableMailbox('mario.rossi@viaggi.it'), false)
  assert.equal(acceptableMailbox('viaggi@pec.it'), false)
  assert.equal(acceptableMailbox('viaggi@legalmail.it'), false)
  assert.equal(acceptableMailbox('press@viaggi.it'), false)
  assert.equal(acceptableMailbox('noreply@viaggi.it'), false)
  assert.equal(acceptableMailbox('agenzia@gmail.com'), false)
  assert.equal(acceptableMailbox('non-una-email'), false)
})

test('segmento e lingua', () => {
  assert.equal(segmentOf('tour_operator'), 'operator')
  assert.equal(segmentOf('property_manager'), 'hospitality')
  assert.equal(segmentOf('ferry_operator'), 'transport')
  assert.equal(segmentOf('travel_agency'), 'agency')
  assert.equal(segmentOf(null), 'other')
  assert.equal(languageOf('IT'), 'it')
  assert.equal(languageOf('fr'), 'en')
})

test('selezione: fascia, stato, guida, casella e un solo contatto per dominio', () => {
  const rows = [
    row({ entity_id: 'a1', tier: 'C' }),
    row({ entity_id: 'a2', commercial_status: 'contacted' }),
    row({ entity_id: 'a3', guide_slugs: [] }),
    row({ entity_id: 'a4', email: 'mario.rossi@a4.it' }),
    row({ entity_id: 'a5', email: 'info@gruppo.it' }),
    row({ entity_id: 'a6', email: 'sales@gruppo.it' }),
    row({ entity_id: 'a7' }),
  ]
  const picked = selectDistributionCandidates({ rows, limit: 10 })
  assert.deepEqual(picked.map((p) => p.entity_id).sort(), ['a5', 'a7'])
})

test('selezione: vittorie rapide prima, poi fascia e punteggio; esclusi già contattati', () => {
  const rows = [
    row({ entity_id: 'b1', tier: 'B', score: 65, quick_win: true }),
    row({ entity_id: 'b2', tier: 'A', score: 90 }),
    row({ entity_id: 'b3', tier: 'A', score: 80 }),
  ]
  assert.deepEqual(selectDistributionCandidates({ rows, limit: 3 }).map((p) => p.entity_id), ['b1', 'b2', 'b3'])
  assert.deepEqual(selectDistributionCandidates({ rows, limit: 3, excludedEntityIds: ['b2'], excludedDomains: ['b3.it'] }).map((p) => p.entity_id), ['b1'])
})

test('selezione: le città si alternano e la partenza ruota col giorno', () => {
  const rows = [
    row({ entity_id: 'r1', guide_slugs: ['roma'], score: 99 }), row({ entity_id: 'r2', guide_slugs: ['roma'], score: 98 }),
    row({ entity_id: 'n1', guide_slugs: ['napoli'], score: 60 }), row({ entity_id: 'm1', guide_slugs: ['milano'], score: 60 }),
  ]
  const day0 = selectDistributionCandidates({ rows, limit: 3, rotation: 0 }).map((p) => p.guide_slug)
  assert.deepEqual(day0, ['roma', 'napoli', 'milano'])
  const day1 = selectDistributionCandidates({ rows, limit: 2, rotation: 1 }).map((p) => p.guide_slug)
  assert.deepEqual(day1, ['napoli', 'milano'])
  // Una guida che copre più città va su quella che viene prima nell'ordine.
  assert.equal(selectDistributionCandidates({ rows: [row({ entity_id: 'x', guide_slugs: ['capri', 'napoli'] })], limit: 1 })[0].guide_slug, 'napoli')
})

test('calendario: giorni lavorativi e scadenze dei promemoria', () => {
  const friday = new Date('2026-11-27T10:00:00Z')
  assert.equal(addBusinessDays(friday, 1).toISOString().slice(0, 10), '2026-11-30')
  assert.equal(nextDueAfterStep(1, friday)!.toISOString().slice(0, 10), '2026-12-03')
  assert.equal(nextDueAfterStep(2, friday)!.toISOString().slice(0, 10), '2026-12-07')
  assert.equal(nextDueAfterStep(3, friday), null)
})

test('orario d’ufficio del destinatario', () => {
  assert.equal(withinSendWindow(new Date('2026-11-25T09:30:00Z'), 'IT'), true) // 10:30 a Roma
  assert.equal(withinSendWindow(new Date('2026-11-25T07:30:00Z'), 'IT'), false) // 8:30
  assert.equal(withinSendWindow(new Date('2026-11-25T16:30:00Z'), 'IT'), false) // 17:30
  assert.equal(withinSendWindow(new Date('2026-11-28T10:00:00Z'), 'IT'), false) // sabato
  assert.equal(withinSendWindow(new Date('2026-11-25T10:00:00Z'), 'US'), false) // 5:00 a New York
  assert.equal(withinSendWindow(new Date('2026-11-25T15:00:00Z'), 'US'), true) // 10:00 a New York
})

test('testi: cifre e link solo quelli del programma; opt-out nelle prime due', () => {
  for (const language of ['it', 'en'] as const) {
    for (const step of [1, 2, 3]) {
      const m = buildDistributionMessage({ step, language, segment: 'operator', guideSlug: 'costiera-amalfitana' })
      const links = m.body.match(/https?:\/\/\S+/g) || []
      assert.ok(links.every((l) => l.startsWith('https://guides.speaqi.com/costiera-amalfitana')), links.join())
      const numbers = (m.body.match(/\d+/g) || []).filter((n) => n !== '20')
      assert.deepEqual(numbers, [], `${language} ${step}: ${numbers}`)
      assert.ok(m.body.includes('Massimo Morgante'))
      if (step === 1) assert.ok(/fondatore di Speaqi|founder of Speaqi/.test(m.body))
      if (step > 1) assert.ok(m.subject.startsWith('Re: '))
      if (step < 3) assert.ok(/non la ricontatterò|won’t contact you again/.test(m.body))
    }
  }
  const it = buildDistributionMessage({ step: 1, language: 'it', segment: 'hospitality', guideSlug: 'roma', hook: 'Hotel Roma accoglie ospiti da tutto il mondo.' })
  assert.ok(it.body.includes('Hotel Roma accoglie ospiti') && it.body.includes('ai vostri ospiti') && it.subject.includes('Roma'))
})

test('apertura del modello: scartata se inventa', () => {
  const name = 'Amalfi Coast Experience'
  assert.equal(acceptHook('Amalfi Coast Experience porta ogni anno viaggiatori a scoprire la costiera.', name), 'Amalfi Coast Experience porta ogni anno viaggiatori a scoprire la costiera.')
  assert.equal(acceptHook('Amalfi Coast Experience ha 30 anni di storia.', name), null)
  assert.equal(acceptHook('Visitate https://x.it, Amalfi Coast Experience.', name), null)
  assert.equal(acceptHook('Siete i migliori della costiera, Amalfi Coast Experience.', name), null)
  assert.equal(acceptHook('Una frase che non nomina mai il destinatario della email.', name), null)
  assert.equal(acceptHook('', name), null)
  assert.equal(acceptHook(42, name), null)
})

test('risposte: automatiche, no, disiscrizione, persona; ritorni al mittente', () => {
  assert.equal(classifyReply({ subject: 'Risposta automatica: Guide di Roma', body: 'Sono fuori ufficio fino al 3' }), 'out_of_office')
  assert.equal(classifyReply({ subject: 'Automatic reply', body: '' }), 'out_of_office')
  assert.equal(classifyReply({ subject: 'Re: Guide', body: 'Grazie, ma non siamo interessati.' }), 'not_interested')
  assert.equal(classifyReply({ subject: 'Re: Guide', body: 'Please remove me from your list' }), 'unsubscribe')
  assert.equal(classifyReply({ subject: 'Re: Guide', body: 'Interessante, mi mandi la presentazione' }), 'reply')
  assert.equal(isBounce({ from: 'mailer-daemon@googlemail.com', subject: 'Delivery Status Notification (Failure)' }), true)
  assert.equal(isBounce({ from: 'info@viaggi.it', subject: 'Re: Guide' }), false)
  assert.deepEqual(outcomeOf('reply'), { outreach: 'replied', dealStage: 'trattativa', commercial: 'replied' })
  assert.equal(outcomeOf('unsubscribe').dealStage, 'persa')
  assert.equal(outcomeOf('bounce').outreach, 'bounced')
})

test('impostazioni: pilota acceso di default, tetti rispettati', () => {
  assert.deepEqual({ ...distributionSettings({}), cityOrder: undefined }, { dailyNew: 5, autopilot: false, cityOrder: undefined })
  assert.equal(distributionSettings({ daily_new: 500 }).dailyNew, 20)
  assert.equal(distributionSettings({ autopilot: 'true' }).autopilot, false)
  assert.equal(distributionSettings({ autopilot: true }).autopilot, true)
  assert.deepEqual(distributionSettings({ city_order: ['napoli', 'Roma!', 3] }).cityOrder, ['napoli'])
})

test('Telegram: l’email intera e «Approva e invia»', () => {
  const lines = proposalLines({ action: 'distribution_send', to: 'info@viaggi.it', subject: 'Guide di Roma', text: 'Buongiorno,\nsono Massimo' })
  assert.deepEqual(lines.slice(0, 2), ['A: info@viaggi.it', 'Oggetto: Guide di Roma'])
  const id = '11111111-2222-4333-8444-555555555555'
  const message = proposalMessage({ id, title: 'Primo contatto', lines, link: 'https://crm/x', approveLabel: '✅ Approva e invia' })
  assert.equal(message.keyboard[0][0].text, '✅ Approva e invia')
  assert.deepEqual(parseTelegramAction(message.keyboard[0][0].callback_data), { kind: 'output', id, status: 'approved' })
  assert.ok(message.text.includes('sono Massimo'))
})
