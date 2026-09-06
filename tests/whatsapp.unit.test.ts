/**
 * Notifiche WhatsApp: le regole che, se saltano, si notano solo quando il
 * telefono tace (o quando suona duecento volte in un'ora).
 */
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, test } from 'node:test'
import { FakeSupabase } from './fake-supabase'
import { clampWhatsappText, normalizeChatId } from '../src/lib/server/whatsapp'
import { buildDigestMessage, contactLabel, recordWhatsappEvent } from '../src/lib/server/whatsapp-notify'

const USER = 'user-1'

function configureGateway() {
  process.env.OPENWA_BASE_URL = 'https://wa.example.com'
  process.env.OPENWA_API_KEY = 'key'
  process.env.OPENWA_SESSION_ID = '0a941dac-a965-45e7-b318-74ae8be134f0'
  process.env.WHATSAPP_NOTIFY_TO = '+39 333 1234567'
  process.env.WHATSAPP_NOTIFY_ENABLED = 'true'
}

function clearGateway() {
  delete process.env.OPENWA_BASE_URL
  delete process.env.OPENWA_API_KEY
  delete process.env.OPENWA_SESSION_ID
  delete process.env.WHATSAPP_NOTIFY_TO
  delete process.env.WHATSAPP_NOTIFY_ENABLED
  delete process.env.WHATSAPP_NOTIFY_EVENTS
}

describe('numero e testo verso il gateway', () => {
  test('un numero scritto come lo scrive un umano diventa un WID', () => {
    assert.equal(normalizeChatId('+39 333 123 4567'), '393331234567@c.us')
    assert.equal(normalizeChatId('393331234567@c.us'), '393331234567@c.us')
    assert.equal(normalizeChatId('12345'), null)
    assert.equal(normalizeChatId(''), null)
  })

  test('il testo viene troncato a 4096 caratteri invece di farsi rifiutare', () => {
    const clamped = clampWhatsappText('x'.repeat(5000))
    assert.equal(clamped.length, 4096)
    assert.ok(clamped.endsWith('…'))
  })
})

describe('riepilogo', () => {
  test('conta per tipo, somma per agente e nomina solo cio che merita una reazione', () => {
    const events = [
      { event_type: 'email_sent', agent_name: 'Massimo', contact_label: 'Cantina A', occurred_at: '2026-09-06T08:00:00.000Z' },
      { event_type: 'email_sent', agent_name: 'Massimo', contact_label: 'Cantina B', occurred_at: '2026-09-06T08:05:00.000Z' },
      { event_type: 'email_sent', agent_name: 'Luca', contact_label: 'Cantina C', occurred_at: '2026-09-06T08:10:00.000Z' },
      { event_type: 'email_open', contact_label: 'Cantina A', occurred_at: '2026-09-06T08:20:00.000Z' },
      { event_type: 'email_click', contact_label: 'Cantina B', occurred_at: '2026-09-06T08:25:00.000Z' },
    ]

    const message = buildDigestMessage(events, 'UTC')
    assert.ok(message)
    assert.ok(message!.includes('3 email inviate'))
    assert.ok(message!.includes('1 aperture'))
    assert.ok(message!.includes('Massimo 2'))
    assert.ok(message!.includes('Luca 1'))
    // I click hanno un nome, le aperture no: una lista da migliaia di cantine
    // riempirebbe il messaggio di nomi che non richiedono nulla.
    assert.ok(message!.includes('click: Cantina B'))
    assert.ok(!message!.includes('aperture: Cantina A'))
  })

  test('senza eventi non esce nessun messaggio', () => {
    assert.equal(buildDigestMessage([], 'UTC'), null)
  })
})

describe('coda degli eventi', () => {
  beforeEach(() => clearGateway())
  afterEach(() => clearGateway())

  test('senza gateway configurato non si accumula coda', async () => {
    const supabase = new FakeSupabase({ whatsapp_notification_events: [] }) as any
    await recordWhatsappEvent(supabase, {
      userId: USER,
      type: 'email_sent',
      contact: { id: 'c1', company: 'Cantina A', responsible: 'Massimo' },
      detail: 'Oggetto',
    })
    const { data } = await supabase.from('whatsapp_notification_events').select('*')
    assert.equal(data.length, 0)
  })

  test('un invio finisce in coda per il riepilogo, con agente e campagna', async () => {
    configureGateway()
    const supabase = new FakeSupabase({ whatsapp_notification_events: [] }) as any
    await recordWhatsappEvent(supabase, {
      userId: USER,
      type: 'email_sent',
      contact: { id: 'c1', company: 'Cantina A', name: 'Mario Rossi', responsible: 'Massimo', event_tag: 'vinitaly' },
      detail: 'Un esempio gratuito per Cantina A',
    })
    const { data } = await supabase.from('whatsapp_notification_events').select('*')
    assert.equal(data.length, 1)
    assert.equal(data[0].delivery, 'digest')
    assert.equal(data[0].agent_name, 'Massimo')
    assert.equal(data[0].campaign, 'vinitaly')
    assert.equal(data[0].contact_label, 'Cantina A (Mario Rossi)')
    assert.equal(data[0].notified_at ?? null, null)
  })

  test('un tipo escluso da WHATSAPP_NOTIFY_EVENTS non entra nemmeno in coda', async () => {
    configureGateway()
    process.env.WHATSAPP_NOTIFY_EVENTS = 'email_reply,email_click'
    const supabase = new FakeSupabase({ whatsapp_notification_events: [] }) as any
    await recordWhatsappEvent(supabase, {
      userId: USER,
      type: 'email_open',
      contact: { id: 'c1', company: 'Cantina A' },
    })
    const { data } = await supabase.from('whatsapp_notification_events').select('*')
    assert.equal(data.length, 0)
  })
})

describe('etichetta del contatto', () => {
  test('azienda e persona insieme, senza ripetersi', () => {
    assert.equal(contactLabel({ company: 'Cantina A', name: 'Mario Rossi' }), 'Cantina A (Mario Rossi)')
    assert.equal(contactLabel({ company: 'Cantina A', name: 'cantina a' }), 'Cantina A')
    assert.equal(contactLabel({ email: 'info@cantina.it' }), 'info@cantina.it')
    assert.equal(contactLabel(null), 'Contatto')
  })
})
