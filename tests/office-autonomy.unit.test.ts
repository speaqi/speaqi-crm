/**
 * Autonomia dell'Ufficio: cosa si approva da solo, cosa resta al clic, e l'«Approva e
 * invia» delle bozze email (una volta sola, mai a chi ha risposto o si è disiscritto).
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  autonomySettings, draftEmailText, dueForAutoApproval, outputTrust, queueCounts, queueSummaryText, romeDayStart, sendErrorIsBeforeSend,
} from '../src/lib/office/autonomy'
import { draftEmailKeyboard, parseTelegramAction, queueKeyboard } from '../src/lib/office/telegram-actions'
import { approveAndSendOutput, sendOfficeDraft, type OfficeSendDeps } from '../src/lib/server/office-email-send'
import { FakeSupabase } from './fake-supabase'

const UID = 'user-1'
const ID = '11111111-2222-4333-8444-555555555555'
const out = (agent_id: string, kind: string, body: Record<string, any> = {}, created_at = '2026-10-27T08:00:00Z') => ({ agent_id, kind, body, created_at })

describe('fiducia per tipo di azione', () => {
  test('si approvano da sole solo le azioni interne e reversibili', () => {
    assert.equal(outputTrust(out('director', 'proposal', { action: 'build_map' })), 'auto')
    assert.equal(outputTrust(out('director', 'proposal', { action: 'complete_languages' })), 'auto')
    assert.equal(outputTrust(out('director', 'proposal', { action: 'create_contact', possibili_doppioni: [] })), 'auto')
    assert.equal(outputTrust(out('events_scout', 'task', { action: 'decide_event_participation' })), 'auto')
    assert.equal(outputTrust(out('entity_enricher', 'proposal', { action: 'enrich_entity' })), 'auto')
  })

  test('email, unioni, doppioni e spese restano al clic', () => {
    assert.equal(outputTrust(out('sales_followup', 'draft_email', { email_draft_id: ID })), 'send')
    assert.equal(outputTrust(out('sales_followup', 'draft_email', {})), 'manual')
    assert.equal(outputTrust(out('db_cleaner', 'data_fix', { action: 'merge_contacts' })), 'manual')
    assert.equal(outputTrust(out('director', 'proposal', { action: 'create_contact', possibili_doppioni: ['Mario'] })), 'manual')
    assert.equal(outputTrust(out('languages_voice', 'proposal', { action: 'refresh_outdated' })), 'manual')
    assert.equal(outputTrust(out('director', 'proposal', { action: 'boh' })), 'manual')
  })

  test('avvisi, bozze di post e segnalazioni sono «sicure» per il pulsante, non per il giro automatico', () => {
    assert.equal(outputTrust(out('finance', 'report', {})), 'safe')
    assert.equal(outputTrust(out('social', 'draft_post', {})), 'safe')
    assert.equal(outputTrust(out('maps_quality', 'data_fix', {})), 'safe')
  })

  test('il ritardo di sicurezza, gli agenti esclusi e il freno delle env', () => {
    const now = new Date('2026-10-27T09:00:00Z')
    const items = [
      { ...out('director', 'proposal', { action: 'build_map' }, '2026-10-27T08:00:00Z'), id: 'old' },
      { ...out('director', 'proposal', { action: 'build_map' }, '2026-10-27T08:50:00Z'), id: 'young' },
      { ...out('entity_enricher', 'proposal', { action: 'enrich_entity' }, '2026-10-27T08:00:00Z'), id: 'enricher' },
      { ...out('finance', 'report', {}, '2026-10-27T07:00:00Z'), id: 'report' },
    ]
    const settings = autonomySettings({ delay_minutes: 30, agents_off: ['entity_enricher'] }, undefined)
    assert.deepEqual(dueForAutoApproval(items, settings, now).map((o) => o.id), ['old'])
    assert.deepEqual(dueForAutoApproval(items, settings, now, (a) => a === 'director').map((o) => o.id), [])
    assert.equal(autonomySettings({}, 'false').enabled, false)
    assert.equal(autonomySettings({ enabled: false }, undefined).enabled, false)
    assert.equal(autonomySettings({ delay_minutes: -4 }, undefined).delayMinutes, 30)
    assert.equal(autonomySettings({ delay_minutes: 99999 }, undefined).delayMinutes, 1440)
    assert.deepEqual(dueForAutoApproval(items, autonomySettings({}, 'false'), now), [])
  })

  test('riepilogo di /coda e pulsanti solo dove servono', () => {
    const counts = queueCounts([out('director', 'proposal', { action: 'build_map' }), out('x', 'draft_email', { email_draft_id: ID }), out('f', 'report')])
    assert.deepEqual(counts, { auto: 1, safe: 1, send: 1, manual: 0, total: 3 })
    const text = queueSummaryText(counts, autonomySettings({}, undefined))
    assert.match(text, /In coda: 3/)
    assert.match(text, /1 email pronte/)
    const keyboard = queueKeyboard(counts).flat().map((b) => b.callback_data)
    assert.deepEqual(keyboard, ['q:a', 'q:e'])
    assert.match(queueSummaryText(queueCounts([]), autonomySettings({}, undefined)), /non c’è niente/)
  })

  test('pulsanti nuovi: invio, coda; dati estranei ignorati', () => {
    assert.deepEqual(parseTelegramAction(`o:s:${ID}`), { kind: 'output_send', id: ID })
    assert.deepEqual(parseTelegramAction('q:a'), { kind: 'queue', view: 'safe' })
    assert.deepEqual(parseTelegramAction('q:e'), { kind: 'queue', view: 'emails' })
    assert.deepEqual(parseTelegramAction('q:d'), { kind: 'queue', view: 'decisions' })
    assert.equal(parseTelegramAction('q:x'), null)
    assert.equal(parseTelegramAction('o:s:non-un-uuid'), null)
    assert.equal(draftEmailKeyboard({ id: ID, editLink: 'https://x/email' })[0][0].callback_data, `o:s:${ID}`)
    for (const row of draftEmailKeyboard({ id: ID, editLink: 'https://x/email' })) for (const b of row) if (b.callback_data) assert.ok(Buffer.byteLength(b.callback_data) <= 64)
  })

  test('testo della bozza e classificazione degli errori di invio', () => {
    const text = draftEmailText({ title: 'Bozza', to: 'Mario <m@x.it>', subject: 'Ciao', body: 'riga\n'.repeat(400), reason: 'preventivo fermo' })
    assert.ok(text.length <= 3500)
    assert.match(text, /Perché: preventivo fermo/)
    assert.equal(sendErrorIsBeforeSend('Gmail non collegato'), true)
    assert.equal(sendErrorIsBeforeSend('invalid_grant'), true)
    assert.equal(sendErrorIsBeforeSend('relation gmail_messages timeout'), false)
  })

  test('la mezzanotte di Roma, d’estate e d’inverno', () => {
    assert.equal(romeDayStart(new Date('2026-07-10T15:00:00Z')), '2026-07-09T22:00:00.000Z')
    assert.equal(romeDayStart(new Date('2026-12-10T15:00:00Z')), '2026-12-09T23:00:00.000Z')
    assert.equal(romeDayStart(new Date('2026-12-10T23:30:00Z')), '2026-12-10T23:00:00.000Z')
  })
})

function db(overrides: { contact?: Record<string, any>; replies?: any[]; sentToday?: number } = {}) {
  const sent = Array.from({ length: overrides.sentToday || 0 }, (_, i) => ({ id: `s${i}`, user_id: UID, source: 'office', sent_via: 'crm', status: 'sent', sent_at: new Date().toISOString() }))
  return new FakeSupabase({
    email_drafts: [{ id: 'd1', user_id: UID, contact_id: 'c1', source: 'office', status: 'pending', subject: 'Il preventivo', body_text: 'Buongiorno', body_html: null, created_at: '2026-10-27T06:00:00Z' }, ...sent],
    contacts: [{ id: 'c1', user_id: UID, email: 'cliente@x.it', status: 'quote', ...overrides.contact }],
    gmail_messages: overrides.replies || [],
    office_agent_outputs: [{ id: ID, user_id: UID, agent_id: 'sales_followup', kind: 'draft_email', status: 'pending', body: { email_draft_id: 'd1' }, target_table: 'email_drafts', target_id: 'd1' }],
  })
}

function deps(send: OfficeSendDeps['send'] = (async () => ({ message: { gmail_message_id: 'g1' } })) as any): OfficeSendDeps & { calls: number } {
  const state = { calls: 0 }
  return {
    get calls() { return state.calls },
    getAccount: (async () => ({ id: 'acc' })) as any,
    refresh: (async () => 'token') as any,
    send: (async (...args: any[]) => { state.calls++; return (send as any)(...args) }) as any,
  }
}

describe('«Approva e invia»', () => {
  test('parte una volta sola e la proposta risulta approvata', async () => {
    const admin = db(); const d = deps(); const decided: string[] = []
    const first = await approveAndSendOutput(admin as any, UID, ID, async (id) => { decided.push(id) }, d)
    assert.equal(first.ok, true)
    assert.equal(admin.tables.email_drafts[0].status, 'sent')
    assert.equal(admin.tables.email_drafts[0].sent_via, 'crm')
    assert.deepEqual(decided, [ID])
    const again = await sendOfficeDraft(admin as any, UID, 'd1', new Date(), d)
    assert.equal(again.ok, false)
    assert.equal(d.calls, 1)
  })

  test('non parte a un disiscritto né a chi ha risposto dopo la bozza, e la bozza torna in attesa', async () => {
    const unsub = db({ contact: { email_unsubscribed_at: '2026-10-20T00:00:00Z' } }); const d1 = deps()
    assert.equal((await sendOfficeDraft(unsub as any, UID, 'd1', new Date(), d1)).ok, false)
    assert.equal(unsub.tables.email_drafts[0].status, 'pending')
    const replied = db({ replies: [{ id: 'm1', user_id: UID, direction: 'inbound', from_email: 'cliente@x.it', sent_at: '2026-10-27T07:00:00Z' }] }); const d2 = deps()
    const result = await sendOfficeDraft(replied as any, UID, 'd1', new Date(), d2)
    assert.equal(result.ok, false)
    assert.match(result.text, /ha risposto/)
    assert.equal(d1.calls + d2.calls, 0)
  })

  test('il tetto del giorno ferma l’invio', async () => {
    const admin = db({ sentToday: 30 }); const d = deps()
    const result = await sendOfficeDraft(admin as any, UID, 'd1', new Date(), d)
    assert.equal(result.ok, false)
    assert.equal(!result.ok && result.status, 429)
    assert.equal(d.calls, 0)
  })

  test('un errore prima dell’invio rimette in attesa; uno dopo lascia «da verificare» e non si ritenta', async () => {
    const before = db()
    const r1 = await sendOfficeDraft(before as any, UID, 'd1', new Date(), deps((async () => { throw new Error('Gmail non collegato') }) as any))
    assert.equal(r1.ok, false)
    assert.equal(before.tables.email_drafts[0].status, 'pending')
    const after = db(); const d = deps((async () => { throw new Error('upsert gmail_messages fallito') }) as any)
    const r2 = await sendOfficeDraft(after as any, UID, 'd1', new Date(), d)
    assert.equal(!r2.ok && r2.uncertain, true)
    assert.equal(after.tables.email_drafts[0].status, 'unknown')
    const r3 = await sendOfficeDraft(after as any, UID, 'd1', new Date(), d)
    assert.equal(r3.ok, false)
    assert.equal(d.calls, 1)
  })

  test('una proposta già decisa non si manda', async () => {
    const admin = db(); admin.tables.office_agent_outputs[0].status = 'rejected'; const d = deps()
    assert.equal((await approveAndSendOutput(admin as any, UID, ID, async () => undefined, d)).ok, false)
    assert.equal(d.calls, 0)
  })
})

describe('giro dell’autonomia', () => {
  test('approva solo le sicure mature, con la stessa decisione del clic; le altre restano', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN; delete process.env.OFFICE_WORKER_ENABLED
    const { runOfficeAutonomy } = await import('../src/lib/server/office-autonomy')
    const old = new Date(Date.now() - 2 * 3600_000).toISOString()
    const young = new Date(Date.now() - 5 * 60_000).toISOString()
    const row = (id: string, agent_id: string, kind: string, body: Record<string, any>, created_at: string) => ({ id, user_id: UID, agent_id, kind, title: id, body, status: 'pending', created_at, target_table: null, target_id: null })
    const admin = new FakeSupabase({
      office_agents: [{ id: 'director', user_id: UID, settings: { autonomy: { delay_minutes: 30 } } }, { id: 'events_scout', user_id: UID, settings: { auto_approve: false } }],
      office_agent_outputs: [
        row('map', 'director', 'proposal', { action: 'build_map', recipient_agent_id: 'mymaps_builder' }, old),
        row('fresh', 'director', 'proposal', { action: 'build_map' }, young),
        row('event', 'events_scout', 'task', { action: 'decide_event_participation' }, old),
        row('merge', 'db_cleaner', 'data_fix', { action: 'merge_contacts' }, old),
        row('mail', 'sales_followup', 'draft_email', { email_draft_id: 'd1' }, old),
      ],
    }, {
      decide_office_output: ({ p_output_id, p_status }) => {
        const o = admin.tables.office_agent_outputs.find((r) => r.id === p_output_id)!
        o.status = p_status
        return { output: o }
      },
    })
    const result = await runOfficeAutonomy(admin as any, UID)
    assert.deepEqual(result.approved, ['map'])
    const status = Object.fromEntries(admin.tables.office_agent_outputs.map((o) => [o.id, o.status]))
    assert.deepEqual(status, { map: 'approved', fresh: 'pending', event: 'pending', merge: 'pending', mail: 'pending' })
    assert.equal(result.pending.send, 1)
  })
})
