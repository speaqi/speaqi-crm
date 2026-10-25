import assert from 'node:assert/strict'
import test from 'node:test'
import sharp from 'sharp'
import { freeLicense, photoCandidates, pickDestinationPhotos, photoCredit, photoFileName, commonsSearchUrl, wikiArticleImagesUrl } from '../src/lib/tourism-deck-photos'
import { findDestinationPhotos } from '../src/lib/server/tourism-deck-photos'
import { assignPhotos, photoSlots, DEFAULT_DECK_TEMPLATE } from '../src/lib/tourism-deck'
import { isDirectorPhotoPath } from '../src/lib/server/office-director-photos'
import { presentationQueue } from '../src/lib/office/presentations'

const page = (title: string, patch: Record<string, any> = {}) => ({
  title,
  imageinfo: [{
    mime: 'image/jpeg', width: 4000, height: 2600, thumburl: `https://upload.wikimedia.org/thumb/${encodeURIComponent(title)}.jpg`,
    descriptionurl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(title)}`,
    extmetadata: { LicenseShortName: { value: 'CC BY-SA 4.0' }, Artist: { value: '<a href="x">Mario Rossi</a>' } },
    ...patch
  }]
})

test('solo licenze libere: CC BY, CC BY-SA, CC0, pubblico dominio', () => {
  for (const ok of ['CC BY 4.0', 'CC BY-SA 3.0', 'CC0', 'Public domain', 'PD-self']) assert.equal(freeLicense(ok), true, ok)
  for (const no of ['CC BY-NC 4.0', 'CC BY-ND 2.0', 'Fair use', 'All rights reserved', '']) assert.equal(freeLicense(no), false, no)
})

test('si tengono le foto orizzontali grandi della destinazione; cartine, stemmi e licenze chiuse no', () => {
  const payload = { query: { pages: [
    page('File:Bibione spiaggia.jpg'),
    page('File:Bibione map.jpg'),
    page('File:Stemma Bibione.jpg'),
    page('File:Bibione faro.jpg', { extmetadata: { LicenseShortName: { value: 'CC BY-NC 4.0' } } }),
    page('File:Bibione verticale.jpg', { width: 1200, height: 2000 }),
    page('File:Bibione logo.png', { mime: 'image/png' }),
    page('File:Bibione altro host.jpg', { thumburl: 'https://evil.example.org/x.jpg' })
  ] } }
  const found = photoCandidates(payload, false)
  assert.deepEqual(found.map((c) => c.title), ['File:Bibione spiaggia.jpg'])
  assert.equal(found[0].author, 'Mario Rossi')
  assert.equal(photoCredit(found[0]), 'Foto: Mario Rossi · CC BY-SA 4.0 · Wikimedia Commons')
  assert.equal(photoFileName(found[0]), 'Bibione spiaggia.jpg')
})

test('dalla ricerca vale solo un file che nomina la città; prima la voce Wikipedia, mai due volte', () => {
  const article = photoCandidates({ query: { pages: [page('File:Lungomare.jpg')] } }, true)
  const search = photoCandidates({ query: { pages: [page('File:Lignano tramonto.jpg'), page('File:Bibione_tramonto.jpg'), page('File:Lungomare.jpg')] } }, false)
  const picked = pickDestinationPhotos([...search, ...article], 'Bibione', 3)
  assert.deepEqual(picked.map((c) => c.title), ['File:Lungomare.jpg', 'File:Bibione_tramonto.jpg'])
  assert.match(wikiArticleImagesUrl('it', 'San Michele al Tagliamento'), /titles=San%20Michele%20al%20Tagliamento/)
  assert.match(commonsSearchUrl('Bibione'), /^https:\/\/commons\.wikimedia\.org\//)
})

test('findDestinationPhotos scarica tre foto diverse, solo da upload.wikimedia.org', async () => {
  const jpeg = await sharp({ create: { width: 2400, height: 1500, channels: 3, background: '#3a7' } }).jpeg().toBuffer()
  const asked: string[] = []
  const fetcher = (async (url: string) => {
    asked.push(url)
    if (url.includes('/w/api.php')) {
      const pages = url.includes('it.wikipedia') ? [page('File:Bibione 1.jpg'), page('File:Bibione 2.jpg'), page('File:Bibione 3.jpg'), page('File:Bibione 4.jpg'), page('File:Bibione 5.jpg')] : []
      return { ok: true, json: async () => ({ query: { pages } }) }
    }
    return { ok: true, arrayBuffer: async () => jpeg.buffer.slice(jpeg.byteOffset, jpeg.byteOffset + jpeg.length) }
  }) as unknown as typeof fetch
  const { photos, note } = await findDestinationPhotos('Bibione', 3, fetcher)
  assert.equal(photos.length, 3)
  assert.equal(note, null)
  assert.equal(new Set(photos.map((p) => p.name)).size, 3)
  assert.ok(photos.every((p) => p.credit.includes('Wikimedia Commons') && p.source_url.startsWith('https://commons.wikimedia.org/')))
  // La voce italiana basta: non si cerca oltre.
  assert.equal(asked.filter((u) => u.includes('/w/api.php')).length, 1)
})

test('Wikimedia giù: nessuna foto, il motivo, nessun errore', async () => {
  const fetcher = (async () => { throw new Error('rete') }) as unknown as typeof fetch
  const { photos, note } = await findDestinationPhotos('Bibione', 3, fetcher)
  assert.equal(photos.length, 0)
  assert.match(note!, /Wikimedia non ha risposto/)
})

test('le tre foto vanno su copertina, punto di partenza e proposta, una diversa per slide', () => {
  const slides = DEFAULT_DECK_TEMPLATE.slides.map((s) => ({ ...s, image_asset_id: null }))
  assert.deepEqual(photoSlots(slides).map((s) => s.art), ['cover', 'partenza', 'proposta'])
  const out = assignPhotos(slides, ['a', 'b', 'c', 'd'])
  assert.deepEqual(photoSlots(out).map((s) => s.image_asset_id), ['a', 'b', 'c'])
  // Una scelta già fatta resta; un doppione o una foto sconosciuta si toglie.
  const chosen = slides.map((s) => (s.art === 'cover' ? { ...s, image_asset_id: 'c' } : s.art === 'partenza' ? { ...s, image_asset_id: 'c' } : s.art === 'lingue' ? { ...s, image_asset_id: 'zzz' } : s))
  const fixed = assignPhotos(chosen, ['a', 'b', 'c'])
  assert.deepEqual(photoSlots(fixed).map((s) => s.image_asset_id), ['c', 'a', 'b'])
  assert.equal(fixed.find((s) => s.art === 'lingue')!.image_asset_id, null)
})

test('foto da Telegram: solo percorsi del bucket del Direttore di quel proprietario', () => {
  const U = '11111111-1111-4111-8111-111111111111'
  const P = `${U}/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333.jpg`
  assert.equal(isDirectorPhotoPath(U, P), true)
  assert.equal(isDirectorPhotoPath('99999999-9999-4999-8999-999999999999', P), false)
  assert.equal(isDirectorPhotoPath(U, `${U}/../x.jpg`), false)
  const E = '44444444-4444-4444-8444-444444444444'
  assert.deepEqual(presentationQueue([{ entity_id: E, photos: [P, 'altro/x.jpg', 7] }]), [{ entity_id: E, photos: [P] }])
  assert.deepEqual(presentationQueue([{ entity_id: E, photos: ['x'] }]), [{ entity_id: E }])
})
