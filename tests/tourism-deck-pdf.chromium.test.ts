/**
 * Prova il Chromium vero (@sparticuz/chromium): apre una pagina servita in locale con due
 * slide 1920x1080 e deve tornare un PDF di due pagine 16:9. È la prova che il binario
 * parte nello stesso tipo di immagine Ubuntu di Railway. Lenta (qualche secondo), a parte:
 * `npm run test:tourism:pdf`.
 */
import assert from 'node:assert/strict'
import http from 'node:http'
import test, { after, before } from 'node:test'
import { renderPdf } from '../src/lib/server/tourism-deck-pdf'

const HTML = `<!doctype html><meta charset="utf-8"><style>
@page{size:1920px 1080px;margin:0}body{margin:0}
.s{width:1920px;height:1080px;break-after:page;background:#1d2d44;color:#faf7ed;font:90px sans-serif;display:grid;place-items:center}
</style><div class="s">Capri · àèìòù €</div><div class="s">Seconda slide</div>`

let server: http.Server
let url = ''
before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/missing') return void res.writeHead(404).end('no')
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(HTML)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
after(() => server.close())

test('una pagina con due slide diventa un PDF di due pagine 16:9', async () => {
  const pdf = await renderPdf(url)
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF')
  const text = pdf.toString('latin1')
  assert.equal((text.match(/\/Type\s*\/Page[^s]/g) || []).length, 2)
  assert.match(text, /\/MediaBox\s*\[\s*0\s+0\s+1440\s+810\s*\]/)
})

test('una pagina che risponde 404 non diventa un PDF', async () => {
  await assert.rejects(renderPdf(url + '/missing'), /non raggiungibile \(404\)/)
})

test('due render insieme vanno in fila e riescono entrambi', async () => {
  const [a, b] = await Promise.all([renderPdf(url), renderPdf(url)])
  assert.ok(a.length > 1000 && b.length > 1000)
})
