import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import {
  parseReviewAction, parseReviewCommand, REVIEW_DONE_DATA, reviewCardMessage, reviewDecideData, reviewFooter,
  reviewIntro, reviewMapsList, reviewMoreData, reviewOutcome,
} from '../src/lib/office/studiomap-review'
import { handleReviewAction, handleReviewCommand } from '../src/lib/server/studiomap-review'

const MAP = 'a1b2c3d4'
const ITEM = '0123456789ab'
const card = { item: ITEM, name: 'Chez Fonfon', area: 'Marsiglia', category: 'restaurant', kind: 'Dubbio di un agente',
  reasons: ['Forse chiuso', 'Voto basso'], has_text: true, itineraries: 2, maps_url: 'https://www.google.com/maps/place/?q=place_id:X' }

test('i pulsanti stanno nei 64 byte e si rileggono solo nelle forme note', () => {
  for (const data of [reviewDecideData(MAP, ITEM, 'keep'), reviewDecideData(MAP, ITEM, 'remove'), reviewMoreData(MAP, 25), REVIEW_DONE_DATA]) {
    assert.ok(Buffer.byteLength(data) <= 64)
  }
  assert.deepEqual(parseReviewAction(reviewDecideData(MAP, ITEM, 'keep')), { kind: 'review_decide', map: MAP, item: ITEM, decision: 'keep' })
  assert.deepEqual(parseReviewAction(reviewDecideData(MAP, ITEM, 'remove')), { kind: 'review_decide', map: MAP, item: ITEM, decision: 'remove' })
  assert.deepEqual(parseReviewAction(reviewMoreData(MAP, 0)), { kind: 'review_more', map: MAP, offset: 0 })
  assert.deepEqual(parseReviewAction(REVIEW_DONE_DATA), { kind: 'review_done' })
  for (const bad of ['', 'r:k:zz', `r:k:${MAP}:${ITEM}x`, `r:p:${MAP}:${ITEM}`, `r:n:${MAP}:99999`, `o:a:${MAP}`, null, 42]) assert.equal(parseReviewAction(bad), null)
})

test('il comando: dubbi, con o senza città, anche da vocale', () => {
  assert.deepEqual(parseReviewCommand('dubbi'), { city: null })
  assert.deepEqual(parseReviewCommand('/dubbi Marsiglia'), { city: 'Marsiglia' })
  assert.deepEqual(parseReviewCommand('Dubbi di Barcellona?'), { city: 'Barcellona' })
  assert.deepEqual(parseReviewCommand('da decidere: Costa dei Borghi'), { city: 'Costa dei Borghi' })
  assert.deepEqual(parseReviewCommand('/dubbi@SpeaqiBot Lisbona'), { city: 'Lisbona' })
  assert.equal(parseReviewCommand('ho dei dubbi sul preventivo Rossi'), null)
  assert.equal(parseReviewCommand('Direttore, dubbi?'), null)
})

test('la scheda: motivi, itinerari, Tieni e Togli, il link a Google Maps', () => {
  const message = reviewCardMessage(card, MAP)
  assert.match(message.text, /Chez Fonfon · Marsiglia \(restaurant\)/)
  assert.match(message.text, /– Forse chiuso/)
  assert.match(message.text, /esce da 2 itinerari/)
  assert.deepEqual(message.keyboard[0].map((b) => b.callback_data), [reviewDecideData(MAP, ITEM, 'keep'), reviewDecideData(MAP, ITEM, 'remove')])
  assert.equal(message.keyboard[1][0].url, card.maps_url)
  assert.equal(reviewCardMessage({ ...card, maps_url: undefined }, MAP).keyboard.length, 1)
})

test('in testa e in fondo al giro: quante sono, e le prossime dalla testa della coda', () => {
  const page = { map: MAP, city: 'Marsiglia', total: 12, next_offset: 5, link: 'https://studiomap.speaqi.com/?map=m', cards: Array(5).fill(card) }
  assert.match(reviewIntro(page, 0), /12 schede da decidere\. Eccone 1-5/)
  assert.match(reviewIntro({ ...page, total: 0, cards: [] }, 0), /niente da decidere/)
  const footer = reviewFooter(page)!
  assert.equal(footer.keyboard[0][0].callback_data, reviewMoreData(MAP, 0), 'le saltate tornano in testa')
  assert.match(footer.text, /ne restano 7/)
  assert.equal(reviewFooter({ ...page, next_offset: null })!.keyboard.length, 1)
  assert.match(reviewMapsList([{ city: 'Marsiglia', total: 12 }]), /dubbi Marsiglia/)
  assert.match(reviewMapsList([]), /Nessuna decisione aperta/)
})

