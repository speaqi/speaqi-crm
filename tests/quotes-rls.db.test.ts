/**
 * Preventivi su Postgres vero, con tutte le migration di produzione in ordine:
 * scrittura legata all'area Preventivi, cancellazione al titolare, importi
 * fermi dopo la firma, obiettivi legati all'area Finanza.
 */
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { before, test } from 'node:test'
import { sql as query, expectError as failure } from './psql'

const DB = 'quotes_rls_test'
const OWNER = '11111111-1111-4111-8111-111111111111'
const CARLA = '22222222-2222-4222-8222-222222222222' // assegnata, senza area Preventivi
const DARIO = '33333333-3333-4333-8333-333333333333' // assegnato, con area Preventivi
const ELSA = '44444444-4444-4444-8444-444444444444' // solo area Finanza
const CONTACT_A = '55555555-5555-4555-8555-00000000000a'
const CONTACT_B = '55555555-5555-4555-8555-00000000000b'
const QUOTE_A = '66666666-6666-4666-8666-00000000000a'
const QUOTE_B = '66666666-6666-4666-8666-00000000000b'
const MIGRATION = '20261027100000_quotes_signed_freeze_and_write_areas.sql'

const sql = (s: string) => query(s, DB)
const expectError = (s: string) => failure(s, DB)
const migrationsDir = new URL('../supabase/migrations/', import.meta.url)

/** Una sessione psql per chiamata: ruolo e utente non passano alla query dopo. */
async function asUser(user: string, statement: string) {
  const rows = await sql(
    `set role authenticated; set request.jwt.claim.sub='${user}'; set request.jwt.claims='{"sub":"${user}"}'; ${statement}`
  )
  return rows.at(-1)?.[0] ?? null
}

before(async () => {
  await promisify(execFile)('bash', [fileURLToPath(new URL('./db.sh', import.meta.url)), 'reset-office', DB])
  await sql(await readFile(new URL('./sql/office-auth.sql', import.meta.url), 'utf8'))
  const files = (await readdir(migrationsDir)).filter((file) => file.endsWith('.sql')).sort()
  assert.ok(files.includes(MIGRATION))
  for (const file of files) await sql(await readFile(new URL(file, migrationsDir), 'utf8'))
  // Le migration si rilanciano: una seconda applicazione non deve fallire.
  await sql(await readFile(new URL(MIGRATION, migrationsDir), 'utf8'))
  // Su Supabase "authenticated" ha questi permessi di default: decide la RLS.
  await sql(`grant usage on schema public to authenticated;
    grant select, insert, update, delete on public.quotes, public.business_goals, public.contacts, public.team_members to authenticated`)

  await sql(`
    insert into auth.users(id) values ('${OWNER}'), ('${CARLA}'), ('${DARIO}'), ('${ELSA}');
    insert into team_members(user_id, name, auth_user_id, allowed_areas) values
      ('${OWNER}', 'Carla', '${CARLA}', null),
      ('${OWNER}', 'Dario', '${DARIO}', array['contatti','preventivi']),
      ('${OWNER}', 'Elsa', '${ELSA}', array['finanza']);
    insert into contacts(id, user_id, name, status, responsible) values
      ('${CONTACT_A}', '${OWNER}', 'Cliente A', 'Quote', 'Carla'),
      ('${CONTACT_B}', '${OWNER}', 'Cliente B', 'Quote', 'Dario');
    insert into quotes(id, user_id, contact_id, quote_number, customer_name, status, items, total_amount, tax_rate) values
      ('${QUOTE_A}', '${OWNER}', '${CONTACT_A}', 'PREV-A', 'Cliente A', 'sent', '[{"description":"Video","unit_price":400}]', 488, 22),
      ('${QUOTE_B}', '${OWNER}', '${CONTACT_B}', 'PREV-B', 'Cliente B', 'sent', '[{"description":"Video","unit_price":400}]', 488, 22);
  `)
})

