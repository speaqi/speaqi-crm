import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  directorContactReply, directorContactRequest, rankDirectorContacts,
  type DirectorCrmContact, type DueTourismContact,
} from '../src/lib/office/director-contact-recommendations'

const today = '2026-11-15'
test('la domanda di Telegram cerca cinque nomi per domani; un promemoria resta un ordine', () => {
  assert.deepEqual(directorContactRequest('Mi dici 5 persone che dovrei contattare domani?', today),
    { day: '2026-11-16', limit: 5 })
  assert.deepEqual(directorContactRequest('Mi dai due nomi da ricontattare domani?', '2026-12-31'),
    { day: '2027-01-01', limit: 2 })
  assert.equal(directorContactRequest('Ricordami domani di contattare 5 persone', today), null)
  assert.equal(directorContactRequest('Dimmi se domani devo inviare una mail ai clienti da contattare', today), null)
  assert.equal(directorContactRequest('Cerca partner da contattare a Marsiglia', today), null)
})

function make(n: number, name: string, patch: Partial<DirectorCrmContact> = {}, work: Partial<DueTourismContact> = {}) {
  const id = `49248f91-d345-4cef-a6b5-${String(n).padStart(12, '0')}`
  const company = `Ente ${n}`
  const contact: DirectorCrmContact = {
    id, name, company, email: `nome${n}@example.com`, phone: null, hidden: false, status: 'New',
    email_unsubscribed_at: null, ...patch,
  }
  const item: DueTourismContact = {
    title: company, stage: 'contacted', segment: 'TTG · Follow-up', due_on: '2026-11-16',
    website: `https://crm.speaqi.com/contacts/${id}`, next_action: 'Proponi un test su una tratta.', ...work,
  }
  return { contact, item }
}

test('restituisce persone del CRM, ordinate per giorno e relazione, ed esclude contatti non utilizzabili', () => {
  const rows = [
    make(1, 'Luca Neri', {}, { due_on: '2026-11-13' }),
    make(2, 'Ente 2', {}, { title: 'Ente 2 · Maria Foschi' }),
    make(3, 'Arianna Belli', { status: 'Paid' }, { segment: 'Navigazione · Relazione esistente' }),
    make(4, 'Mario Fontana', { hidden: true }),
    make(5, 'Carla Gialli', { status: 'Lost' }),
    make(6, 'Renzo Bassi', { email_unsubscribed_at: today }),
    make(7, 'Gianna Alti', {}, { due_on: '2026-11-17' }),
    make(8, 'Pietro Martini', {}, { website: 'https://example.com/' }),
    make(9, 'Arianna Beltrami', { company: 'Ente 3' }),
    make(10, 'Sara Grigi', { email: null }),
    make(11, 'Ente 11'),
    make(12, 'Fabio Bassi', {}, { stage: 'qualify' }),
    make(13, 'Paola Martini', {}, { next_action: 'Non sollecitare. Ha comunicato di non essere interessata.' }),
  ]
  const picks = rankDirectorContacts({ day: '2026-11-16', limit: 5 },
    rows.map(row => row.item), rows.map(row => row.contact))
  assert.deepEqual(picks.map(pick => pick.name), ['Arianna Belli', 'Maria Foschi', 'Luca Neri'])
  const reply = directorContactReply('2026-11-16', picks)
  assert.match(reply, /lunedì 16 novembre/)
  assert.match(reply, /1\. Arianna Belli — Ente 3\nProponi un test/)
  assert.match(reply, /https:\/\/crm\.speaqi\.com\/contacts\//)
  assert.doesNotMatch(reply, /@example\.com|Mario Fontana/)
  assert.match(directorContactReply('2026-11-16', []), /non ho trovato nel CRM/)
})
