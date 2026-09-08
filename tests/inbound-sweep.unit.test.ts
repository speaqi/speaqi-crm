/**
 * La scansione della posta in arrivo deve risincronizzare TUTTE le schede che
 * portano l'indirizzo di chi ha scritto, non solo quella su cui il messaggio
 * era gia' archiviato: e' la scheda nata dall'ultimo import — quella che della
 * risposta non sa nulla — a far ripartire la sequenza.
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { contactsNeedingInboundSync } from '../src/lib/server/gmail'

const senders = new Map<string, string[]>([['angela@maculan.net', ['msg-1']]])

describe('scansione posta in arrivo', () => {
  test('prende la scheda che non ha ancora il messaggio', () => {
    const pending = contactsNeedingInboundSync(
      [{ id: 'vecchia', email: 'angela@maculan.net' }, { id: 'nuova', email: 'angela@maculan.net' }],
      senders,
      new Set(['vecchia:msg-1'])
    )
    assert.deepEqual(pending.map((contact) => contact.id), ['nuova'])
  })

  test("non risincronizza chi ha gia' tutto in archivio", () => {
    const pending = contactsNeedingInboundSync(
      [{ id: 'vecchia', email: 'angela@maculan.net' }],
      senders,
      new Set(['vecchia:msg-1'])
    )
    assert.equal(pending.length, 0)
  })

  test("l'indirizzo si confronta senza badare alle maiuscole", () => {
    const pending = contactsNeedingInboundSync(
      [{ id: 'nuova', email: '  Angela@Maculan.NET ' }],
      senders,
      new Set<string>()
    )
    assert.deepEqual(pending.map((contact) => contact.id), ['nuova'])
  })

  test('un mittente sconosciuto non tira dentro nessuno', () => {
    const pending = contactsNeedingInboundSync(
      [{ id: 'altra', email: 'info@altracantina.it' }],
      senders,
      new Set<string>()
    )
    assert.equal(pending.length, 0)
  })
})
