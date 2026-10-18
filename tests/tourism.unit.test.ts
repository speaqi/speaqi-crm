import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  normalizeRecord,
  parseTourismImport,
  nameKey,
  safePublicUrl,
  opportunityScore,
  exportCsv,
  type Evidence,
  type TourismEntity
} from '../src/lib/tourism'
import {
  parseDiscoveryResponse,
  runTourismDiscovery
} from '../src/lib/server/tourism-discovery'
import pilot from '../src/data/tourism-italy-pilot'
import { canAccessPath, ALL_AREA_KEYS } from '../src/lib/areas'

const base = normalizeRecord(pilot.records[0])
test('Tourism is reserved to the owner even when a collaborator has all other application areas', () => {
  assert.equal(canAccessPath('/tourism', ALL_AREA_KEYS, false), false)
  assert.equal(
    canAccessPath('/tourism?view=directory', ALL_AREA_KEYS, true),
    true
  )
})
test('multilingual normalization retains local scripts and agrees on accented Latin names', () => {
  assert.equal(nameKey('  Società – TOURISME! '), 'societa tourisme')
  assert.equal(nameKey('東京都観光財団'), '東京都観光財団')
  assert.notEqual(nameKey('大阪観光局'), nameKey('東京都観光財団'))
})
test('malformed sources and invented classification are rejected', () => {
  assert.equal(normalizeRecord({ ...base, type_code: 'ota' }).type_code, 'ota')
  assert.throws(
    () => normalizeRecord({ ...base, type_code: 'visit_brand' }),
    /Categoria/
  )
  assert.throws(
    () => normalizeRecord({ ...base, type_code: 'constructor' }),
    /Categoria/
  )
  assert.throws(
    () => normalizeRecord({ ...base, country_code: 'ITALY' }),
    /Paese/
  )
  assert.throws(
    () =>
      normalizeRecord({
        ...base,
        evidence: { ...base.evidence, source_url: 'javascript:alert(1)' }
      }),
    /URL/
  )
  assert.throws(() => normalizeRecord({ ...base, kind: 'person' }), /persone/)
  assert.throws(
    () => normalizeRecord({ ...base, email: 'guessed at example' }),
    /Email/
  )
})
test('URLs are safe links and never credential-bearing or local addresses', () => {
  for (const url of [
    'file:///etc/passwd',
    'http://127.0.0.1/a',
    'http://[::1]/a',
    'http://localhost/a',
    'https://user:pass@example.com',
    'https://a.internal/a'
  ])
    assert.equal(safePublicUrl(url), null)
  assert.equal(
    safePublicUrl('https://www.enit.it/it/chi-siamo#footer'),
    'https://www.enit.it/it/chi-siamo'
  )
})
test('CSV parsing reuses quoted multiline support and reports row failures before import', () => {
  const r = parseTourismImport(
    'name;country_code;type_code;source_url;source_title\n"Ente; Turismo";IT;dmo;https://example.com/about;"Fonte\nufficiale"\nErrato;IT;made_up;https://example.com;Fonte'
  )
  assert.equal(r.total, 2)
  assert.equal(r.records.length, 1)
  assert.equal(r.errors[0].row, 2)
  assert.equal(r.records[0].name, 'Ente; Turismo')
})
test('import bounds are enforced before writes', () => {
  assert.throws(() => parseTourismImport('x'.repeat(1_000_001)), /grande/)
  assert.throws(
    () =>
      parseTourismImport(
        JSON.stringify(Array.from({ length: 201 }, () => base))
      ),
    /200/
  )
})
test('unknown indicators never become a negative or positive score', () => {
  const r = opportunityScore({ details: {} }, [])
  assert.equal(r.score, null)
  assert.equal(r.coverage, 0)
  assert.equal(r.priority, 'NOT QUALIFIED')
  const source = 'https://example.com/maps'
  const entity = {
    details: {
      indicators: {
        map_need: {
          value: 100,
          source_url: source,
          rationale: 'Documented need'
        }
      }
    }
  }
  assert.equal(opportunityScore(entity, []).score, null)
  const ev = {
    status: 'VERIFIED',
    source_url: source,
    fields: ['indicator:map_need']
  } as Evidence
  const partial = opportunityScore(entity, [ev])
  assert.equal(partial.score, 100)
  assert.equal(partial.coverage, 15)
  assert.equal(partial.priority, 'NOT QUALIFIED')
  const mismatch = { ...ev, source_url: 'https://other.example.com/maps' }
  assert.equal(opportunityScore(entity, [mismatch]).score, null)
})
test('configurable score is normalized and requires sufficient evidence coverage', () => {
  const source = 'https://example.com'
  const entity = {
    details: {
      indicators: {
        product_fit: {
          value: 80,
          source_url: source,
          rationale: 'Fit documented'
        }
      }
    }
  }
  const evidence = [
    {
      status: 'VERIFIED',
      source_url: source,
      fields: ['indicator:product_fit']
    }
  ] as Evidence[]
  const r = opportunityScore(entity, evidence, { product_fit: 200 })
  assert.equal(r.coverage, 69)
  assert.equal(r.priority, 'PRIORITY A')
  assert.equal(r.score, 80)
})
test('CSV exports escape spreadsheet formulas and quoted names', () => {
  const csv = exportCsv([
    {
      ...base,
      name: '=HYPERLINK("unsafe")',
      status: 'UNVERIFIED'
    }
  ])
  assert.match(csv, /'=HYPERLINK\(""unsafe""\)/)
  assert.ok(!csv.includes('email'))
})
test('AI candidates require real provider citations and never import personal contacts or scoring', () => {
  const raw = {
    name: 'Ente reale',
    country_code: 'IT',
    type_code: 'dmo',
    website: 'https://example.com/',
    description: 'Destination office',
    source_url: 'https://example.com/about',
    source_title: 'Official about',
    evidence_note: 'Official source',
    email: 'invented@example.com',
    score: 100
  }
  const parsed = parseDiscoveryResponse({
    output_text: JSON.stringify({
      candidates: [
        raw,
        {
          ...raw,
          name: 'No source',
          source_url: 'https://invented.example.com/about'
        }
      ]
    }),
    output: [
      {
        type: 'web_search_call',
        action: { sources: [{ url: raw.source_url }] }
      }
    ],
    usage: { input_tokens: 100, output_tokens: 25 }
  })
  assert.equal(parsed.records.length, 1)
  assert.equal(parsed.rejected.length, 1)
  assert.equal(parsed.records[0].email, null)
  assert.equal(parsed.records[0].details.indicators, undefined)
  assert.equal(parsed.usage.web_search_calls, 1)
})
test('provider transport uses web search, source inclusion and a bounded request', async () => {
  const previous = process.env.OPENAI_API_KEY
  process.env.OPENAI_API_KEY = 'test-placeholder'
  try {
    const fetcher = (async (_url, init) => {
      const body = JSON.parse(String(init?.body))
      assert.equal(body.tools[0].type, 'web_search')
      assert.deepEqual(body.include, ['web_search_call.action.sources'])
      assert.equal(body.max_output_tokens, 6500)
      assert.equal(body.max_tool_calls, 3)
      return new Response(
        JSON.stringify({ output_text: '{"candidates":[]}', output: [] })
      )
    }) as typeof fetch
    const r = await runTourismDiscovery('Trova le DMO in Italia', fetcher)
    assert.equal(r.records.length, 0)
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = previous
  }
})
