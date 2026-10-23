import assert from 'node:assert/strict'
import { before, beforeEach, test } from 'node:test'
import { resetOfficeDatabase } from './office-schema'
import { sql as query, scalar as value, expectError as failure } from './psql'

const DB = 'office_agency_test'
const OWNER = '11111111-1111-4111-8111-111111111111', OTHER = '22222222-2222-4222-8222-222222222222'
const CONTACT = '33333333-3333-4333-8333-333333333333', PROJECT = '44444444-4444-4444-8444-444444444444'
const PRESENTATION = '55555555-5555-4555-8555-555555555555', QUOTE = '66666666-6666-4666-8666-666666666666'
const sql = (s: string) => query(s, DB), scalar = (s: string) => value(s, DB), error = (s: string) => failure(s, DB)
const json = async (s: string) => JSON.parse((await scalar(s))!)
let run: string
const claim = (key = `contact:${CONTACT}`, project: string | null = null) => json(`select to_jsonb(public.claim_office_agency_item('${run}','${key}',${project ? `'${project}'` : 'null'}))`)
const email = (key: string, contact = CONTACT) => json(`select public.create_office_email_draft('${run}','${contact}','${key}','Proposta','https://crm.example.org/proposta/public-token','<p>Proposta</p>','Da rivedere')`)

before(async () => {
  await resetOfficeDatabase(DB, [
    '20260330094500_ai_ready_crm.sql', '20260419120000_team_members.sql', '20260424083000_team_members_auth_user_id.sql',
    '20260425103000_quotes_area.sql', '20260425140000_quote_public_contract_accept.sql',
    '20260521120000_customer_billing_fields.sql', '20260521130000_customer_billing_address_fields.sql',
    '20260521143000_quote_manual_payment_terms.sql', '20260522100000_quote_email_acceptance_gate.sql',
    '20260602100000_crm_performance_fields.sql', '20260616120000_stage_timing.sql', '20260710130000_deals.sql',
    '20260923101000_quote_subscription_signature.sql', '20261020130000_agency.sql', '20261023154445_office_agency.sql',
  ])
  await sql(`insert into auth.users(id) values('${OWNER}'),('${OTHER}')`)
})
beforeEach(async () => {
  await sql(`truncate office_agents,contacts cascade;
    insert into office_agents(id,user_id,name,department,enabled,daily_budget_cents,weekly_budget_cents,monthly_budget_cents)
      values('agency','${OWNER}','Agenzia','agenzia',true,200,1000,4000);
    insert into contacts(id,user_id,name,email,status,contact_scope) values('${CONTACT}','${OWNER}','Cliente','cliente@example.it','Quote','crm');
    insert into agency_projects(id,user_id,contact_id,client_name,title) values('${PROJECT}','${OWNER}','${CONTACT}','Cliente','Sito');
    insert into quotes(id,user_id,contact_id,agency_project_id,quote_number,customer_name,status,sent_at)
      values('${QUOTE}','${OWNER}','${CONTACT}','${PROJECT}','PRV-1','Cliente','draft',now()-interval '8 days');
    insert into agency_presentations(id,user_id,project_id,title,status,public_token,quote_id)
      values('${PRESENTATION}','${OWNER}','${PROJECT}','Proposta','ready','public-token','${QUOTE}');`)
  run = (await json(`select public.claim_office_agent_run('agency','${OWNER}','test')`)).run.id
})

test('CHECK reale accetta agenzia e sviluppo; gli agenti nuovi nascono spenti', async () => {
  await sql(`insert into office_agents(id,user_id,name,department) values('dev','${OWNER}','Sviluppo','sviluppo')`)
  assert.equal(await scalar("select enabled from office_agents where id='dev'"), 'f')
  assert.match((await error(`insert into office_agents(id,user_id,name,department) values('x','${OWNER}','X','inventato')`))!, /department_check/)
})

