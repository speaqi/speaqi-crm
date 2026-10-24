import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { languagesQueue, launchOptions, nightWindow, progressCheck, summaryLine, usdToCents, type TranslationsSummary } from '../src/lib/office/languages-voice'
import { languagesVoiceHandler, type SpeaqiTranslationsApi } from '../src/lib/server/office-agents/languages-voice'
import { OFFICE_AGENT_DEFINITIONS } from '../src/lib/server/office-agents/definitions'
import { OFFICE_AGENT_HANDLERS } from '../src/lib/server/office-agents/registry'
import { AUTOMATION_JOBS } from '../src/lib/automation-schedule'
import { BudgetExceeded, type AgentContext } from '../src/lib/server/office-agents'
import { FakeSupabase } from './fake-supabase'

const OWNER = 'owner'
const CAPRI = '11111111-1111-4111-8111-111111111111'
const NAPOLI = '22222222-2222-4222-8222-222222222222'
const counts = (done: number, missing: number, extra: Partial<Record<'failed' | 'outdated' | 'stuck' | 'processing', number>> = {}) =>
  ({ done, missing, failed: 0, outdated: 0, stuck: 0, processing: 0, ...extra })
const summary = (text = counts(240, 1020), audio = counts(0, 1260)): TranslationsSummary => ({ languages: Array.from({ length: 11 }, (_, i) => `l${i}`), points: 115, text, audio })

describe('Lingue e voce: regole pure', () => {
  test('coda: Napoli scartata anche per slug, doppioni e voci senza id fuori', () => {
    const { entries, rejected } = languagesQueue([
      { key: 'complete_languages:a', action: 'complete_languages', target_id: CAPRI, city: 'Capri', status: 'pending' },
      { map_id: CAPRI },
      { target_id: NAPOLI, city: 'Golfo', map_slug: 'napolimap' },
      { map_id: NAPOLI, city: 'Naples' },
      { city: 'Roma' },
      { map_id: CAPRI, status: 'done' },
    ])
    assert.deepEqual(entries.map((e) => e.map_id), [CAPRI])
    assert.equal(rejected.filter((r) => /Napoli/.test(r.reason)).length, 2)
    assert.equal(rejected.length, 3)
  })

  test('budget: prima tutto, poi solo i testi; senza stima niente', () => {
    const dry = { text: 1020, audio: 1260, estimate: { text_usd: 1.2, audio_usd: 14.3, total_usd: 15.5 } }
    assert.deepEqual(launchOptions(dry, 0.9).map((o) => [o.mode, o.cents, o.audio]), [['all', 1395, true], ['text', 108, false]])
    assert.deepEqual(launchOptions({ ...dry, audio: 0 }, 1).map((o) => o.mode), ['all'])
    assert.deepEqual(launchOptions({ text: 3, audio: 3, estimate: null }, 1), [])
    assert.equal(usdToCents(0.001, 1), 1); assert.equal(usdToCents(-1, 1), 0)
  })

  test('riepilogo e controllo dei progressi', () => {
    assert.equal(summaryLine('Capri', summary(counts(1240, 20), counts(980, 280)), 940, ''), 'Capri: 11 lingue, testi 1.240/1.260, audio 980/1.260, speso 9,40 € (stima)')
    assert.equal(progressCheck(null, summary()), null)
    assert.equal(progressCheck({ text: 10, audio: 0 }, summary())!.rose, true)
    assert.match(progressCheck({ text: 50, audio: 50 }, summary())!.note, /Nessun progresso/)
    assert.match(progressCheck({ text: 50, audio: 50 }, summary(counts(240, 0, { processing: 1020 })))!.note, /in lavorazione/)
  })
})

