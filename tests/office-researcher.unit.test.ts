import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validateLocation, researchLocation } from '../src/lib/server/office-agents/researcher'
import type { AgentContext, callModel } from '../src/lib/server/office-agents'

const url = 'https://visit-sibiu.example/'
const pages = [{ url, text: 'Visit Sibiu is the tourism office of Sibiu, Romania. Discover Sibiu with us.' }]
const answer = { country_code: 'RO', country_quote: 'Visit Sibiu is the tourism office of Sibiu, Romania.', country_url: url,
  city: 'Sibiu', city_quote: 'Visit Sibiu is the tourism office of Sibiu, Romania.', city_url: url }

test('accetta paese e città soltanto con citazioni letterali del sito identificato', () => {
  assert.deepEqual(validateLocation(answer, 'Visit Sibiu', url, pages), { country_code: 'RO', city: 'Sibiu', website: url,
    sources: [{ url, quote: answer.country_quote }, { url, quote: answer.city_quote }] })
  assert.equal(validateLocation({ ...answer, country_quote: 'Sibiu is in Romania.' , city: '' }, 'Visit Sibiu', url, pages), null)
  assert.equal(validateLocation({ ...answer, country_code: 'IT', city: '' }, 'Visit Sibiu', url, pages), null)
  assert.equal(validateLocation(answer, 'Visit Paris', url, pages), null)
  assert.equal(validateLocation({ ...answer, country_url: 'https://other.example/', city: '' }, 'Visit Sibiu', url, pages), null)
})

test('la ricerca legge il sito e passa pagine al modello prima di adottare il risultato', async () => {
  let calls = 0
  const model = (async (_ctx, options) => {
    calls++
    return { text: options.webSearch ? url : JSON.stringify(answer), citations: [], tokensIn: 1, tokensOut: 1, costCents: 1 }
  }) as typeof callModel
  const result = await researchLocation({ agent: { model: 'gpt-5-mini' } } as AgentContext, { target: 'Visit Sibiu' }, { model, readSite: async () => pages })
  assert.equal(result?.country_code, 'RO')
  assert.equal(result?.city, 'Sibiu')
  assert.equal(calls, 2)
})
