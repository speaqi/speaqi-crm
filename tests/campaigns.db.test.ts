/**
 * Test di integrazione e concorrenza sul motore campagne.
 *
 * Girano su un Postgres locale vero (tests/db.sh): lock, trigger e vincoli non
 * si possono verificare su un client finto.
 */
import assert from 'node:assert/strict'
import { before, describe, test } from 'node:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { expectError, psqlArgs, resetDatabase, scalar, sql } from './psql'

const run = promisify(execFile)

const USER = '11111111-1111-1111-1111-111111111111'
const CAMPAIGN = '22222222-2222-2222-2222-222222222222'

async function seed() {
  await sql(`
    insert into auth.users (id, email) values ('${USER}', 'titolare@speaqi.com') on conflict do nothing;
    insert into public.commercial_campaigns (id, user_id, vertical, name, slug, list_name, event_tag,
      status, approval_status, daily_cap, daily_enrollment_cap)
    values ('${CAMPAIGN}', '${USER}', 'consorzi', 'Consorzi 2026', 'consorzi-2026', 'Consorzi',
      'consorzi-2026', 'active', 'approved', 100, 30);
  `)
}

async function addContact(index: number) {
  const id = `33333333-3333-3333-3333-${String(index).padStart(12, '0')}`
  await sql(`
    insert into public.contacts (id, user_id, name, email, status, event_tag, marketing_eligibility)
    values ('${id}', '${USER}', 'Contatto ${index}', 'c${index}@example.it', 'New', 'consorzi-2026', 'eligible');
  `)
  return id
}

async function enroll(contactId: string, email: string) {
  const rows = await sql(`
    insert into public.commercial_enrollments (campaign_id, contact_id, structure_key, primary_email, active_email, status, next_step_at)
    values ('${CAMPAIGN}', '${contactId}', 'email:${email}', '${email}', '${email}', 'active', now() - interval '1 hour')
    returning id;
  `)
  const enrollmentId = rows[0][0]
  await sql(`
    insert into public.commercial_messages (enrollment_id, step_number, attempt_number, recipient_email, scheduled_at, status)
    values ('${enrollmentId}', 1, 1, '${email}', now() - interval '1 hour', 'scheduled');
  `)
  return enrollmentId
}

async function clearAudience() {
  await sql(`
    delete from public.commercial_enrollments where campaign_id = '${CAMPAIGN}';
    delete from public.commercial_suppressions where user_id = '${USER}';
    delete from public.contacts where user_id = '${USER}';
  `)
}

before(async () => {
  await resetDatabase()
  await seed()
})

describe('schema del motore campagne', () => {
  test('i filtri di import nascono vuoti e i tetti sono distinti', async () => {
    const row = await sql(`
      select import_exclude_keyword is null, import_required_country is null, daily_cap, daily_enrollment_cap
      from public.commercial_campaigns where id = '${CAMPAIGN}';
    `)
    assert.deepEqual(row[0], ['t', 't', '100', '30'])
  })

  test('lo slug e unico per utente', async () => {
    const error = await expectError(`
      insert into public.commercial_campaigns (user_id, vertical, name, slug, list_name, event_tag)
      values ('${USER}', 'gal', 'Altro nome', 'consorzi-2026', 'GAL', 'gal-2026');
    `)
    assert.match(String(error), /commercial_campaigns_user_slug_unique/)
  })

  test('uno slug malformato viene rifiutato', async () => {
    const error = await expectError(`
      insert into public.commercial_campaigns (user_id, vertical, name, slug, list_name, event_tag)
      values ('${USER}', 'gal', 'GAL', 'Slug Con Spazi', 'GAL', 'gal-2026');
    `)
    assert.match(String(error), /commercial_campaigns_slug_format_check/)
  })
})

describe('immutabilita', () => {
  test('lo slug non si puo cambiare una volta assegnato', async () => {
    const error = await expectError(`update public.commercial_campaigns set slug = 'altro' where id = '${CAMPAIGN}';`)
    assert.match(String(error), /commercial_campaign_slug_immutable/)
  })

  test('lo step non inviato resta modificabile', async () => {
    await sql(`
      insert into public.commercial_campaign_steps (campaign_id, step_number, day_offset, subject_template, body_text_template, body_html_template)
      values ('${CAMPAIGN}', 1, 1, 'Oggetto', 'Testo', '<p>Testo</p>') on conflict do nothing;
    `)
    await sql(`
      update public.commercial_campaign_steps set body_text_template = 'Testo corretto'
      where campaign_id = '${CAMPAIGN}' and step_number = 1;
    `)
    assert.equal(
      await scalar(`select body_text_template from public.commercial_campaign_steps where campaign_id = '${CAMPAIGN}' and step_number = 1;`),
      'Testo corretto'
    )
  })

  test('lo step gia inviato non si riscrive e non si cancella', async () => {
    const contactId = await addContact(90)
    const enrollmentId = await enroll(contactId, 'c90@example.it')
    await sql(`update public.commercial_messages set status = 'sent', sent_at = now() where enrollment_id = '${enrollmentId}';`)

    const updateError = await expectError(`
      update public.commercial_campaign_steps set body_text_template = 'Riscritto'
      where campaign_id = '${CAMPAIGN}' and step_number = 1;
    `)
    assert.match(String(updateError), /commercial_step_immutable/)

    const deleteError = await expectError(`delete from public.commercial_campaign_steps where campaign_id = '${CAMPAIGN}' and step_number = 1;`)
    assert.match(String(deleteError), /commercial_step_immutable/)

    await clearAudience()
  })
})

