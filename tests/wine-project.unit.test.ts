/**
 * Il blocco della sequenza Wine va cercato sull'indirizzo, non sulla scheda.
 *
 * Il caso vero da cui nascono questi test: una cantina risponde «non siamo
 * interessati», il re-import della lista crea una seconda scheda con la stessa
 * email, e la sequenza riparte da quella perche' la risposta era attaccata
 * all'altra.
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { FakeSupabase } from './fake-supabase'
import {
  isTransientDeliveryError,
  reviveFailedWineProjectFollowups,
  wineSequenceBlockReason,
  WINE_MAX_DELIVERY_RETRIES,
} from '../src/lib/server/wine-project-automation'

const USER = 'user-1'

function db(contacts: any[], messages: any[] = []) {
  return new FakeSupabase({ contacts, gmail_messages: messages }) as any
}

function contact(overrides: Record<string, any> = {}) {
  return {
    id: 'contact-nuovo',
    user_id: USER,
    name: 'Cantina',
    email: 'angela@maculan.net',
    status: 'New',
    email_unsubscribed_at: null,
    ...overrides,
  }
}

function inbound(fromEmail: string) {
  return { id: `msg-${fromEmail}`, user_id: USER, contact_id: 'contact-vecchio', direction: 'inbound', from_email: fromEmail }
}

describe('blocco della sequenza Wine', () => {
  test('una risposta su una scheda gemella blocca la scheda appena importata', async () => {
    const supabase = db(
      [contact(), contact({ id: 'contact-vecchio', status: 'Lost' })],
      [inbound('angela@maculan.net')]
    )
    assert.equal(await wineSequenceBlockReason(supabase, contact()), 'trattativa chiusa su scheda duplicata')
  })

  test('vale anche quando la scheda gemella e ancora aperta', async () => {
    const supabase = db(
      [contact(), contact({ id: 'contact-vecchio', status: 'Contacted' })],
      [inbound('angela@maculan.net')]
    )
    assert.equal(await wineSequenceBlockReason(supabase, contact()), 'risposta ricevuta')
  })

  test('la risposta conta a prescindere da quando e arrivata', async () => {
    const supabase = db([contact()], [inbound('ANGELA@Maculan.net')])
    assert.equal(await wineSequenceBlockReason(supabase, contact()), 'risposta ricevuta')
  })

  test('una disiscrizione sulla scheda gemella blocca', async () => {
    const supabase = db([
      contact(),
      contact({ id: 'contact-vecchio', email_unsubscribed_at: '2026-07-01T00:00:00.000Z' }),
    ])
    assert.equal(await wineSequenceBlockReason(supabase, contact()), 'disiscritto su scheda duplicata')
  })

  test('un messaggio nostro classificato inbound non vale come risposta', async () => {
    // Succede quando si spedisce da un indirizzo diverso da quello
    // dell'account Gmail collegato: il messaggio finisce fra gli inbound.
    const supabase = db([contact()], [inbound('info@speaqi.com')])
    assert.equal(await wineSequenceBlockReason(supabase, contact()), null)
  })

  test('i jolly di LIKE non allargano la ricerca ad altri indirizzi', async () => {
    const target = contact({ email: 'a_b@cantina.it' })
    const supabase = db([target, contact({ id: 'altro', email: 'axb@cantina.it', status: 'Lost' })], [inbound('axb@cantina.it')])
    assert.equal(await wineSequenceBlockReason(supabase, target), null)
  })

  test('senza risposte ne schede chiuse la sequenza prosegue', async () => {
    const supabase = db([contact()], [inbound('altra@cantina.it')])
    assert.equal(await wineSequenceBlockReason(supabase, contact()), null)
  })
})

/**
 * Il recupero degli invii caduti.
 *
 * Il caso vero: il 13 settembre 2026 quarantasei email della sequenza non sono
 * partite per un 429 di Acumbamail. `failed` era uno stato terminale, quindi
 * quelle cantine non hanno mai ricevuto quel passo mentre i successivi
 * venivano comunque programmati.
 */
describe('recupero degli invii falliti', () => {
  const rateLimit = 'Acumbamail addMergeTag (429): {"message":"Too Many Requests","policy":"10/m"}'

  function eventsDb(events: any[]) {
    return new FakeSupabase({ wine_project_followup_events: events }) as any
  }

  function failedEvent(overrides: Record<string, any> = {}) {
    return {
      id: 'evt-1',
      user_id: USER,
      contact_id: 'contact-1',
      sequence: 2,
      status: 'failed',
      retry_count: 0,
      due_at: '2026-09-13T08:00:00.000Z',
      delivery_error: rateLimit,
      ...overrides,
    }
  }

  test('un 429 torna in coda', async () => {
    const supabase = eventsDb([failedEvent()])
    const result = await reviveFailedWineProjectFollowups(supabase)

    assert.deepEqual(result, { revived: 1, permanent: 0 })
    const row = supabase.tables.wine_project_followup_events[0]
    assert.equal(row.status, 'scheduled')
    assert.equal(row.retry_count, 1)
    assert.equal(row.delivery_error, null)
    // La scadenza torna a ora: l'evento era gia' scaduto quando l'invio e'
    // fallito, e deve ripartire al primo giro utile.
    assert.ok(new Date(row.due_at).getTime() > new Date('2026-09-13T08:00:00.000Z').getTime())
  })

  test('un errore permanente resta fermo', async () => {
    const supabase = eventsDb([failedEvent({ delivery_error: 'Acumbamail createList (400): nome lista non valido' })])
    const result = await reviveFailedWineProjectFollowups(supabase)

    assert.deepEqual(result, { revived: 0, permanent: 1 })
    assert.equal(supabase.tables.wine_project_followup_events[0].status, 'failed')
  })

  test('oltre il tetto di ritentativi non si insiste', async () => {
    const supabase = eventsDb([failedEvent({ retry_count: WINE_MAX_DELIVERY_RETRIES })])
    const result = await reviveFailedWineProjectFollowups(supabase)

    assert.deepEqual(result, { revived: 0, permanent: 0 })
    assert.equal(supabase.tables.wine_project_followup_events[0].status, 'failed')
  })

  test('il riconoscimento guarda la sostanza, non la forma', () => {
    assert.equal(isTransientDeliveryError(rateLimit), true)
    assert.equal(isTransientDeliveryError('Acumbamail createCampaign (503)'), true)
    assert.equal(isTransientDeliveryError('fetch failed'), true)
    assert.equal(isTransientDeliveryError('Acumbamail addSubscriber (400): email non valida'), false)
    assert.equal(isTransientDeliveryError(null), false)
  })
})
