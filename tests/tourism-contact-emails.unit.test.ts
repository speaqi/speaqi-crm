import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  classifyEmail, contactPageCandidates, decodeCfEmail, extractEmails, pickBestEmail, registrableDomain, scanEmails
} from '../src/lib/tourism-contact-emails'
import { createHostGate, scanSiteForEmails } from '../src/lib/server/tourism-contact-scan'

const encodeCf = (email: string, key = 0x2a) =>
  key.toString(16).padStart(2, '0') + [...email].map((c) => (c.charCodeAt(0) ^ key).toString(16).padStart(2, '0')).join('')

test('il dominio dell\'ente si confronta senza www e senza sottodomini', () => {
  assert.equal(registrableDomain('www.hotelrossi.it'), 'hotelrossi.it')
  assert.equal(registrableDomain('booking.hotelrossi.it'), 'hotelrossi.it')
  assert.equal(registrableDomain('www.thehotel.co.uk'), 'thehotel.co.uk')
})

test('le forme nascoste ai robot si leggono', () => {
  assert.deepEqual(scanEmails('scrivi a info [at] hotelrossi [dot] it'), ['info@hotelrossi.it'])
  assert.deepEqual(scanEmails('booking(chiocciola)hotelrossi.it'), ['booking@hotelrossi.it'])
  assert.equal(decodeCfEmail(encodeCf('info@hotelrossi.it')), 'info@hotelrossi.it')
})

test('una casella d\'ufficio sul dominio dell\'ente è «role»', () => {
  const domains = ['hotelrossi.it']
  assert.deepEqual(classifyEmail('info@hotelrossi.it', domains), { ok: true, class: 'role', domainMatch: true, freemail: false, rank: 0 })
  assert.equal((classifyEmail('commerciale@hotelrossi.it', domains) as any).class, 'role')
  assert.equal((classifyEmail('booking.roma@hotelrossi.it', domains) as any).class, 'role')
  // Il nome dell'azienda vale come casella dell'azienda.
  assert.equal((classifyEmail('hotelrossi@hotelrossi.it', domains) as any).class, 'role')
})

test('le persone, le PEC, i terzi e i segnaposto non entrano', () => {
  const domains = ['hotelrossi.it']
  assert.deepEqual(classifyEmail('mario.rossi@hotelrossi.it', domains), { ok: false, reason: 'personal' })
  assert.deepEqual(classifyEmail('hotelrossi@pec.it', domains), { ok: false, reason: 'pec' })
  assert.deepEqual(classifyEmail('info@legalmail.it', domains), { ok: false, reason: 'pec' })
  assert.deepEqual(classifyEmail('reservations@booking.com', domains), { ok: false, reason: 'foreign' })
  assert.deepEqual(classifyEmail('logo@2x.png', domains), { ok: false, reason: 'junk' })
  assert.deepEqual(classifyEmail('your@example.com', domains), { ok: false, reason: 'junk' })
  assert.deepEqual(classifyEmail('noreply@hotelrossi.it', domains), { ok: false, reason: 'junk' })
  assert.deepEqual(classifyEmail('privacy@hotelrossi.it', domains), { ok: false, reason: 'junk' })
})

test('una casella su gmail o una parola sola si vede, ma resta «review»', () => {
  const domains = ['hotelrossi.it']
  const free = classifyEmail('reception@gmail.com', domains)
  assert.equal(free.ok && free.class, 'review')
  assert.equal(free.ok && free.freemail, true)
  const single = classifyEmail('romeo@hotelrossi.it', domains)
  assert.equal(single.ok && single.class, 'review')
  assert.deepEqual(classifyEmail('mario.rossi@gmail.com', domains), { ok: false, reason: 'personal' })
})

