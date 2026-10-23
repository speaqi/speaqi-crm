import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { batchGroups, chooseKeeper, connectDuplicates, groupKey, planDuplicateGroup, type CleanerContact } from '../src/lib/office/db-cleaner'
import { dbCleanerHandler } from '../src/lib/server/office-agents/db-cleaner'
import { OFFICE_AGENT_DEFINITIONS } from '../src/lib/server/office-agents/definitions'
import { OFFICE_AGENT_HANDLERS } from '../src/lib/server/office-agents/registry'
import { AUTOMATION_JOBS } from '../src/lib/automation-schedule'
import type { AgentContext } from '../src/lib/server/office-agents'
import { FakeSupabase } from './fake-supabase'

const OWNER = 'owner'
const contact = (id: string, patch: Partial<CleanerContact> = {}): CleanerContact => ({ id, name: `Contatto ${id}`, email: null, phone: null, company: null,
  billing_city: null, status: 'New', contact_scope: 'holding', created_at: `2026-01-0${id.length}T00:00:00Z`, activities: 0, tasks: 0, deals: 0, open_deals: 0,
  quotes: 0, drafts: 0, emails: 0, in_sequence: false, ...patch })

describe('Pulizia: regole pure', () => {
  test('chiavi diverse che si toccano fanno un gruppo solo', () => {
    const groups = connectDuplicates([
      { kind: 'email', key: 'a@x.it', ids: ['1', '2'] },
      { kind: 'phone', key: '39333', ids: ['2', '3'] },
      { kind: 'company', key: 'b|roma', ids: ['8', '9'] },
      { kind: 'email', key: 'solo@x.it', ids: ['5'] },
    ])
    assert.deepEqual(groups.map((g) => g.ids), [['1', '2', '3'], ['8', '9']])
    assert.deepEqual(groups[0].matched, ['email', 'phone'])
  })

  test('si tiene chi ha più storia, poi il più vecchio', () => {
    assert.equal(chooseKeeper([contact('a'), contact('bb', { deals: 1 })]).id, 'bb')
    assert.equal(chooseKeeper([contact('bb'), contact('a')]).id, 'a')
    assert.equal(chooseKeeper([contact('a'), contact('bb', { contact_scope: 'crm' })]).id, 'bb')
  })

  test('rischio e blocchi: pipeline, sola azienda, sequenze e trattative', () => {
    const byId = (list: CleanerContact[]) => new Map(list.map((c) => [c.id, c]))
    assert.equal(planDuplicateGroup(['a', 'bb'], ['email'], byId([contact('a'), contact('bb')]))!.risk, 'safe')
    assert.equal(planDuplicateGroup(['a', 'bb'], ['company'], byId([contact('a'), contact('bb')]))!.risk, 'review')
    assert.equal(planDuplicateGroup(['a', 'bb'], ['email'], byId([contact('a'), contact('bb', { contact_scope: 'crm' })]))!.risk, 'review')
    assert.equal(planDuplicateGroup(['a', 'bb'], ['email'], byId([contact('a'), contact('bb', { quotes: 1 })]))!.risk, 'review')
    assert.match(planDuplicateGroup(['a', 'bb'], ['email'], byId([contact('a'), contact('bb', { in_sequence: true })]))!.blocked!, /sequenza/)
    assert.match(planDuplicateGroup(['a', 'bb'], ['email'], byId([contact('a', { open_deals: 1 }), contact('bb', { open_deals: 1 })]))!.blocked!, /2 trattative/)
    assert.equal(planDuplicateGroup(['a', 'zz'], ['email'], byId([contact('a')])), null)
  })

  test('lotti da venti, revisioni una per una, bloccati fuori', () => {
    const map = new Map<string, CleanerContact>()
    const groups = Array.from({ length: 45 }, (_, i) => {
      const a = contact(`a${i}`); const b = contact(`b${i}`, { in_sequence: i === 0 })
      map.set(a.id, a); map.set(b.id, b)
      return planDuplicateGroup([a.id, b.id], i % 10 === 9 ? ['company'] : ['email'], map)!
    })
    const { batches, review, blocked } = batchGroups(groups)
    assert.deepEqual(batches.map((b) => b.length), [20, 20])
    assert.equal(review.length, 4); assert.equal(blocked.length, 1)
    assert.equal(groupKey({ keep: 'b', drop: ['c', 'a'] }), 'a+b+c')
  })
})

