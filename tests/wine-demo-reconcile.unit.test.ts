/**
 * L'elenco delle schede generate si incolla, non si trascrive.
 *
 * Il caso vero: la tabella dell'app Speaqi si copia con ogni campo su una riga
 * a se' («Non passato», «WINE», lo stato dell'analisi, il numero di pagine).
 * Il parser deve tenere quello che identifica la cantina — sito ed email — e
 * ignorare il resto, altrimenti prima di ogni allineamento c'e' mezz'ora di
 * pulizia a mano.
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { parseDemoList, siteHost } from '../src/lib/server/wine-project-demo-reconcile'

describe('parseDemoList', () => {
  test('tiene il sito e scarta le etichette della tabella', () => {
    const records = parseDemoList(`Non passato
acumbamail · wine-project-followup
WINE
https://www.cantinecogo.it/
CON RISULTATI
STAFF_REVIEW_REQUIRED
17 trovati
8 pagine`)
    assert.equal(records.length, 1)
    assert.equal(records[0].source_url, 'https://www.cantinecogo.it/')
    assert.equal(records[0].email, null)
  })

  test('riconosce l\'email quando l\'app l\'ha raccolta', () => {
    const records = parseDemoList('info@saraesara.com\n+390432604593\nhttps://saraesara.com')
    assert.equal(records.length, 2)
    assert.equal(records[0].email, 'info@saraesara.com')
    assert.equal(records[1].source_url, 'https://saraesara.com')
  })

  test('sito ed email sulla stessa riga restano la stessa scheda', () => {
    const records = parseDemoList('https://www.alfeu.it/shop/, alfeuwinery@gmail.com')
    assert.equal(records.length, 1)
    assert.equal(records[0].source_url, 'https://www.alfeu.it/shop/')
    assert.equal(records[0].email, 'alfeuwinery@gmail.com')
  })

  test('la demo su speaqi.com non viene scambiata per il sito della cantina', () => {
    const records = parseDemoList('https://www.vinitola.com/it, https://speaqi.com/it/tolavini, 2026-09-11')
    assert.equal(records[0].source_url, 'https://www.vinitola.com/it')
    assert.equal(records[0].demo_url, 'https://speaqi.com/it/tolavini')
    assert.equal(records[0].occurred_at, new Date('2026-09-11').toISOString())
  })

  test('le righe senza sito ne email non diventano schede', () => {
    assert.equal(parseDemoList('CON RISULTATI\n41 pagine\nNon avviata\n\n').length, 0)
  })
})

describe('siteHost', () => {
  test('normalizza le barre rovesciate e il www', () => {
    assert.equal(siteHost('https:\\\\www.jannamico.com'), 'jannamico.com')
    assert.equal(siteHost('https://www.silviocarta.it/prodotti/'), 'silviocarta.it')
    assert.equal(siteHost('gorghitondi.it'), 'gorghitondi.it')
    assert.equal(siteHost(''), null)
    assert.equal(siteHost('non un url'), null)
  })
})
