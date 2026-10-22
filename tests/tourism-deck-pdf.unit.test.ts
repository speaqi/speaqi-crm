import assert from 'node:assert/strict'
import test from 'node:test'
import { deckPdfPath, getOrCreateDeckPdf, internalDeckUrl, pdfFileName } from '../src/lib/server/tourism-deck-pdf'
import type { DeckRow } from '../src/lib/server/tourism-decks'

const TOKEN = 'a'.repeat(64)
const row = (over: Partial<DeckRow> = {}) =>
  ({ id: 'd1', user_id: 'u1', status: 'approved', version: 3, public_token: TOKEN, destination: 'Capri', ...over }) as unknown as DeckRow
const PDF = Buffer.from('%PDF-1.7 prova')

function storage() {
  const files = new Map<string, Buffer>()
  const service = {
    storage: {
      from: () => ({
        download: async (p: string) => (files.has(p) ? { data: new Blob([new Uint8Array(files.get(p)!)]), error: null } : { data: null, error: { message: 'no' } }),
        upload: async (p: string, b: Buffer) => (files.set(p, b), { error: null }),
        list: async (folder: string) => ({ data: [...files.keys()].filter((p) => p.startsWith(folder + '/')).map((p) => ({ name: p.slice(folder.length + 1) })) }),
        remove: async (paths: string[]) => (paths.forEach((p) => files.delete(p)), { error: null })
      })
    }
  }
  return { files, service }
}

test('si genera solo una presentazione approvata', async () => {
  const { service } = storage()
  await assert.rejects(getOrCreateDeckPdf(service, row({ status: 'ready' }), async () => PDF), /Approva la presentazione/)
})

test('il PDF si genera una volta e poi si serve dalla cache', async () => {
  const { service, files } = storage()
  let renders = 0
  const render = async (url: string) => { renders++; assert.equal(url, internalDeckUrl(TOKEN)); return PDF }
  assert.deepEqual(await getOrCreateDeckPdf(service, row(), render), PDF)
  assert.deepEqual(await getOrCreateDeckPdf(service, row(), render), PDF)
  assert.equal(renders, 1)
  assert.ok(files.has('u1/d1/deck-v3.pdf'))
})

test('cento richieste insieme fanno un solo Chromium', async () => {
  const { service } = storage()
  let renders = 0
  const render = async () => { renders++; await new Promise((r) => setTimeout(r, 20)); return PDF }
  const all = await Promise.all(Array.from({ length: 100 }, () => getOrCreateDeckPdf(service, row(), render)))
  assert.equal(renders, 1)
  assert.ok(all.every((b) => b.equals(PDF)))
})

test('una versione nuova genera un file nuovo e toglie i vecchi, senza toccare altro', async () => {
  const { service, files } = storage()
  files.set('u1/d1/deck-v1.pdf', PDF)
  files.set('u1/d1/deck-v2.pdf', PDF)
  files.set('u1/d1/foto.png', Buffer.from('x'))
  files.set('u1/altro/deck-v1.pdf', PDF)
  await getOrCreateDeckPdf(service, row({ version: 3 }), async () => PDF)
  assert.deepEqual([...files.keys()].sort(), ['u1/altro/deck-v1.pdf', 'u1/d1/deck-v3.pdf', 'u1/d1/foto.png'])
})

test('un risultato che non è un PDF non si salva', async () => {
  const { service, files } = storage()
  await assert.rejects(getOrCreateDeckPdf(service, row(), async () => Buffer.from('<html>errore</html>')), /non è valido/)
  assert.equal(files.size, 0)
})

test('un errore di Chromium non lascia la richiesta appesa: la successiva riprova', async () => {
  const { service } = storage()
  await assert.rejects(getOrCreateDeckPdf(service, row(), async () => { throw new Error('boom') }), /boom/)
  assert.deepEqual(await getOrCreateDeckPdf(service, row(), async () => PDF), PDF)
})

test('percorso e nome file', () => {
  assert.equal(deckPdfPath(row()), 'u1/d1/deck-v3.pdf')
  assert.equal(pdfFileName('Costiera Amalfitana — Città'), 'speaqi-costiera-amalfitana-citta.pdf')
  assert.equal(pdfFileName('???'), 'speaqi-presentazione.pdf')
})
