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
import { wineSequenceBlockReason } from '../src/lib/server/wine-project-automation'

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