test('prenotazione concorrente e retry fra corse conservano gli id prima e dopo le creazioni', async () => {
  const attempts = await Promise.all(Array.from({ length: 8 }, () => claim()))
  assert.equal(new Set(attempts.map((item) => item.project_id)).size, 1)
  assert.equal(await scalar('select count(*) from office_agency_items'), '1')
  const item = attempts[0]
  await sql(`insert into agency_projects(id,user_id,contact_id,client_name,title) values('${item.project_id}','${OWNER}','${CONTACT}','Cliente','Nuova');
    insert into agency_presentations(id,user_id,project_id,title) values('${item.presentation_id}','${OWNER}','${item.project_id}','Bozza');
    select public.finish_office_agent_run('${run}','done','Fatto',null,'{}');`)
  run = (await json(`select public.claim_office_agent_run('agency','${OWNER}','next')`)).run.id
  const retry = await claim(`contact:${CONTACT}`, item.project_id)
  assert.equal(retry.project_id, item.project_id); assert.equal(retry.presentation_id, item.presentation_id)
  assert.match(retry.step_keys.project, new RegExp(`:${CONTACT}:project$`))
  assert.equal(await scalar(`select count(*) from agency_presentations where project_id='${item.project_id}'`), '1')
})

test('generazione: un solo claim, budget senza provider recuperabile, esito incerto mai rilanciato', async () => {
  const item = await claim()
  const attempts = await Promise.all(Array.from({ length: 8 }, () => scalar(`select public.claim_office_agency_generation('${run}','${item.id}')`)))
  assert.equal(attempts.filter((v) => v === 't').length, 1)
  await sql(`select public.finish_office_agency_generation('${run}','${item.id}','pending')`)
  assert.equal(await scalar(`select public.claim_office_agency_generation('${run}','${item.id}')`), 't')
  await sql(`select public.finish_office_agency_generation('${run}','${item.id}','uncertain')`)
  assert.equal(await scalar(`select public.claim_office_agency_generation('${run}','${item.id}')`), 'f')
  await sql(`update office_agent_runs set started_at=now()-interval '31 minutes' where id='${run}'`)
  assert.match((await error(`select public.claim_office_agency_generation('${run}','${item.id}')`))!, /non attiva/)
})

test('bozza soltanto con approvazione umana e quote sent/accepted, sempre office pending, unica fra retry', async () => {
  const key = `agency:proposal:${PRESENTATION}`
  assert.equal((await email(key)).reason, 'not_approved')
  await sql(`update agency_presentations set status='approved',approved_at=now() where id='${PRESENTATION}'`)
  assert.equal((await email(key)).reason, 'quote_not_sent')
  await sql(`update quotes set status='sent' where id='${QUOTE}'`)
  const attempts = await Promise.all(Array.from({ length: 8 }, () => email(key)))
  assert.equal(attempts.filter((a) => a.created).length, 1)
  assert.equal(await scalar("select count(*) from email_drafts where source='office' and status='pending'"), '1')
  assert.equal(await scalar('select count(*) from office_agency_deliveries'), '1')
  assert.equal(await scalar('select status from agency_presentations'), 'approved')
  await sql('delete from email_drafts')
  assert.equal((await email(key)).created, false, 'neppure eliminare la bozza crea un secondo invio da preparare')
  assert.equal(await scalar('select count(*) from email_drafts'), '0')
  assert.equal(await scalar('select count(*) from quotes'), '1'); assert.equal(await scalar('select status from quotes'), 'sent')
})

test('accepted consentito, paid/draft no; scope, disiscrizione e bozza pendente su indirizzo gemello bloccano', async () => {
  await sql(`update agency_presentations set status='approved',approved_at=now();update quotes set status='accepted';
    insert into contacts(user_id,name,email,status) values('${OWNER}','Gemello',' CLIENTE@example.it ','Quote');
    insert into email_drafts(user_id,contact_id,subject,body_text,source,status)
      select '${OWNER}',id,'Manuale','Testo','manual','pending' from contacts where name='Gemello';`)
  assert.equal((await email(`agency:proposal:${PRESENTATION}`)).reason, 'pending_draft')
  await sql("update email_drafts set status='dismissed';update quotes set status='paid'")
  assert.equal((await email(`agency:proposal:${PRESENTATION}`)).reason, 'quote_not_sent')
  await sql("update quotes set status='accepted';update contacts set email_unsubscribed_at=now() where name='Cliente'")
  assert.match((await error(`select public.create_office_email_draft('${run}','${CONTACT}','agency:proposal:${PRESENTATION}','A','/proposta/public-token','B','C')`))!, /Contatto non disponibile/)
  await sql("update contacts set email_unsubscribed_at=null where name='Cliente'")
  assert.equal((await email(`agency:proposal:${PRESENTATION}`)).created, true)
})

