import assert from 'node:assert/strict'
import { test } from 'node:test'
import { officeSchemaSql } from './office-schema'
import { PGlite } from '@electric-sql/pglite'

const OWNER = '11111111-1111-4111-8111-111111111111'
const CONTACT = '22222222-2222-4222-8222-222222222222'
test('Finanza: RPC bozze idempotente, cross-workspace rifiutato e source auto vietata', async () => {
  const db = new PGlite()
  try {
    await db.exec(await officeSchemaSql())
    await db.exec(`insert into auth.users(id) values('${OWNER}');
      insert into office_agents(id,user_id,name,department,enabled) values('finance','${OWNER}','Finanza','finanza',true);
      insert into contacts(id,user_id,name,email,status) values('${CONTACT}','${OWNER}','Ente','ufficio@example.it','New');`)
    const claim = await db.query<{ run: { id: string } }>(`select (public.claim_office_agent_run('finance','${OWNER}','chiave-di-test')->'run') as run`)
    const run = claim.rows[0].run.id
    const call = `select public.create_office_email_draft('${run}','${CONTACT}','finance:bonifico:q','Promemoria','Testo','<p>Testo</p>','Da rivedere') as draft`
    await db.exec(call); await db.exec(call)
    assert.equal((await db.query<{ n: number }>('select count(*)::int as n from email_drafts')).rows[0].n, 1)
    assert.equal((await db.query<{ source: string }>('select source from email_drafts')).rows[0].source, 'office')
    await assert.rejects(db.exec("update email_drafts set source='auto'"), /email_drafts_office_manual/)
    await assert.rejects(db.exec(`select public.create_office_email_draft('${run}','33333333-3333-4333-8333-333333333333','altra','A','B','B','C')`), /Contatto non disponibile/)
    await db.exec('set role authenticated')
    await assert.rejects(db.exec(call), /permission denied/)
  } finally { await db.close() }
})
