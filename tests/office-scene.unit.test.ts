import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Script } from 'node:vm'
import { officeSceneSnapshot } from '../src/lib/office-scene'
import { officeApprovalEffect, type OfficeOverview, type OfficeRun } from '../src/lib/office'
import { UFFICIO_SCENE_HTML } from '../src/lib/server/ufficio-scene'
import { officeAgentActivity, officeResultLink, type OfficeWorkSummary } from '../src/lib/office-activity'
import { officeSceneEvents } from '../src/lib/office-scene-events'

const totals = { day_actual: 20, day_reserved: 10, week_actual: 40, week_reserved: 10, month_actual: 100, month_reserved: 10 }
const overview: OfficeOverview = {
  agents: [{ id: 'research', user_id: 'private-owner', name: 'Ricerca <fonti>', department: 'ricerca', description: 'Legge le fonti', model: 'gpt-5-mini',
    enabled: true, schedule_job: 'private-job', daily_budget_cents: 100, weekly_budget_cents: 500, monthly_budget_cents: 1000,
    settings: { secret: 'must-stay-in-parent', queue: [{ customer: 'private-customer' }] }, spend: { agent_id: 'research', ...totals }, last_run: null }],
  runs: [], outputs: [{ id: 'output', agent_id: 'research', kind: 'report', title: 'Da verificare', body: { email: 'private@example.it' },
    status: 'pending', target_table: 'contacts', target_id: 'private-contact', created_at: '2026-10-23T08:00:00Z', decided_at: null }],
  pending_count: 67, totals, active_agents: 1,
}
const withRun = (status: OfficeRun['status'], enabled = true) => {
  const agent = { ...overview.agents[0], enabled, last_run: { id: 'run', agent_id: 'research', user_id: 'private-owner',
    started_at: '2026-10-23T08:00:00Z', finished_at: null, status, summary: 'Esito dal registro', items_created: 0,
    cost_cents_reserved: 0, cost_cents_actual: 0, error: null, details: { private: 'private-details' } } }
  return officeSceneSnapshot({ ...overview, agents: [agent] }).departments.find((d) => d.id === 'ricerca')!.agents[0]
}

test('il 3D riceve una proiezione senza proprietario, impostazioni, destinatari o corpi delle bozze', () => {
  const result = officeSceneSnapshot(overview, '2026-10-23T09:00:00Z')
  const json = JSON.stringify(result)
  for (const hidden of ['private-owner', 'private-job', 'must-stay-in-parent', 'private-customer', 'private@example.it', 'private-contact']) assert.ok(!json.includes(hidden))
  assert.equal(result.pendingCount, 67, 'il totale non dipende dalla prima pagina di proposte')
  assert.equal(result.departments.find((d) => d.id === 'ricerca')!.agents[0].spend.month_actual, 100, 'i costi restano in centesimi EUR')
  assert.equal(result.departments.find((d) => d.id === 'ricerca')!.agents[0].status, 'ready', 'acceso non significa in esecuzione')
  assert.equal(result.updatedAt, '2026-10-23T09:00:00Z')
})

test('il contatore Aspetta te mostra solo le decisioni anche se la coda contiene rapporti', () => {
  const result = officeSceneSnapshot({ ...overview, pending_count: 23, decision_count: 12 })
  assert.equal(result.pendingCount, 12)
  assert.equal(result.outputs.length, 1, 'i rapporti restano consultabili')
})

test('stati 3D: corso dal registro, problemi visibili e interruttore spento rispettato', () => {
  assert.equal(withRun('running').status, 'running')
  assert.equal(withRun('running', false).status, 'running', 'spegnere impedisce nuove corse, non cancella una corsa esistente')
  for (const status of ['failed', 'partial', 'skipped_budget'] as const) assert.equal(withRun(status).status, 'attention')
  assert.equal(withRun('failed', false).status, 'off')
  assert.equal(withRun('done').status, 'ready')
})

const work = (status: OfficeWorkSummary['status'], id = 'work'): OfficeWorkSummary => ({
  id, agent_id: 'research', action: 'verify_tourism_entity', status, origin: 'order', order_id: 'order',
  created_at: '2026-10-26T08:00:00Z', updated_at: '2026-10-26T08:00:00Z', reason: 'Fonte ufficiale da completare',
  required_action: 'Indica il sito', result_summary: '',
})

test('un incarico bloccato resta visibile anche dopo una corsa conclusa senza documento', () => {
  const agent = { ...overview.agents[0], last_run: { status: 'done', summary: 'Ente non verificato' } as OfficeRun }
  const result = officeSceneSnapshot({ ...overview, agents: [agent], works: [work('blocked')] })
  const person = result.departments.flatMap((d) => d.agents)[0]
  assert.equal(person.status, 'attention'); assert.equal(person.activityLabel, 'Bloccato')
  assert.equal(person.currentWork?.requiredAction, 'Indica il sito')
  assert.equal(officeAgentActivity(agent, [work('running'), work('blocked', 'other')]).key, 'running')
  assert.equal(officeAgentActivity({ ...agent, enabled: false }, [work('blocked')]).key, 'off')
  assert.equal(officeAgentActivity(agent, [work('waiting_owner')]).label, 'Aspetta te')
  assert.equal(officeAgentActivity(agent, [{ ...work('blocked'), agent_id: 'finance' }]).key, 'ready')
})

