import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const OWNER = '11111111-1111-4111-8111-111111111111'
const MEMBER = '22222222-2222-4222-8222-222222222222'
const OTHER = '33333333-3333-4333-8333-333333333333'
let db: PGlite
const rows: Record<string, any>[] = []

// Oracolo del contratto precedente: scope legacy, hidden e partner sono distinti.
function expected(input: typeof rows) {
  const crm = input.filter(
    (c) => c.contact_scope === null || c.contact_scope === 'crm'
  )
  const folders = new Map<
    string,
    {
      list_name: string | null
      event_tag: string | null
      source: string | null
      count: number
    }
  >()
  for (const c of input.filter((c) => c.contact_scope === 'holding')) {
    const folder = {
      list_name: c.list_name?.trim() || null,
      event_tag: c.event_tag?.trim() || null,
      source: c.source?.trim() || null,
    }
    const key = JSON.stringify(folder)
    const existing = folders.get(key)
    if (existing) existing.count++
    else folders.set(key, { ...folder, count: 1 })
  }
  return {
    counts: {
      total: input.length,
      crm: crm.length,
      crm_visible: crm.filter((c) => c.hidden !== true).length,
      holding: input.filter((c) => c.contact_scope === 'holding').length,
      personal: input.filter((c) => c.contact_scope === 'personal').length,
      partner: input.filter(
        (c) => c.is_partner && c.contact_scope !== 'holding'
      ).length,
      inbound: crm.filter((c) => c.source === 'speaqi').length,
      marketing: input.filter(
        (c) =>
          c.contact_scope !== 'personal' &&
          c.status !== null &&
          ![
            'closed',
            'Closed',
            'paid',
            'Paid',
            'lost',
            'Lost',
            'not_interested',
            'Not_interested',
          ].includes(c.status) &&
          [
            c.email,
            c.email_draft_note,
            c.next_followup_at,
            c.email_unsubscribed_at,
          ].some((v) => v !== null)
      ).length,
    },
    folders: [...folders.values()].sort(
      (a, b) =>
        b.count - a.count ||
        String(a.list_name || '\uffff').localeCompare(
          String(b.list_name || '\uffff')
        )
    ),
  }
}

async function summary(
  viewer: string,
  workspace = OWNER,
  member: string | null = null
) {
  await db.exec(
    `reset role; set request.jwt.claim.sub='${viewer}'; set role authenticated;`
  )
  return (
    await db.query<{ summary: ReturnType<typeof expected> }>(
      'select public.contact_workspace_summary($1::uuid, $2::text) as summary',
      [workspace, member]
    )
  ).rows[0].summary
}

before(async () => {
  db = new PGlite()
  await db.exec(
    await readFile(
      new URL('./sql/crm-startup-fixture.sql', import.meta.url),
      'utf8'
    )
  )
  await db.exec(
    await readFile(
      new URL(
        '../supabase/migrations/20261023094926_crm_startup_performance.sql',
        import.meta.url
      ),
      'utf8'
    )
  )
  await db.exec(
    await readFile(
      new URL(
        '../supabase/migrations/20261023095127_crm_summary_grouping_sets.sql',
        import.meta.url
      ),
      'utf8'
    )
  )
  // Oltre mille righe: le cartelle e i badge non possono dipendere dal limite REST.
  for (let i = 0; i < 5009; i++) {
    rows.push({
      user_id: i === 5008 ? OTHER : OWNER,
      contact_scope: [null, 'crm', 'holding', 'personal'][i % 4],
      hidden: [null, false, true][i % 3],
      is_partner: i % 5 === 0,
      source: ['manual', 'speaqi', ' manual ', null][i % 4],
      status: [
        'New',
        'Closed',
        'paid',
        'Lost',
        'Not_interested',
        'waiting',
        'In progress',
        null,
        'new',
      ][i % 9],
      list_name: i % 2 === 0 ? ' Import ' : null,
      event_tag: i % 3 === 0 ? ' Fiera ' : '',
      email: i % 3 === 0 ? 'fixture@example.test' : null,
      email_draft_note: i % 7 === 0 ? '' : null,
      next_followup_at: i % 11 === 0 ? '2026-10-23T12:00:00Z' : null,
      email_unsubscribed_at: i % 13 === 0 ? '2026-10-22T12:00:00Z' : null,
      responsible: i % 2 === 0 ? 'COLLABORATORE' : null,
      assigned_agent: i % 3 === 0 ? 'collaboratore' : null,
    })
  }
  await db.query(
    `insert into contacts (user_id,contact_scope,hidden,is_partner,source,status,list_name,event_tag,email,email_draft_note,next_followup_at,email_unsubscribed_at,responsible,assigned_agent)
    select user_id,contact_scope,hidden,is_partner,source,status,list_name,event_tag,email,email_draft_note,next_followup_at,email_unsubscribed_at,responsible,assigned_agent
    from jsonb_populate_recordset(null::contacts, $1::jsonb)`,
    [JSON.stringify(rows)]
  )
})
after(async () => {
  await db?.close()
})

test('badge e cartelle coincidono con il contratto precedente, anche oltre mille contatti', async () => {
  assert.deepEqual(
    await summary(OWNER),
    expected(rows.filter((c) => c.user_id === OWNER))
  )
})

test('un workspace vuoto restituisce zeri e nessuna cartella', async () => {
  assert.deepEqual(await summary(OTHER, MEMBER), expected([]))
})

test('il collaboratore conta soltanto le proprie assegnazioni in entrambi i campi', async () => {
  const assigned = rows.filter(
    (c) =>
      c.user_id === OWNER &&
      (c.responsible?.toLowerCase() === 'collaboratore' ||
        c.assigned_agent === 'collaboratore')
  )
  assert.deepEqual(
    await summary(MEMBER, OWNER, 'collaboratore'),
    expected(assigned)
  )
  // Omettere il filtro applicativo non permette di superare RLS.
  assert.deepEqual(await summary(MEMBER), expected(assigned))
})

test('un utente estraneo non ottiene conteggi o cartelle di altri workspace', async () => {
  assert.deepEqual(await summary(OTHER), expected([]))
  assert.deepEqual(await summary(OTHER, OWNER, 'collaboratore'), expected([]))
})

test('la RPC è security invoker e non è eseguibile da anon', async () => {
  await db.exec('reset role')
  const result = await db.query<{
    definer: boolean
    anon: boolean
    authenticated: boolean
  }>(`select
    prosecdef as definer, has_function_privilege('anon', oid, 'execute') as anon,
    has_function_privilege('authenticated', oid, 'execute') as authenticated
    from pg_proc where proname='contact_workspace_summary'`)
  assert.deepEqual(result.rows, [
    { definer: false, anon: false, authenticated: true },
  ])
  await db.exec('set role anon')
  await assert.rejects(
    db.query('select contact_workspace_summary($1)', [OWNER]),
    /permission denied/
  )
})