test('una pagina vera: mailto, testo nascosto e Cloudflare, senza i falsi positivi', () => {
  const html = `<html><body>
    <a href="mailto:info@hotelrossi.it?subject=Ciao">Scrivici</a>
    <img src="/logo@2x.png">
    <p>Direzione: mario.rossi@hotelrossi.it — Prenotazioni: prenotazioni [at] hotelrossi.it</p>
    <p>PEC: hotelrossi@pec.it · Booking: reservations@booking.com</p>
    <a class="__cf_email__" data-cfemail="${encodeCf('commerciale@hotelrossi.it')}">[email&#160;protected]</a>
    <script type="application/ld+json">{"@type":"Hotel","email":"info@hotelrossi.it"}</script>
  </body></html>`
  const { found, rejected } = extractEmails(html, 'https://hotelrossi.it/contatti', ['hotelrossi.it'])
  assert.deepEqual(found.map((f) => f.email).sort(), ['commerciale@hotelrossi.it', 'info@hotelrossi.it', 'prenotazioni@hotelrossi.it'])
  assert.equal(found.find((f) => f.email === 'info@hotelrossi.it')!.via, 'mailto')
  assert.equal(rejected.personal, 1)
  assert.equal(rejected.pec, 1)
  assert.equal(rejected.foreign, 1)
})

test('fra più email vince quella più generica sul dominio dell\'ente', () => {
  const { found } = extractEmails(
    '<body>commerciale@hotelrossi.it info@hotelrossi.it reception@gmail.com romeo@hotelrossi.it</body>', 'https://hotelrossi.it', ['hotelrossi.it'])
  const { best, alternatives } = pickBestEmail(found)
  assert.equal(best?.email, 'info@hotelrossi.it')
  assert.deepEqual(alternatives.map((a) => a.email), ['commerciale@hotelrossi.it', 'romeo@hotelrossi.it', 'reception@gmail.com'])
})

test('le pagine di contatto: prima «contatti», poi «chi siamo», solo dello stesso sito', () => {
  const links = [
    { href: '/chi-siamo', text: 'Chi siamo' }, { href: '/privacy', text: 'Privacy' }, { href: 'https://altro.com/contatti', text: 'Contatti' },
    { href: '/contatti', text: 'Contatti' }, { href: '/camere', text: 'Camere' }, { href: '/catalogo.pdf', text: 'Contatti PDF' }
  ]
  assert.deepEqual(contactPageCandidates('https://www.hotelrossi.it/', links, 3),
    ['https://www.hotelrossi.it/contatti', 'https://www.hotelrossi.it/chi-siamo', 'https://www.hotelrossi.it/privacy'])
})

// --- scansione con un sito finto ---
type Reply = { status: number; text?: string; headers?: Record<string, string> }
const fake = (site: Record<string, Reply>, seen: string[] = []) => async (url: string) => {
  seen.push(url)
  const reply = site[url]
  if (!reply) return { status: 404, text: '', bytes: 0, headers: {} }
  return { status: reply.status, text: reply.text || '', bytes: (reply.text || '').length, headers: { 'content-type': 'text/html', ...reply.headers } }
}
const noWait = async () => undefined
const html = (body: string) => ({ status: 200, text: `<html><body>${body}</body></html>` })

test('scansione: la home non ha l\'email, la pagina contatti sì', async () => {
  const seen: string[] = []
  const result = await scanSiteForEmails('hotelrossi.it', {
    gate: noWait,
    fetchPage: fake({
      'https://hotelrossi.it/robots.txt': { status: 200, text: 'User-agent: *\nDisallow: /admin/' },
      'https://hotelrossi.it/': html('<a href="/contatti">Contatti</a>'),
      'https://hotelrossi.it/contatti': html('Scrivici: info@hotelrossi.it')
    }, seen)
  })
  assert.equal(result.status, 'found')
  assert.equal(result.best?.email, 'info@hotelrossi.it')
  assert.equal(result.best?.url, 'https://hotelrossi.it/contatti')
  assert.ok(seen[0].endsWith('/robots.txt'), 'robots.txt si legge per primo')
})

