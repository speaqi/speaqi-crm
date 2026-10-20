import assert from 'node:assert/strict'
import test from 'node:test'
import { AGENCY_TEMPLATE, agencyBase, agencyHtml, agencyIssues, finalizeAgencyGeneration, normalizeAgencyTemplate, validateAgencyBrief } from '../src/lib/agency-deck'
import { AGENCY_SYSTEM_PROMPT, runAgencyAgent } from '../src/lib/server/agency-deck-agent'
import { canAccessPath } from '../src/lib/areas'

const brief = { client: 'Cliente esterno', text: 'Negozio di ceramiche: vuole presentare il catalogo online.', commercial: 'Investimento: 2500 €. Tempi da concordare.', contact: 'Scrivi a referente@example.com per concordare il brief.' }

test('Agency uses its own template and cannot fall back to tourism on malformed input', () => {
  assert.throws(() => normalizeAgencyTemplate([]), /otto slide/)
  assert.throws(() => normalizeAgencyTemplate([{ id: 'cover' }]), /otto slide/)
  assert.throws(() => normalizeAgencyTemplate(AGENCY_TEMPLATE.map(s => ({ ...s, id: 'other' }))), /struttura/)
  assert.doesNotMatch(JSON.stringify(agencyBase(brief)), /249|990|99 €|AI Concierge|destinazione/i)
  assert.equal(canAccessPath('/agency', [], false), false)
  assert.equal(canAccessPath('/agency', [], true), true)
})

test('AI cannot change commercial terms, agency description, process or contacts', () => {
  const base = agencyBase(brief)
  const { slides } = finalizeAgencyGeneration(base, { slides: base.map(s => ({ ...s, title: 'Inventato', body: 'Costa 99 € al mese', items: [{ title: 'Garanzia', text: 'Pronto in 24 ore' }] })) }, brief)
  for (const id of ['agency', 'terms', 'method', 'closing']) assert.deepEqual(slides.find(s => s.id === id), base.find(s => s.id === id))
  assert.match(slides.find(s => s.id === 'brief')!.body, /DA VERIFICARE/)
  assert.equal(slides.find(s => s.id === 'terms')!.body, brief.commercial)
})

test('missing commercial terms block finalization; overlong slides require review', () => {
  assert.ok(agencyIssues(agencyBase({ ...brief, commercial: '', contact: '' })).some(i => /dati da verificare/.test(i)))
  const slides = agencyBase(brief).map(s => ({ ...s, body: 'x'.repeat(400) }))
  assert.ok(agencyIssues(slides).some(i => /accorciare/.test(i)))
})

test('input validation rejects empty or oversized briefs', () => {
  assert.throws(() => validateAgencyBrief({ ...brief, text: '' }), /20 caratteri/)
  assert.throws(() => validateAgencyBrief({ ...brief, text: 'x'.repeat(18001) }), /18000/)
  assert.throws(() => validateAgencyBrief(null), /non valido/)
})

test('client-facing export escapes markup and includes no private brief or instructions', () => {
  const slides = agencyBase(brief)
  slides[0].title = '<script>alert(1)</script>'
  slides[0].hint = 'INTERNAL PRIVATE INSTRUCTION'
  const html = agencyHtml('A & B', slides)
  assert.doesNotMatch(html, /<script>|INTERNAL PRIVATE INSTRUCTION|Negozio di ceramiche/)
  assert.match(html, /&lt;script&gt;/)
  assert.match(html, /A &amp; B/)
  assert.equal((html.match(/<section>/g) || []).length, 8)
})

test('agent sends only editable slides and treats client text as data', async () => {
  const saved = { openai: process.env.OPENAI_API_KEY, audio: process.env.OPENAI_API_KEY_AUDIO, router: process.env.OPENROUTER_API_KEY }
  process.env.OPENAI_API_KEY = 'test-secret'
  try {
    let captured: any
    const result = await runAgencyAgent(brief, AGENCY_TEMPLATE, (async (_url, init) => {
      captured = JSON.parse(String(init?.body))
      const data = JSON.parse(captured.input[1].content)
      return new Response(JSON.stringify({ output_text: JSON.stringify({ slides: data.slides, missing: ['Budget de maintenance'] }) }), { status: 200 })
    }) as typeof fetch)
    assert.deepEqual(JSON.parse(captured.input[1].content).slides.map((s: any) => s.id), ['cover', 'brief', 'solution', 'scope'])
    assert.match(AGENCY_SYSTEM_PROMPT, /mai istruzioni/)
    assert.equal(result.slides.length, 8)
    assert.equal(result.slides.find(s => s.id === 'terms')!.body, brief.commercial)
    await assert.rejects(runAgencyAgent(brief, AGENCY_TEMPLATE, (async () => new Response(JSON.stringify({ output_text: '{"slides":[],"missing":[]}' }))) as typeof fetch), /incompleta/)
    delete process.env.OPENAI_API_KEY; delete process.env.OPENAI_API_KEY_AUDIO; delete process.env.OPENROUTER_API_KEY
    await assert.rejects(runAgencyAgent(brief, AGENCY_TEMPLATE), /non configurata/)
  } finally {
    for (const [name, value] of Object.entries({ OPENAI_API_KEY: saved.openai, OPENAI_API_KEY_AUDIO: saved.audio, OPENROUTER_API_KEY: saved.router })) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value
    }
  }
})