test('la lettura resta quella di prima: chi è assegnato vede i preventivi del suo contatto', async () => {
  assert.equal(await asUser(CARLA, `select count(*) from quotes where id = '${QUOTE_A}'`), '1')
  assert.equal(await asUser(CARLA, `select count(*) from quotes where id = '${QUOTE_B}'`), '0')
  assert.equal(await asUser(OWNER, 'select count(*) from quotes'), '2')
})

test('senza area Preventivi non si modifica, con l’area sì', async () => {
  await asUser(CARLA, `update quotes set title = 'cambiato da Carla' where id = '${QUOTE_A}'`)
  const [[titleA]] = await sql(`select coalesce(title, '') from quotes where id = '${QUOTE_A}'`)
  assert.notEqual(titleA, 'cambiato da Carla')

  await asUser(DARIO, `update quotes set title = 'cambiato da Dario' where id = '${QUOTE_B}'`)
  const [[titleB]] = await sql(`select title from quotes where id = '${QUOTE_B}'`)
  assert.equal(titleB, 'cambiato da Dario')
})

test('senza area Preventivi non si crea', async () => {
  const error = await expectError(
    `set role authenticated; set request.jwt.claim.sub='${CARLA}'; insert into quotes(user_id, contact_id, quote_number, customer_name) values ('${OWNER}', '${CONTACT_A}', 'PREV-X', 'X')`
  )
  assert.match(String(error), /row-level security/)
})

test('cancellare resta al titolare', async () => {
  await asUser(DARIO, `delete from quotes where id = '${QUOTE_B}'`)
  const [[count]] = await sql(`select count(*) from quotes where id = '${QUOTE_B}'`)
  assert.equal(count, '1')
})

test('dopo la firma righe e importi non cambiano, lo stato sì', async () => {
  await sql(`update quotes set contract_accepted_at = now(), status = 'accepted' where id = '${QUOTE_B}'`)

  const amount = await expectError(`update quotes set total_amount = 1 where id = '${QUOTE_B}'`)
  assert.match(String(amount), /già stato accettato/)
  const items = await expectError(`update quotes set items = '[]' where id = '${QUOTE_B}'`)
  assert.match(String(items), /già stato accettato/)
  const tax = await expectError(`update quotes set tax_rate = 0 where id = '${QUOTE_B}'`)
  assert.match(String(tax), /già stato accettato/)
  // Anche chi ha l'area Preventivi, scrivendo con la sua sessione.
  const viaRest = await expectError(
    `set role authenticated; set request.jwt.claim.sub='${DARIO}'; update quotes set total_amount = 1 where id = '${QUOTE_B}'`
  )
  assert.match(String(viaRest), /già stato accettato/)

  // Riscrivere gli stessi valori, segnare pagato, aggiornare i dati di fatturazione: ammesso.
  await sql(`update quotes set items = items, total_amount = total_amount where id = '${QUOTE_B}'`)
  await sql(`update quotes set status = 'paid', payment_state = 'paid', paid_at = now(), customer_tax_id = 'IT1' where id = '${QUOTE_B}'`)
  const [[status, total]] = await sql(`select status, total_amount from quotes where id = '${QUOTE_B}'`)
  assert.equal(status, 'paid')
  assert.equal(total, '488.00')

  // Prima della firma si modifica come prima.
  await sql(`update quotes set total_amount = 366 where id = '${QUOTE_A}'`)
})

test('obiettivi aziendali: solo titolare e area Finanza', async () => {
  await sql(`insert into business_goals(user_id, period_type, period_start, target_amount) values ('${OWNER}', 'monthly', '2026-10-01', 1000)`)
  assert.equal(await asUser(ELSA, 'select count(*) from business_goals'), '1')
  assert.equal(await asUser(CARLA, 'select count(*) from business_goals'), '0')
  const error = await expectError(
    `set role authenticated; set request.jwt.claim.sub='${CARLA}'; insert into business_goals(user_id, period_type, period_start, target_amount) values ('${OWNER}', 'monthly', '2026-11-01', 1)`
  )
  assert.match(String(error), /row-level security/)
})