test('scansione: si ferma appena ha una casella d\'ufficio (niente richieste in più)', async () => {
  const seen: string[] = []
  const result = await scanSiteForEmails('https://hotelrossi.it', {
    gate: noWait,
    fetchPage: fake({
      'https://hotelrossi.it/robots.txt': { status: 404 },
      'https://hotelrossi.it/': html('info@hotelrossi.it <a href="/contatti">Contatti</a>')
    }, seen)
  })
  assert.equal(result.status, 'found')
  assert.equal(seen.filter((u) => u.endsWith('/contatti')).length, 0)
})

test('scansione: segue il redirect a www e accetta il dominio di arrivo', async () => {
  const result = await scanSiteForEmails('http://hotelrossi.it', {
    gate: noWait,
    fetchPage: fake({
      'http://hotelrossi.it/robots.txt': { status: 404 },
      'http://hotelrossi.it/': { status: 301, headers: { location: 'https://www.hotelrossi.it/' } },
      'https://www.hotelrossi.it/robots.txt': { status: 404 },
      'https://www.hotelrossi.it/': html('booking@hotelrossi.it')
    })
  })
  assert.equal(result.best?.email, 'booking@hotelrossi.it')
})

test('scansione: rispetta robots.txt, 403 e 429 senza aggirarli', async () => {
  const seen: string[] = []
  const closed = await scanSiteForEmails('hotelrossi.it', {
    gate: noWait,
    fetchPage: fake({ 'https://hotelrossi.it/robots.txt': { status: 200, text: 'User-agent: *\nDisallow: /' }, 'https://hotelrossi.it/': html('info@hotelrossi.it') }, seen)
  })
  assert.equal(closed.status, 'blocked')
  assert.ok(!seen.includes('https://hotelrossi.it/'), 'la home non si legge se robots.txt la esclude')

  const forbidden = await scanSiteForEmails('hotelrossi.it', {
    gate: noWait, fetchPage: fake({ 'https://hotelrossi.it/robots.txt': { status: 404 }, 'https://hotelrossi.it/': { status: 403 } })
  })
  assert.equal(forbidden.status, 'blocked')

  const unreadableRobots = await scanSiteForEmails('hotelrossi.it', {
    gate: noWait, fetchPage: fake({ 'https://hotelrossi.it/robots.txt': { status: 503 }, 'https://hotelrossi.it/': html('info@hotelrossi.it') })
  })
  assert.equal(unreadableRobots.status, 'blocked')
})

test('scansione: una pagina di contatti esclusa da robots.txt si salta, la home resta valida', async () => {
  const result = await scanSiteForEmails('hotelrossi.it', {
    gate: noWait,
    fetchPage: fake({
      'https://hotelrossi.it/robots.txt': { status: 200, text: 'User-agent: *\nDisallow: /contatti' },
      'https://hotelrossi.it/': html('reception@gmail.com <a href="/contatti">Contatti</a>'),
      'https://hotelrossi.it/contatti': html('info@hotelrossi.it')
    })
  })
  assert.equal(result.status, 'review_only')
  assert.equal(result.best?.email, 'reception@gmail.com')
})

test('scansione: nessun collegamento ai contatti, si provano i percorsi di sempre', async () => {
  const result = await scanSiteForEmails('hotelrossi.it', {
    gate: noWait,
    fetchPage: fake({
      'https://hotelrossi.it/robots.txt': { status: 404 },
      'https://hotelrossi.it/': html('Benvenuti'),
      'https://hotelrossi.it/contatti': html('info@hotelrossi.it')
    })
  })
  assert.equal(result.status, 'found')
})

test('la pausa è per sito: due richieste allo stesso host aspettano, a host diversi no', async () => {
  let clock = 0
  const waits: number[] = []
  const gate = createHostGate(async (ms) => { waits.push(ms); clock += ms }, () => clock)
  await gate('a.it', 1500)
  await gate('a.it', 1500)
  await gate('b.it', 1500)
  assert.deepEqual(waits, [1500])
})