describe('Pulizia: handler', () => {
  function fixture(previous: any[] = []) {
    const contacts = [contact('a', { email: 'x@x.it', activities: 3 }), contact('bb', { email: 'x@x.it' }), contact('c', { company: 'Hotel', billing_city: 'Capri', contact_scope: 'crm' }), contact('dd', { company: 'Hotel', billing_city: 'Capri' })]
    const db = new FakeSupabase({ office_agent_outputs: [...previous] }, {
      office_cleaner_duplicate_keys: () => [{ kind: 'email', key: 'x@x.it', ids: ['a', 'bb'] }, { kind: 'company', key: 'hotel|capri', ids: ['c', 'dd'] }],
      office_cleaner_contacts: (args) => contacts.filter((c) => args.p_ids.includes(c.id)).map((c) => ({ ...c, activities: String(c.activities) })),
      office_cleaner_scan: () => ({ invalid_emails: { count: 2, sample: [{ id: 'z' }] }, pec_emails: { count: 0, sample: [] } }),
      office_merge_contacts: () => { throw new Error('L’agente non deve mai unire da solo') },
      decide_office_output: () => { throw new Error('L’agente non decide') },
    })
    const ctx: AgentContext = { agent: { ...OFFICE_AGENT_DEFINITIONS.db_cleaner, user_id: OWNER }, runId: 'run',
      async reserve() { assert.fail('La pulizia non spende') }, async settle() { assert.fail() }, log() {},
      async addOutput(output) { const row = { id: db.nextId('output'), agent_id: 'db_cleaner', user_id: OWNER, status: 'pending', created_at: '2026-10-25T00:00:00Z', output_key: output.key, ...output }; db.tables.office_agent_outputs.push(row); return row.id },
    }
    return { db, ctx }
  }
  const run = (f: ReturnType<typeof fixture>) => dbCleanerHandler(f.db, () => new Date('2026-10-25T04:30:00Z'))(f.ctx)

  test('propone un lotto sicuro, una revisione, gli elenchi e il resoconto; non modifica nulla', async () => {
    const f = fixture()
    const result = await run(f)
    const outputs = f.db.tables.office_agent_outputs
    const merges = outputs.filter((o) => o.body.action === 'merge_contacts')
    assert.equal(merges.length, 2)
    assert.deepEqual(merges[0].body.groups.map((g: any) => [g.keep, g.drop]), [['a', ['bb']]])
    assert.equal(merges[1].target_id, 'c'); assert.match(merges[1].title, /da controllare/)
    assert.equal(outputs.filter((o) => o.body.action === 'review_list').length, 1)
    assert.equal(outputs.filter((o) => o.kind === 'report').length, 1)
    assert.match(result!.summary, /2 proposte di unione/)
  })

  test('una seconda corsa non duplica; un gruppo rifiutato non torna', async () => {
    const f = fixture()
    await run(f)
    const count = f.db.tables.office_agent_outputs.length
    await run(f)
    assert.equal(f.db.tables.office_agent_outputs.length, count)
    const g = fixture([{ id: 'old', agent_id: 'db_cleaner', user_id: OWNER, kind: 'data_fix', status: 'rejected', created_at: '2026-10-01T00:00:00Z', output_key: 'x', body: { groups: [{ key: 'a+bb' }] } }])
    await run(g)
    assert.equal(g.db.tables.office_agent_outputs.filter((o) => o.body.action === 'merge_contacts' && o.id !== 'old').length, 1)
  })

  test('installazione: spento, registrato, pianificato la domenica', () => {
    assert.equal(OFFICE_AGENT_DEFINITIONS.db_cleaner.enabled, false)
    assert.ok(OFFICE_AGENT_HANDLERS.db_cleaner)
    const job = AUTOMATION_JOBS.find((j) => j.name === 'office-db-cleaner')!
    assert.equal(job.cron, '30 4 * * 0'); assert.equal(job.steps[0].path, '/api/automation/agents/db_cleaner/run')
  })
})
