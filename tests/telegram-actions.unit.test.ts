import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import {
  deckApproveData, deckCaption, deckKeyboard, deckPdfData, outputData, parseTelegramAction, proposalLines, proposalMessage,
} from '../src/lib/office/telegram-actions'
import { sendTelegramDocument, sendTelegramButtons } from '../src/lib/server/whatsapp'

const ID = '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'

test('i dati dei pulsanti stanno nei 64 byte e si rileggono solo nelle forme note', () => {
  for (const data of [deckApproveData(ID), deckPdfData(ID), outputData(ID, 'approved'), outputData(ID, 'rejected')]) assert.ok(Buffer.byteLength(data) <= 64)
  assert.deepEqual(parseTelegramAction(deckApproveData(ID)), { kind: 'deck_approve', id: ID })
  assert.deepEqual(parseTelegramAction(deckPdfData(ID)), { kind: 'deck_pdf', id: ID })
  assert.deepEqual(parseTelegramAction(outputData(ID, 'approved')), { kind: 'output', id: ID, status: 'approved' })
  assert.deepEqual(parseTelegramAction(outputData(ID, 'rejected')), { kind: 'output', id: ID, status: 'rejected' })
  for (const bad of ['', 'd:a:123', `x:a:${ID}`, `o:z:${ID}`, `d:a:${ID};drop`, null, 42, `o:a:${ID} `.repeat(2)]) assert.equal(parseTelegramAction(bad), null)
})

test('il PDF in bozza si approva col pulsante solo se non resta niente da completare', () => {
  const link = 'https://crm.speaqi.com/tourism/presentazioni/x'
  const ready = deckKeyboard({ id: ID, status: 'ready', todo: 0, link })
  assert.equal(ready[0][0].callback_data, deckApproveData(ID))
  const todo = deckKeyboard({ id: ID, status: 'ready', todo: 2, link })
  assert.ok(todo[0].every((b) => !b.callback_data))
  assert.equal(todo[0][0].url, link)
  assert.ok(deckKeyboard({ id: ID, status: 'approved', todo: 0, link })[0].every((b) => !b.callback_data))
  // Una generazione fallita tiene le slide di prima: niente pulsante, si guarda nell'editor.
  assert.ok(deckKeyboard({ id: ID, status: 'failed', todo: 0, link })[0].every((b) => !b.callback_data))
  assert.match(deckCaption({ title: 'X', status: 'failed', todo: 0, link }), /non è riuscita/)
  assert.match(deckCaption({ title: 'Sibiu · Sibiu County Tourism Association', status: 'ready', todo: 2, link }), /restano 2 \[DA VERIFICARE\]/)
  assert.match(deckCaption({ title: 'X', status: 'ready', todo: 0, link }), /pronta da approvare/)
  assert.ok(deckCaption({ title: 'X'.repeat(3000), status: 'ready', todo: 0, link, note: 'n'.repeat(3000) }).length <= 1000)
})

test('una proposta di contatto si legge senza aprire il JSON', () => {
  const lines = proposalLines({ action: 'create_contact', tipo: 'Partner (hotel, …)', perche: 'Hotel a San Marco',
    contact: { name: null, company: 'Hotel Laguna', email: 'info@hotellaguna.it', phone: null, website: 'https://hotellaguna.it' }, possibili_doppioni: [] })
  assert.deepEqual(lines.filter(Boolean), ['Hotel Laguna', 'info@hotellaguna.it', 'https://hotellaguna.it', 'Tipo: Partner', 'Hotel a San Marco'])
  const msg = proposalMessage({ id: ID, title: 'Partner per Venezia: Hotel Laguna', lines, link: 'https://crm.speaqi.com/ufficio' })
  assert.deepEqual(msg.keyboard[0].map((b) => b.callback_data), [outputData(ID, 'approved'), outputData(ID, 'rejected')])
})

const realFetch = globalThis.fetch
const env = { ...process.env }
afterEach(() => { globalThis.fetch = realFetch; process.env = { ...env } })

test('il PDF parte come documento con didascalia e pulsanti; senza Telegram non parte niente', async () => {
  delete process.env.TELEGRAM_BOT_TOKEN; delete process.env.TELEGRAM_NOTIFY_CHAT_ID; delete process.env.TELEGRAM_ALLOWED_CHAT_IDS
  assert.equal((await sendTelegramDocument({ file: Buffer.from('%PDF-1'), fileName: 'a.pdf', caption: 'x' })).ok, false)
  process.env.TELEGRAM_BOT_TOKEN = 'tok'; process.env.TELEGRAM_ALLOWED_CHAT_IDS = '111,222'
  const calls: Array<{ url: string; body: any }> = []
  globalThis.fetch = (async (url: string, init: any) => {
    calls.push({ url, body: init.body })
    return new Response(JSON.stringify({ ok: true, result: { message_id: 9 } }), { status: 200 })
  }) as any
  const sent = await sendTelegramDocument({ file: Buffer.from('%PDF-1'), fileName: 'speaqi-sibiu.pdf', caption: '*Sibiu*', keyboard: [[{ text: '✅ Approva', callback_data: deckApproveData(ID) }]] })
  assert.equal(sent.ok, true)
  assert.match(calls[0].url, /\/bottok\/sendDocument$/)
  const form = calls[0].body as FormData
  assert.equal(form.get('chat_id'), '111')
  assert.equal(form.get('caption'), '<b>Sibiu</b>')
  assert.equal(JSON.parse(String(form.get('reply_markup'))).inline_keyboard[0][0].callback_data, deckApproveData(ID))
  assert.equal((form.get('document') as File).name, 'speaqi-sibiu.pdf')
  // Il messaggio con i pulsanti va alla chat delle notifiche se è autorizzata…
  process.env.TELEGRAM_NOTIFY_CHAT_ID = '222'
  assert.equal((await sendTelegramButtons('*Proposta*', [[{ text: 'ok', callback_data: 'x' }]])).ok, true)
  assert.equal(JSON.parse(calls[1].body).chat_id, '222')
  // …altrimenti alla prima autorizzata: da una chat non autorizzata i tocchi verrebbero rifiutati.
  process.env.TELEGRAM_NOTIFY_CHAT_ID = '999'
  await sendTelegramButtons('*Proposta*', [[{ text: 'ok', callback_data: 'x' }]])
  assert.equal(JSON.parse(calls[2].body).chat_id, '111')
})
