import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_PIPELINE_STAGES } from '../src/lib/data'
import { ensurePipelineStages } from '../src/lib/server/crm'
import { FakeSupabase } from './fake-supabase'

function fixture() {
  const stages = DEFAULT_PIPELINE_STAGES.map((stage, i) => ({
    ...stage,
    id: `stage-${i}`,
    user_id: 'owner',
  }))
  const db = new FakeSupabase({ pipeline_stages: stages })
  let queries = 0
  const from = db.from.bind(db)
  db.from = (table: string) => {
    queries++
    return from(table)
  }
  return { db, queries: () => queries }
}

test('pipeline già pronta: una sola lettura e nessuna modifica', async () => {
  const { db, queries } = fixture()
  db.tables.pipeline_stages.push({
    id: 'custom',
    user_id: 'owner',
    name: 'Stato personalizzato',
    order: 20,
    color: '#123456',
  })
  const before = structuredClone(db.tables.pipeline_stages)
  assert.deepEqual(await ensurePipelineStages(db, 'owner'), before)
  assert.equal(queries(), 1)
  assert.deepEqual(db.tables.pipeline_stages, before)
})

test('uno stato da correggere viene ancora aggiornato e riletto', async () => {
  const { db, queries } = fixture()
  db.tables.pipeline_stages[0].color = '#000000'
  const result = await ensurePipelineStages(db, 'owner')
  assert.equal(result[0].color, DEFAULT_PIPELINE_STAGES[0].color)
  assert.equal(queries(), 3, 'Una lettura iniziale, un update, una rilettura')
})

test('uno stato mancante viene ancora creato senza perdere gli altri', async () => {
  const { db } = fixture()
  db.tables.pipeline_stages.splice(3, 1)
  const result = await ensurePipelineStages(db, 'owner')
  assert.equal(result.length, DEFAULT_PIPELINE_STAGES.length)
  for (const stage of DEFAULT_PIPELINE_STAGES)
    assert.ok(result.some((row) => row.name === stage.name))
})
