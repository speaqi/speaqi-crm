import test from 'node:test'
import assert from 'node:assert/strict'
import { tourismOpportunityPlan } from '../src/lib/opportunities'
import { syncTourismOpportunities } from '../src/lib/server/tourism-opportunity'

test('tipo di ente → pipeline', () => {
  assert.equal(tourismOpportunityPlan('dmo')?.pipeline, 'tourism')
  assert.equal(tourismOpportunityPlan('NTO')?.role, 'destinazione')
  assert.equal(tourismOpportunityPlan('dmc')?.pipeline, 'distribuzione')
  assert.equal(tourismOpportunityPlan('tour_operator')?.role, 'distributore')
  assert.equal(tourismOpportunityPlan('technology'), null)
  assert.equal(tourismOpportunityPlan(null), null)
})

/** Supabase finto: tabelle in memoria, filtri eq/in, insert con l'indice unico delle opportunità aperte. */
function fakeAdmin(tables: Record<string, any[]>) {
  return {
    from(table: string) {
      const filters: Array<(row: any) => boolean> = []
      const q: any = {
        select: () => q,
        eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), q),
        in: (k: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[k])), q),
        limit: () => q,
        maybeSingle: async () => ({ data: (tables[table] || []).filter((r) => filters.every((f) => f(r)))[0] || null, error: null }),
        then: (resolve: any) => resolve({ data: (tables[table] || []).filter((r) => filters.every((f) => f(r))), error: null }),
        insert: async (row: any) => {
          const rows = (tables[table] ||= [])
          if (rows.some((r) => r.contact_id === row.contact_id && r.pipeline === row.pipeline && !r.closed_at)) return { error: { code: '23505' } }
          rows.push(row)
          return { error: null }
        },
      }
      return q
    },
  }
}

test('ogni ente collegato riceve la sua opportunità, una volta sola, e una chiusa non si riapre', async () => {
  const tables: Record<string, any[]> = {
    tourism_crm_links: [
      { user_id: 'u', entity_id: 'e1', contact_id: 'c1' },
      { user_id: 'u', entity_id: 'e2', contact_id: 'c2' },
      { user_id: 'u', entity_id: 'e3', contact_id: 'c3' },
      { user_id: 'u', entity_id: 'e4', contact_id: 'c4' },
    ],
    tourism_entities: [
      { user_id: 'u', id: 'e1', name: 'Visit Bergamo', type_code: 'dmo' },
      { user_id: 'u', id: 'e2', name: 'Sicily DMC', type_code: 'dmc' },
      { user_id: 'u', id: 'e3', name: 'Software srl', type_code: 'technology' },
      { user_id: 'u', id: 'e4', name: 'Visit Lecce', type_code: 'dmo' },
    ],
    deals: [{ user_id: 'u', contact_id: 'c4', pipeline: 'tourism', closed_at: '2026-10-01' }],
  }
  const admin = fakeAdmin(tables)
  const first = await syncTourismOpportunities(admin, 'u', new Date('2026-10-28T10:00:00Z'))
  assert.equal(first.opened, 2)
  const opened = tables.deals.filter((d) => !d.closed_at)
  assert.deepEqual(opened.map((d) => [d.contact_id, d.pipeline, d.role, d.entity_id]).sort(), [
    ['c1', 'tourism', 'destinazione', 'e1'], ['c2', 'distribuzione', 'distributore', 'e2'],
  ])
  assert.equal(opened[0].next_step_due, '2026-10-30T10:00:00.000Z')
  const again = await syncTourismOpportunities(admin, 'u')
  assert.equal(again.opened, 0)
})
