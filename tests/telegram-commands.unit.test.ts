/**
 * I comandi slash del bot: diventano la stessa frase che si scriverebbe a mano,
 * quindi passano dal Direttore con le sue regole. Qui si prova la traduzione.
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  cityAndCount,
  formatSchedaReply,
  parseTelegramCommand,
  telegramCommandsHelp,
  telegramMenu,
} from '../src/lib/office/telegram-commands'

const directorText = (text: string, photo = false) => {
  const out = parseTelegramCommand(text, { photo })
  assert.equal(out?.kind, 'director', `${text} → ${JSON.stringify(out)}`)
  return (out as { text: string }).text
}

describe('comandi slash di Telegram', () => {
  test('un testo normale non è un comando', () => {
    assert.equal(parseTelegramCommand('Prepara la presentazione per Bibione'), null)
    assert.equal(parseTelegramCommand('Direttore, come stiamo?'), null)
    assert.equal(parseTelegramCommand(''), null)
    assert.equal(parseTelegramCommand('vedi https://x.it/ciao'), null)
  })

  test('presentazioni, mappe, enti e soldi diventano la frase del Direttore', () => {
    assert.equal(directorText('/presentazione Visit Bergamo'), 'Prepara la presentazione per Visit Bergamo')
    assert.equal(directorText('/presentazione Bibione', true), 'Foto per la presentazione di Bibione')
    assert.equal(directorText('/presentazioni'), 'Preparami 5 presentazioni di destinazioni')
    assert.equal(directorText('/presentazioni 3'), 'Preparami 3 presentazioni di destinazioni')
    assert.equal(directorText('/presentazioni 40'), 'Preparami 5 presentazioni di destinazioni')
    assert.equal(directorText('/presentazione_partner Hotel Laguna, guida di Venezia'), 'Presentazione partner per Hotel Laguna, guida di Venezia')
    assert.equal(directorText('/ente Venezuela Tourism'), 'Aggiungi Venezuela Tourism a Tourism Intelligence e ai contatti')
    assert.equal(directorText('/partner Venezia 3'), 'Trovami 3 partner per la mappa di Venezia')
    assert.equal(directorText('/partner 12 Lisbona'), 'Trovami 10 partner per la mappa di Lisbona')
    assert.equal(directorText('/mappa Marsiglia https://www.google.com/maps/d/viewer?mid=abc'), 'Costruisci la mappa di Marsiglia, https://www.google.com/maps/d/viewer?mid=abc')
    assert.equal(directorText('/mappa Marsiglia'), 'Costruisci la mappa di Marsiglia')
    assert.equal(directorText('/controlla Barcellona'), 'Controlla la mappa di Barcellona')
    assert.equal(directorText('/fattura PREV-2026-0012'), 'Fammi la fattura per PREV-2026-0012')
    assert.match(directorText('/approvato PREV-2026-0012'), /approvato PREV-2026-0012, fai la fattura/)
    assert.equal(directorText('/stato'), 'Come stiamo?')
    assert.equal(directorText('/fiere'), 'Quali sono le prossime fiere?')
    assert.equal(directorText('/rinomina Vecchio in Nuovo'), 'Rinomina Vecchio in Nuovo')
  })

  test('il contatto accetta anche la sola foto del bigliettino', () => {
    assert.equal(directorText('/contatto Mario Rossi, info@x.it'), 'Nuovo contatto: Mario Rossi, info@x.it')
    assert.equal(directorText('/contatto', true), 'Nuovo contatto dal bigliettino')
    assert.equal(parseTelegramCommand('/contatto')?.kind, 'reply')
  })

  test('senza argomento risponde con l’esempio, senza chiamare il Direttore', () => {
    for (const cmd of ['/presentazione', '/mappa', '/partner', '/scheda', '/fattura', '/todo', '/rinomina solo-un-nome', '/direttore']) {
      const out = parseTelegramCommand(cmd)
      assert.equal(out?.kind, 'reply', cmd)
      assert.match((out as { text: string }).text, /Scrivi così/)
    }
  })

  test('nei gruppi /cmd@NomeBot vale come /cmd, e gli alias funzionano', () => {
    assert.equal(directorText('/stato@SpeaqiBot'), 'Come stiamo?')
    assert.equal(directorText('/STATO'), 'Come stiamo?')
    assert.equal(parseTelegramCommand('/start')?.kind, 'reply')
    assert.equal(parseTelegramCommand('/cerca SNAV')?.kind, 'search')
  })

  test('/scheda cerca, /todo va al To Do, un comando sconosciuto mostra l’aiuto', () => {
    assert.deepEqual(parseTelegramCommand('/scheda SNAV'), { kind: 'search', command: 'scheda', query: 'SNAV' })
    assert.deepEqual(parseTelegramCommand('/todo domani chiamo Rossi'), { kind: 'todo', command: 'todo', text: 'domani chiamo Rossi' })
    const unknown = parseTelegramCommand('/boh')
    assert.equal(unknown?.kind, 'reply')
    assert.match((unknown as { text: string }).text, /Non conosco \/boh/)
  })

  test('il menu rispetta le regole di Telegram', () => {
    const menu = telegramMenu()
    assert.ok(menu.length > 0 && menu.length <= 100)
    for (const item of menu) {
      assert.match(item.command, /^[a-z0-9_]{1,32}$/)
      assert.ok(item.description.length >= 1 && item.description.length <= 256)
    }
    assert.equal(new Set(menu.map((m) => m.command)).size, menu.length)
    assert.match(telegramCommandsHelp(), /\/presentazione Visit Bergamo/)
  })

  test('città e quantità per /partner', () => {
    assert.deepEqual(cityAndCount('Venezia'), { city: 'Venezia', count: 5 })
    assert.deepEqual(cityAndCount('Venezia, 2'), { city: 'Venezia', count: 2 })
    assert.deepEqual(cityAndCount('0 Roma'), { city: 'Roma', count: 1 })
  })
})

describe('risposta di /scheda', () => {
  test('un link per contatto, ente e mappa', () => {
    const text = formatSchedaReply('snav', {
      contacts: [{ id: 'c1', name: 'Mario', company: 'SNAV', status: 'Quote' }],
      entities: [{ id: 'e1', name: 'SNAV', kind: 'organization', country_code: 'IT', contact_id: 'c1' }],
      maps: [{ name: 'Capri', stage_label: 'Online', url: 'https://guides.speaqi.com/maps/capri' }],
    }, 'https://crm.speaqi.com/')
    assert.match(text, /https:\/\/crm\.speaqi\.com\/scheda\/c1/)
    assert.match(text, /tourism\?entity=e1/)
    assert.match(text, /Capri — Online/)
  })

  test('niente trovato lo dice', () => {
    assert.match(formatSchedaReply('zzz', { contacts: [], entities: [], maps: [] }, 'x'), /Non trovo niente/)
  })
})
