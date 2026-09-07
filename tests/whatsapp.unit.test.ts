/**
 * Notifiche WhatsApp: le regole che, se saltano, si notano solo quando il
 * telefono tace (o quando suona duecento volte in un'ora).
 */
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, test } from 'node:test'
import { FakeSupabase } from './fake-supabase'
import { clampWhatsappText, normalizeChatId } from '../src/lib/server/whatsapp'
import {
  buildDigestMessage,
  contactLabel,
  invalidateWhatsappSettingsCache,
  loadWhatsappSettings,
  recordWhatsappEvent,
} from '../src/lib/server/whatsapp-notify'

const USER = 'user-1'

function configureGateway() {
  process.env.OPENWA_BASE_URL = 'https://wa.example.com'
  process.env.OPENWA_API_KEY = 'key'
  process.env.OPENWA_SESSION_ID = '0a941dac-a965-45e7-b318-74ae8be134f0'
}

/** La riga che oggi governa numero, interruttore ed eventi: sta nel CRM. */
function settingsRow(overrides: Record<string, any> = {}) {
  return { user_id: USER, notify_to: '+39 389 6868162', enabled: true, events: null, ...overrides }
}

function db(settings: any[] = [settingsRow()]) {
  invalidateWhatsappSettingsCache()
  return new FakeSupabase({
    whatsapp_notification_events: [],
    whatsapp_notification_settings: settings,
  }) as any
}

function clearGateway() {
  delete process.env.OPENWA_BASE_URL
  delete process.env.OPENWA_API_KEY
  delete process.env.OPENWA_SESSION_ID
  delete process.env.WHATSAPP_NOTIFY_TO
  delete process.env.WHATSAPP_NOTIFY_ENABLED
  invalidateWhatsappSettingsCache()
}

describe('numero e testo verso il gateway', () => {
  test('un numero scritto come lo scrive un umano diventa un WID', () => {
    assert.equal(normalizeChatId('+39 389 686 8162'), '393896868162@c.us')
    assert.equal(normalizeChatId('393896868162@c.us'), '393896868162@c.us')
    assert.equal(normalizeChatId('12345'), null)
    assert.equal(normalizeChatId(''), null)
  })

  test('un cellulare italiano senza prefisso prende il 39, non un destinatario inesistente', () => {
    assert.equal(normalizeChatId('3896868162'), '393896868162@c.us')
    assert.equal(normalizeChatId('389 686 8162'), '393896868162@c.us')
    // Con il + davanti il numero e gia internazionale: guai a metterci un 39.
    assert.equal(normalizeChatId('+1 415 555 0100'), '14155550100@c.us')
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

  test('un invio di campagna conta per quanti destinatari aveva, non per una riga', () => {
    const events = [
      { event_type: 'email_sent', campaign: 'Wine Project', quantity: 120, occurred_at: '2026-09-07T08:00:00.000Z' },
      { event_type: 'email_sent', campaign: 'Hospitality', quantity: 42, occurred_at: '2026-09-07T08:05:00.000Z' },
      { event_type: 'email_sent', quantity: 3, occurred_at: '2026-09-07T08:10:00.000Z' },
    ]

    const message = buildDigestMessage(events, 'UTC')
    assert.ok(message!.includes('165 email inviate'))
    assert.ok(message!.includes('· Wine Project: 120'))
    assert.ok(message!.includes('· Hospitality: 42'))
    // Un invio fuori campagna (bozza AI, invio a mano) non resta senza etichetta.
    assert.ok(message!.includes('· CRM: 3'))
  })

  test('due step della stessa sequenza restano due righe distinte', () => {
    // Il caso vero: Email 1/5 e Email 2/5 partite nella stessa mezz'ora. Con
    // l'etichetta ferma al progetto diventavano un unico "180 email inviate"
    // da cui non si capiva quale passo fosse avanzato.
    const message = buildDigestMessage(
      [
        { event_type: 'email_sent', campaign: 'Wine Project — Vinitaly · Email 1/5', quantity: 98, occurred_at: '2026-09-07T08:00:00.000Z' },
        { event_type: 'email_sent', campaign: 'Wine Project — Vinitaly · Email 2/5', quantity: 82, occurred_at: '2026-09-07T08:30:00.000Z' },
      ],
      'UTC'
    )
    assert.ok(message!.includes('180 email inviate'))
    assert.ok(message!.includes('· Wine Project — Vinitaly · Email 1/5: 98'))
    assert.ok(message!.includes('· Wine Project — Vinitaly · Email 2/5: 82'))
  })

  test('con una sola provenienza la ripartizione non ripete il totale', () => {
    const message = buildDigestMessage(
      [{ event_type: 'email_sent', campaign: 'Wine Project', quantity: 120, occurred_at: '2026-09-07T08:00:00.000Z' }],
      'UTC'
    )
    assert.ok(message!.includes('120 email inviate'))
    assert.ok(!message!.includes('· Wine Project: 120'))
  })

  test('senza eventi non esce nessun messaggio', () => {
    assert.equal(buildDigestMessage([], 'UTC'), null)
  })
})

describe('coda degli eventi', () => {
  beforeEach(() => clearGateway())
  afterEach(() => clearGateway())

  test('senza gateway configurato non si accumula coda', async () => {
    const supabase = db()
    await recordWhatsappEvent(supabase, {
      userId: USER,
      type: 'email_sent',
      contact: { id: 'c1', company: 'Cantina A', responsible: 'Massimo' },
      detail: 'Oggetto',
    })
    const { data } = await supabase.from('whatsapp_notification_events').select('*')
    assert.equal(data.length, 0)
  })

  test('con le notifiche spente nel CRM non si accumula coda', async () => {
    configureGateway()
    const supabase = db([settingsRow({ enabled: false })])
    await recordWhatsappEvent(supabase, {
      userId: USER,
      type: 'email_sent',
      contact: { id: 'c1', company: 'Cantina A' },
    })
    const { data } = await supabase.from('whatsapp_notification_events').select('*')
    assert.equal(data.length, 0)
  })

  test('un invio finisce in coda per il riepilogo, con agente e campagna', async () => {
    configureGateway()
    const supabase = db()
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

  test('un tipo tolto dalle impostazioni non entra nemmeno in coda', async () => {
    configureGateway()
    const supabase = db([settingsRow({ events: ['email_reply', 'email_click'] })])
    await recordWhatsappEvent(supabase, {
      userId: USER,
      type: 'email_open',
      contact: { id: 'c1', company: 'Cantina A' },
    })
    const { data } = await supabase.from('whatsapp_notification_events').select('*')
    assert.equal(data.length, 0)
  })
})

describe('impostazioni', () => {
  beforeEach(() => clearGateway())
  afterEach(() => clearGateway())

  test('la riga del CRM vince sulle env', async () => {
    process.env.WHATSAPP_NOTIFY_TO = '+39 333 0000000'
    const settings = await loadWhatsappSettings(db(), USER)
    assert.equal(settings.notify_to, '+39 389 6868162')
    assert.equal(settings.enabled, true)
    assert.deepEqual(settings.events.length, 5)
  })

  test('senza riga valgono le env, cosi il primo avvio non resta muto', async () => {
    process.env.WHATSAPP_NOTIFY_TO = '+39 333 0000000'
    process.env.WHATSAPP_NOTIFY_ENABLED = 'true'
    const settings = await loadWhatsappSettings(db([]), USER)
    assert.equal(settings.notify_to, '+39 333 0000000')
    assert.equal(settings.enabled, true)
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