test('follow-up: risposte per indirizzo gemello o preventivi recenti bloccano senza bozze', async () => {
  await sql(`update quotes set status='sent';insert into gmail_accounts(user_id,email,refresh_token) values('${OWNER}','owner@example.it','simulato') on conflict(user_id) do nothing;
    insert into gmail_messages(user_id,gmail_account_id,direction,from_email,sent_at,gmail_message_id)
    select '${OWNER}',id,'inbound','CLIENTE@example.it',now(),'reply' from gmail_accounts where user_id='${OWNER}'`)
  assert.equal((await email(`agency:followup:${QUOTE}`)).reason, 'reply_received')
  await sql("delete from gmail_messages;update quotes set sent_at=now()-interval '6 days'")
  assert.equal((await email(`agency:followup:${QUOTE}`)).reason, 'quote_not_due')
  assert.equal(await scalar('select count(*) from email_drafts'), '0')
})

test('quota atomica di cinque follow-up al giorno, persistente dopo eliminazioni', async () => {
  const rows: Array<{ contact: string; quote: string }> = []
  for (let i = 1; i <= 8; i++) {
    const contact = `77777777-7777-4777-8777-${String(i).padStart(12, '0')}`, project = `88888888-8888-4888-8888-${String(i).padStart(12, '0')}`, quote = `99999999-9999-4999-8999-${String(i).padStart(12, '0')}`
    await sql(`insert into contacts(id,user_id,name,email,status) values('${contact}','${OWNER}','Cliente ${i}','cliente${i}@example.it','Quote');
      insert into agency_projects(id,user_id,contact_id,client_name,title) values('${project}','${OWNER}','${contact}','Cliente ${i}','Sito ${i}');
      insert into quotes(id,user_id,contact_id,agency_project_id,quote_number,customer_name,status,sent_at)
        values('${quote}','${OWNER}','${contact}','${project}','PRV-${i+1}','Cliente ${i}','sent',now()-interval '8 days');`)
    rows.push({ contact, quote })
  }
  const attempts = await Promise.all(rows.map((r) => email(`agency:followup:${r.quote}`, r.contact)))
  assert.equal(attempts.filter((a) => a.created).length, 5)
  assert.equal(await scalar("select used_count from office_agent_daily_quotas where agent_id='agency'"), '5')
  await sql('delete from email_drafts')
  assert.equal((await email(`agency:followup:${rows[7].quote}`, rows[7].contact)).created, false)
  assert.equal(await scalar('select count(*) from email_drafts'), '0')
})

test('RLS e RPC: cross-workspace e browser non possono creare o prenotare', async () => {
  await claim()
  assert.equal((await sql(`set role authenticated;set request.jwt.claim.sub='${OTHER}';select count(*) from office_agency_items`)).at(-1)?.[0], '0')
  assert.match((await error(`set role authenticated;select public.claim_office_agency_item('${run}','contact:${CONTACT}',null)`))!, /permission denied/)
  assert.match((await error(`set role authenticated;delete from office_agency_deliveries`))!, /permission denied/)
  const alien = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  await sql(`insert into contacts(id,user_id,name,status)values('${alien}','${OTHER}','Altro','New')`)
  assert.match((await error(`select public.claim_office_agency_item('${run}','contact:${alien}',null)`))!, /altro workspace/)
})

test('RPC condivisa dopo la migration: Finanza e Commerciale conservano il percorso esistente', async () => {
  await sql(`delete from gmail_messages;
    insert into office_agents(id,user_id,name,department,enabled) values
      ('finance','${OWNER}','Finanza','finanza',true),('sales_followup','${OWNER}','Commerciale','commerciale',true);`)
  for (const agent of ['finance', 'sales_followup']) {
    const claimed = await json(`select public.claim_office_agent_run('${agent}','${OWNER}','regression')`)
    const args = `'${claimed.run.id}','${CONTACT}','${agent}:regression','Oggetto','Testo','<p>Testo</p>','Nota'`
    assert.equal((await json(`select public.create_office_email_draft(${args})`)).created, true)
    assert.equal((await json(`select public.create_office_email_draft(${args})`)).created, false)
    assert.equal(await scalar(`select count(*) from email_drafts where office_agent_id='${agent}' and status='pending' and source='office'`), '1')
    await sql("update email_drafts set status='dismissed'")
  }
  assert.equal(await scalar("select used_count from office_agent_daily_quotas where agent_id='sales_followup'"), '1')
})