describe('tetto arruolamenti atomico', () => {
  test('la prenotazione si ferma al tetto e i posti non usati tornano liberi', async () => {
    const day = '2026-09-03'
    await sql(`delete from public.commercial_campaign_daily_counters where campaign_id = '${CAMPAIGN}';`)

    assert.equal(await scalar(`select public.reserve_commercial_enrollment_slots('${CAMPAIGN}', 25, '${day}');`), '25')
    assert.equal(await scalar(`select public.reserve_commercial_enrollment_slots('${CAMPAIGN}', 25, '${day}');`), '5')
    assert.equal(await scalar(`select public.reserve_commercial_enrollment_slots('${CAMPAIGN}', 25, '${day}');`), '0')

    // Il primo giro ne ha usati 20 su 25: cinque posti tornano disponibili.
    await sql(`select public.settle_commercial_enrollment_slots('${CAMPAIGN}', 25, 20, '${day}');`)
    assert.equal(await scalar(`select public.reserve_commercial_enrollment_slots('${CAMPAIGN}', 25, '${day}');`), '5')
  })

  test('otto worker in parallelo non superano il tetto', async () => {
    const day = '2026-09-04'
    await sql(`delete from public.commercial_campaign_daily_counters where campaign_id = '${CAMPAIGN}' and local_day = '${day}';`)

    const attempts = await Promise.all(
      Array.from({ length: 8 }, () =>
        run('psql', psqlArgs(`select public.reserve_commercial_enrollment_slots('${CAMPAIGN}', 10, '${day}');`))
          .then(({ stdout }) => Number(stdout.trim()))
      )
    )

    const total = attempts.reduce((sum, value) => sum + value, 0)
    assert.equal(total, 30, `posti concessi: ${attempts.join(', ')}`)
    assert.equal(
      await scalar(`select enrolled_reserved from public.commercial_campaign_daily_counters where campaign_id = '${CAMPAIGN}' and local_day = '${day}';`),
      '30'
    )
  })
})

describe('claim degli invii', () => {
  test('esclude disiscritti, non idonei e indirizzi soppressi', async () => {
    await clearAudience()

    const ok = await addContact(1)
    const unsubscribed = await addContact(2)
    const notEligible = await addContact(3)
    const suppressed = await addContact(4)
    await sql(`update public.contacts set email_unsubscribed_at = now() where id = '${unsubscribed}';`)
    await sql(`update public.contacts set marketing_eligibility = 'review' where id = '${notEligible}';`)
    // Soppressione per email: la struttura registrata e diversa, l'indirizzo no.
    await sql(`
      insert into public.commercial_suppressions (user_id, structure_key, email, reason, source)
      values ('${USER}', 'struttura-diversa', 'c4@example.it', 'unsubscribe', 'acumbamail');
    `)

    const contacts = [ok, unsubscribed, notEligible, suppressed]
    for (let index = 0; index < contacts.length; index += 1) {
      await enroll(contacts[index], `c${index + 1}@example.it`)
    }

    const claimed = await sql(`select recipient_email from public.claim_commercial_messages('${CAMPAIGN}', 50, false);`)
    assert.deepEqual(claimed.map((row) => row[0]), ['c1@example.it'])
  })

  test('il tetto invii limita il claim indipendentemente dagli arruolamenti', async () => {
    await clearAudience()
    await sql(`update public.commercial_campaigns set daily_cap = 3 where id = '${CAMPAIGN}';`)
    for (let index = 10; index < 20; index += 1) {
      const contactId = await addContact(index)
      await enroll(contactId, `c${index}@example.it`)
    }
    const claimed = await sql(`select id from public.claim_commercial_messages('${CAMPAIGN}', 50, false);`)
    assert.equal(claimed.length, 3)
    await sql(`update public.commercial_campaigns set daily_cap = 100 where id = '${CAMPAIGN}';`)
  })

  test('una campagna in pausa non concede invii reali', async () => {
    await sql(`update public.commercial_campaigns set status = 'paused' where id = '${CAMPAIGN}';`)
    const error = await expectError(`select * from public.claim_commercial_messages('${CAMPAIGN}', 10, false);`)
    assert.match(String(error), /campaign_not_active_or_approved/)
    await sql(`update public.commercial_campaigns set status = 'active' where id = '${CAMPAIGN}';`)
  })
})