test('l’esito di un tocco', () => {
  assert.deepEqual(reviewOutcome({ status: 'done', decision: 'keep', name: 'Le Panier', remaining: 4 }),
    { toast: 'Tenuta: Le Panier. Ne restano 4.', label: '✅ Tenuta', done: true })
  assert.equal(reviewOutcome({ status: 'done', decision: 'remove', name: 'X' }).label, '🗑 Tolta')
  assert.match(reviewOutcome({ status: 'already' }).toast, /Già decisa/)
})

// --- giro completo con StudioMap e Telegram finti ---
const savedFetch = globalThis.fetch
const savedEnv = { secret: process.env.OFFICE_BRIDGE_SECRET, url: process.env.OFFICE_STUDIOMAP_URL }
afterEach(() => {
  globalThis.fetch = savedFetch
  process.env.OFFICE_BRIDGE_SECRET = savedEnv.secret
  process.env.OFFICE_STUDIOMAP_URL = savedEnv.url
})
const config = { token: 'T', allowedChatIds: ['42'], webhookSecret: 's' }

function fakeNetwork(studio: (path: string, body: any) => unknown) {
  process.env.OFFICE_BRIDGE_SECRET = 'x'.repeat(40)
  process.env.OFFICE_STUDIOMAP_URL = 'https://studiomap.example'
  const telegram: Array<{ method: string; body: any }> = []
  const studioCalls: Array<{ path: string; body: any }> = []
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input)
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    if (url.startsWith('https://api.telegram.org/')) {
      telegram.push({ method: url.split('/').pop()!, body })
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }))
    }
    const path = new URL(url).pathname
    assert.equal(init.headers.Authorization, `Bearer ${'x'.repeat(40)}`)
    studioCalls.push({ path, body })
    return new Response(JSON.stringify(studio(path, body)))
  }) as typeof fetch
  return { telegram, studioCalls }
}

test('«dubbi Marsiglia» manda intro, una scheda per messaggio e il fondo con le prossime', async () => {
  const net = fakeNetwork(() => ({ map: MAP, city: 'Marsiglia', total: 7, next_offset: 2, link: 'https://studiomap.example/?map=m',
    cards: [card, { ...card, item: 'ba9876543210', name: 'Le Panier', image_url: 'https://upload.wikimedia.org/p.jpg' }] }))
  await handleReviewCommand(config, 42, 'Marsiglia')
  assert.deepEqual(net.studioCalls[0], { path: '/api/office/review/read', body: { city: 'Marsiglia', limit: 5 } })
  assert.deepEqual(net.telegram.map((t) => t.method), ['sendMessage', 'sendMessage', 'sendPhoto', 'sendMessage'])
  assert.equal(net.telegram[2].body.photo, 'https://upload.wikimedia.org/p.jpg')
  assert.equal(net.telegram[1].body.reply_markup.inline_keyboard[0][1].callback_data, reviewDecideData(MAP, ITEM, 'remove'))
})

test('un tocco su Togli decide e lascia l’esito al posto dei pulsanti', async () => {
  const net = fakeNetwork(() => ({ status: 'done', decision: 'remove', name: 'Chez Fonfon', remaining: 6 }))
  const result = await handleReviewAction(config, 42, 99, 'cb1', { kind: 'review_decide', map: MAP, item: ITEM, decision: 'remove' })
  assert.deepEqual(result, { done: true })
  assert.deepEqual(net.studioCalls[0].body, { map: MAP, item: ITEM, decision: 'remove' })
  const answer = net.telegram.find((t) => t.method === 'answerCallbackQuery')!
  assert.match(answer.body.text, /Tolta: Chez Fonfon/)
  const edit = net.telegram.find((t) => t.method === 'editMessageReplyMarkup')!
  assert.deepEqual(edit.body.reply_markup.inline_keyboard, [[{ text: '🗑 Tolta', callback_data: REVIEW_DONE_DATA }]])
})

test('StudioMap giù: il tocco risponde col motivo e i pulsanti restano', async () => {
  process.env.OFFICE_BRIDGE_SECRET = 'x'.repeat(40)
  process.env.OFFICE_STUDIOMAP_URL = 'https://studiomap.example'
  const telegram: string[] = []
  globalThis.fetch = (async (input: any) => {
    const url = String(input)
    if (url.startsWith('https://api.telegram.org/')) { telegram.push(url.split('/').pop()!); return new Response(JSON.stringify({ ok: true, result: {} })) }
    return new Response(JSON.stringify({ error: 'Mappa non trovata.' }), { status: 400 })
  }) as typeof fetch
  const result = await handleReviewAction(config, 42, 99, 'cb1', { kind: 'review_decide', map: MAP, item: ITEM, decision: 'keep' })
  assert.deepEqual(result, { done: false })
  assert.deepEqual(telegram, ['answerCallbackQuery'])
})
