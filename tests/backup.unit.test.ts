import assert from 'node:assert/strict'
import test from 'node:test'
import { BACKUP_ORDER, BACKUP_TABLES } from '../src/lib/server/backup'

test('il backup non ha tabelle doppie e copre cio che non si rigenera', () => {
  assert.equal(new Set(BACKUP_TABLES).size, BACKUP_TABLES.length)
  for (const table of ['contacts', 'tourism_entities', 'tourism_site_sources', 'shipping_ports', 'trade_fair_exhibitors', 'email_drafts', 'quote_signatures']) {
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
