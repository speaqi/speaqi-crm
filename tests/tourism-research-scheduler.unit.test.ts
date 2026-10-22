import assert from 'node:assert/strict'
import test from 'node:test'
import { tourismResearchEnabled, tourismResearchIntervalMs } from '../src/lib/server/tourism-research-scheduler'

const env = (e: Record<string, string>) => e as unknown as NodeJS.ProcessEnv

test('il worker della ricerca parte solo se acceso apposta', () => {
  assert.equal(tourismResearchEnabled(env({})), false)
  assert.equal(tourismResearchEnabled(env({ TOURISM_RESEARCH_ENABLED: '' })), false)
  assert.equal(tourismResearchEnabled(env({ TOURISM_RESEARCH_ENABLED: 'false' })), false)
  assert.equal(tourismResearchEnabled(env({ TOURISM_RESEARCH_ENABLED: 'true' })), true)
})

test('la pausa fra due giri ha un minimo di un minuto e un valore calmo di partenza', () => {
  assert.equal(tourismResearchIntervalMs(env({})), 300_000)
  assert.equal(tourismResearchIntervalMs(env({ TOURISM_RESEARCH_INTERVAL_SEC: 'abc' })), 300_000)
  assert.equal(tourismResearchIntervalMs(env({ TOURISM_RESEARCH_INTERVAL_SEC: '5' })), 60_000)
  assert.equal(tourismResearchIntervalMs(env({ TOURISM_RESEARCH_INTERVAL_SEC: '600' })), 600_000)
})