test('il 3D non riceve payload, risultati grezzi o token degli incarichi', () => {
  const raw = { ...work('blocked'), payload: { secret: 'hidden-payload' }, checkpoint: 'hidden-checkpoint', lease_token: 'hidden-lease',
    result: { email: 'hidden-result' }, user_id: 'hidden-owner' }
  const json = JSON.stringify(officeSceneSnapshot({ ...overview, works: [raw] }))
  for (const hidden of ['hidden-payload', 'hidden-checkpoint', 'hidden-lease', 'hidden-result', 'hidden-owner']) assert.ok(!json.includes(hidden))
})

test('messaggi 3D: prima lettura silenziosa, assegnazione e risultato una volta per cambiamento', () => {
  const before = officeSceneSnapshot({ ...overview, outputs: [], works: [] })
  const assigned = officeSceneSnapshot({ ...overview, outputs: [], works: [work('ready')] })
  assert.deepEqual(officeSceneEvents(null, assigned), [])
  assert.deepEqual(officeSceneEvents(before, assigned), [{ key: 'assigned:work', from: 'director', to: 'research' }])
  assert.deepEqual(officeSceneEvents(assigned, assigned), [])
  const completed = officeSceneSnapshot({ ...overview, outputs: [], works: [work('succeeded')] })
  assert.deepEqual(officeSceneEvents(assigned, completed), [{ key: 'result:work', from: 'research', to: 'kiosk' }])
  assert.deepEqual(officeSceneEvents(completed, completed), [])
  assert.equal(officeSceneEvents(before, completed).length, 2, 'i lavori rapidi fra due letture mostrano assegnazione ed esito')
  assert.deepEqual(officeSceneEvents(before, officeSceneSnapshot({ ...overview, outputs: [], works: [{ ...work('ready'), order_id: null }] })), [])
})

test('risultati apribili: solo percorsi interni con identificativi validi', () => {
  const id = '11111111-1111-4111-8111-111111111111'
  assert.equal(officeResultLink({ deck_id: id })?.href, `/tourism/presentazioni/${id}`)
  assert.equal(officeResultLink({ invoice_id: id })?.href, `/fatture?invoice=${id}`)
  assert.equal(officeResultLink({ deck_id: 'https://other.invalid', url: 'javascript:alert(1)' }), null)
})

test('workspace vuoto: nessuna persona inventata e otto reparti navigabili, Sviluppo compreso', () => {
  const result = officeSceneSnapshot({ ...overview, agents: [], outputs: [], pending_count: 0 })
  assert.equal(result.departments.length, 8)
  assert.ok(result.departments.some((d) => d.id === 'sviluppo'))
  assert.ok(result.departments.every((d) => d.agents.length === 0))
})

test('approvazioni: la UI anticipa unioni, import, code e aggiornamenti', () => {
  const effect = (agent_id: string, kind: 'proposal' | 'data_fix', action: string) => officeApprovalEffect({ agent_id, kind, body: { action } })
  assert.equal(effect('db_cleaner', 'data_fix', 'merge_contacts').label, 'Approva e unisci')
  assert.equal(effect('entity_enricher', 'proposal', 'enrich_entity').label, 'Approva e importa nel CRM')
  assert.equal(effect('director', 'proposal', 'build_map').label, 'Approva e accoda')
  assert.equal(effect('languages_voice', 'proposal', 'refresh_outdated').label, 'Approva aggiornamento')
  assert.equal(effect('other', 'data_fix', 'merge_contacts').label, 'Approva')
  assert.equal(officeApprovalEffect({ agent_id: 'events_scout', kind: 'task', body: { action: 'decide_event_participation' } }).label, 'Approva e crea To Do')
  assert.match(officeApprovalEffect({ agent_id: 'finance', kind: 'report', body: {} }).description, /Non invia/)
})

test('bundle 3D autonomo: JavaScript valido anche con shader e nessuna CDN a runtime', () => {
  const start = UFFICIO_SCENE_HTML.indexOf('<script>') + '<script>'.length
  const end = UFFICIO_SCENE_HTML.lastIndexOf('</script>')
  assert.ok(start > 7 && end > start)
  assert.doesNotThrow(() => new Script(UFFICIO_SCENE_HTML.slice(start, end)))
  assert.ok(!UFFICIO_SCENE_HTML.includes('cdn.jsdelivr.net'))
  assert.ok(!UFFICIO_SCENE_HTML.includes('type="importmap"'))
  assert.ok(!UFFICIO_SCENE_HTML.includes('SCENE_SCRIPT'))
})
