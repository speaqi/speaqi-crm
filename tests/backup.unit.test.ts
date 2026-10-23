import assert from 'node:assert/strict'
import test from 'node:test'
import { BACKUP_ORDER, BACKUP_TABLES, backupDegraded } from '../src/lib/server/backup'

test('il backup non ha tabelle doppie e copre cio che non si rigenera', () => {
  assert.equal(new Set(BACKUP_TABLES).size, BACKUP_TABLES.length)
  for (const table of ['contacts', 'tourism_entities', 'tourism_site_sources', 'tourism_hubs', 'trade_fair_exhibitors', 'email_drafts', 'quote_signatures', 'office_agents', 'office_agent_runs', 'office_agent_outputs', 'office_budget_ledger']) {
    assert.ok((BACKUP_TABLES as readonly string[]).includes(table), `manca ${table}`)
  }
})

test('storico enorme e segreti restano fuori', () => {
  for (const table of ['tourism_revisions', 'gmail_accounts', 'automation_job_runs']) {
    assert.ok(!(BACKUP_TABLES as readonly string[]).includes(table), `${table} non va nel dump`)
  }
})

test('le tabelle senza id hanno la loro colonna di ordinamento', () => {
  for (const table of Object.keys(BACKUP_ORDER)) {
    assert.ok((BACKUP_TABLES as readonly string[]).includes(table), `${table} non e nell'elenco`)
  }
})

test('un backup e sano con il dump nello Storage e una copia su R2, anche se l\'email e troppo grande', () => {
  assert.equal(backupDegraded({ storage: 'ok', r2: 'ok', email: 'skipped_too_large' }), false)
})

test('senza copia fuori da Supabase, o con R2 in errore, il backup risulta degradato', () => {
  assert.equal(backupDegraded({ storage: 'ok', r2: 'not_configured', email: 'skipped_too_large' }), true)
  assert.equal(backupDegraded({ storage: 'ok', r2: 'R2 403', email: 'skipped_too_large' }), true)
  assert.equal(backupDegraded({ storage: 'boom', r2: 'ok', email: 'ok' }), true)
  assert.equal(backupDegraded({ storage: 'ok', r2: 'not_configured', email: 'ok' }), false)
  assert.equal(backupDegraded({ storage: 'ok', r2: 'not_configured', email: 'disabled' }), false)
})