describe('Lingue e voce: handler', () => {
  function fixture(options: { budget: number; queue?: unknown[]; outdated?: number; approved?: any[]; previous?: any } ) {
    const calls: Array<{ id: string; body: any }> = []
    const ledger: Array<{ cents: number; settled?: number }> = []
    let budget = options.budget
    const api: SpeaqiTranslationsApi = {
      async status(id) { return { map_id: id, slug: id === NAPOLI ? 'napolimap' : 'caprispeaqiguide', name: id === NAPOLI ? 'Napoli' : 'Capri', studiomap_slug: null, live: true, target_languages: ['en'] } },
      async translations() { return { target_languages: ['en'], summary: summary(), run: null } },
      async fill(id, body) {
        calls.push({ id, body })
        if (body.include.includes('outdated')) {
          const n = options.outdated ?? 0
          return body.dry_run ? { text: n, audio: n, estimate: { text_usd: n * 0.01, audio_usd: n * 0.1, total_usd: n * 0.11 } } : { started: true, text: n, audio: n }
        }
        return body.dry_run ? { text: 1020, audio: 1260, estimate: { text_usd: 1.2, audio_usd: 14.3, total_usd: 15.5 } }
          : { started: true, text: 1020, audio: body.audio ? 1260 : 0 }
      },
    }
    const db = new FakeSupabase({ office_agent_outputs: [...(options.approved || []), ...(options.previous ? [options.previous] : [])] })
    const agent = { ...OFFICE_AGENT_DEFINITIONS.languages_voice, user_id: OWNER, settings: { queue: options.queue ?? [{ target_id: CAPRI, city: 'Capri' }], usd_to_eur: 1 } }
    const ctx: AgentContext = { agent, runId: 'run-1', log() {},
      async reserve(cents) { if (cents > budget) throw new BudgetExceeded(); budget -= cents; ledger.push({ cents }); return String(ledger.length - 1) },
      async settle(id, cents) { ledger[Number(id)].settled = cents; budget += ledger[Number(id)].cents - cents },
      async addOutput(output) { const row = { id: db.nextId('output'), agent_id: 'languages_voice', user_id: OWNER, status: 'pending', created_at: new Date().toISOString(), output_key: output.key, ...output }; db.tables.office_agent_outputs.push(row); return row.id },
    }
    const run = () => languagesVoiceHandler(db, { api, now: () => new Date('2026-10-24T00:00:00Z') })(ctx)
    return { calls, ledger, db, run, launches: () => calls.filter((c) => !c.body.dry_run) }
  }

  test('ci sta tutto: testi e audio insieme, con request_id stabile', async () => {
    const f = fixture({ budget: 2000 })
    const result = await f.run()
    assert.deepEqual(f.launches().map((c) => [c.body.include, c.body.audio]), [[['missing', 'failed', 'stuck'], true]])
    assert.match(f.launches()[0].body.request_id, /^[0-9a-f-]{36}$/)
    assert.deepEqual(f.ledger, [{ cents: 1550, settled: 1550 }])
    assert.match(result!.summary, /1 mappe avviate/)
  })

  test('non ci sta: solo testi, audio rimandato e detto nel riepilogo', async () => {
    const f = fixture({ budget: 500 })
    await f.run()
    assert.deepEqual(f.launches().map((c) => c.body.audio), [false])
    assert.deepEqual(f.ledger, [{ cents: 120, settled: 120 }])
    const report = f.db.tables.office_agent_outputs.find((o) => o.kind === 'report')!
    assert.match(report.body.righe[0], /audio rimandato a domani/)
  })

  test('budget finito: nessun lancio', async () => {
    const f = fixture({ budget: 50 })
    await f.run()
    assert.equal(f.launches().length, 0)
    assert.match(f.db.tables.office_agent_outputs.find((o) => o.kind === 'report')!.body.righe[0], /budget di oggi non basta/)
  })

  test('Napoli non si tocca, nemmeno se arriva in coda con un altro nome', async () => {
    const f = fixture({ budget: 5000, queue: [{ map_id: NAPOLI, city: 'Golfo' }] })
    await f.run()
    assert.equal(f.calls.length, 0)
    assert.equal(f.ledger.length, 0)
  })

  test('le vecchie diventano una proposta, non un lancio; partono solo dopo l’approvazione, una volta', async () => {
    const f = fixture({ budget: 5000, outdated: 10 })
    await f.run()
    assert.ok(f.launches().every((c) => !c.body.include.includes('outdated')))
    const proposal = f.db.tables.office_agent_outputs.find((o) => o.kind === 'proposal')!
    assert.equal(proposal.body.action, 'refresh_outdated'); assert.equal(proposal.body.costo_stimato_cents, 110)

    const g = fixture({ budget: 5000, outdated: 10, approved: [{ id: 'p1', agent_id: 'languages_voice', user_id: OWNER, kind: 'proposal', status: 'approved', output_key: 'x', body: { action: 'refresh_outdated', map_id: CAPRI } }] })
    await g.run()
    assert.equal(g.launches().filter((c) => c.body.include.includes('outdated')).length, 1)
    await g.run()
    assert.equal(g.launches().filter((c) => c.body.include.includes('outdated')).length, 1)
  })

  test('mappa lanciata ieri senza progressi: non si rilancia', async () => {
    const f = fixture({ budget: 5000, previous: { id: 'r', agent_id: 'languages_voice', user_id: OWNER, kind: 'report', status: 'pending', output_key: 'languages:night:2026-10-23', created_at: '2026-10-23T02:00:00Z',
      body: { maps: { [CAPRI]: { text: 50, audio: 50, launched: '2026-10-23' } } } } })
    await f.run()
    assert.equal(f.launches().length, 0)
  })

  test('installazione: spento, 15 € al giorno, alle 2 di notte', () => {
    const def = OFFICE_AGENT_DEFINITIONS.languages_voice
    assert.equal(def.enabled, false); assert.equal(def.daily_budget_cents, 1500); assert.equal(def.department, 'mappe')
    assert.ok(OFFICE_AGENT_HANDLERS.languages_voice)
    const job = AUTOMATION_JOBS.find((j) => j.name === 'office-languages-voice')!
    assert.equal(job.cron, '0 2 * * *'); assert.equal(job.steps[0].path, '/api/automation/agents/languages_voice/run')
  })
})

test('Lingue: con più di sei mappe in coda la finestra ruota e tocca a tutte', () => {
  const maps = Array.from({ length: 9 }, (_, i) => `m${i}`)
  assert.deepEqual(nightWindow(maps.slice(0, 4), '2026-10-24'), maps.slice(0, 4))
  const seen = new Set<string>()
  for (const day of ['2026-10-24', '2026-10-25', '2026-10-26']) for (const m of nightWindow(maps, day)) seen.add(m)
  assert.equal(seen.size, 9)
  assert.equal(nightWindow(maps, '2026-10-24').length, 6)
})
