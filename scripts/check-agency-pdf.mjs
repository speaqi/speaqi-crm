// Prova operativa su una proposta approvata: pagina vera, Chromium e Storage veri.
// Nell'immagine di produzione: node scripts/check-agency-pdf.mjs <token>
// In locale si può passare il percorso del server standalone come secondo argomento.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const token = process.argv[2] || ''
assert.match(token, /^[a-f0-9]{64}$/, 'Serve il token di una proposta approvata')
const serverPath = path.resolve(process.argv[3] || 'server.js')
const port = '3000'
const base = `http://127.0.0.1:${port}`
const server = spawn(process.execPath, [serverPath], {
  cwd: path.dirname(serverPath),
  env: { ...process.env, PORT: port, HOSTNAME: '127.0.0.1', AUTOMATION_SCHEDULER_ENABLED: 'false', TOURISM_RESEARCH_ENABLED: 'false' },
  stdio: ['ignore', 'inherit', 'inherit']
})
let startupError
server.on('error', (error) => { startupError = error })
const exited = once(server, 'exit').catch(() => undefined)

async function download() {
  const response = await fetch(`${base}/proposta/${token}/pdf`, { redirect: 'manual', signal: AbortSignal.timeout(115_000) })
  assert.equal(response.status, 200, `Download PDF: HTTP ${response.status}`)
  assert.match(response.headers.get('content-type') || '', /^application\/pdf\b/)
  assert.match(response.headers.get('content-disposition') || '', /^attachment;/)
  const pdf = Buffer.from(await response.arrayBuffer())
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF')
  assert.ok(pdf.length > 1000, 'Il PDF è vuoto o incompleto')
  const source = pdf.toString('latin1')
  const pages = (source.match(/\/Type\s*\/Page\b/g) || []).length
  assert.ok(pages > 0, 'Il PDF non contiene pagine')
  assert.match(source, /\/MediaBox\s*\[\s*0\s+0\s+1440\s+810\s*\]/)
  return { bytes: pdf.length, pages, sha256: createHash('sha256').update(pdf).digest('hex') }
}

try {
  let ready = false
  const deadline = Date.now() + 25_000
  while (Date.now() < deadline) {
    if (startupError) throw startupError
    assert.equal(server.exitCode, null, 'Il server di prova è terminato')
    try {
      const response = await fetch(`${base}/login`, { signal: AbortSignal.timeout(1000) })
      await response.arrayBuffer()
      ready = response.ok
    } catch { /* il server sta partendo */ }
    if (ready) break
    await delay(300)
  }
  assert.ok(ready, 'Il server non è partito in tempo')
  const first = await download()
  const cached = await download()
  assert.deepEqual(cached, first, 'Il secondo download non restituisce lo stesso PDF dalla cache')
  console.log(`AGENCY_PDF_VERIFIED ${JSON.stringify({ ...first, downloads: 2 })}`)
} catch (error) {
  console.error('AGENCY_PDF_FAILED', error instanceof Error ? error.message.slice(0, 300) : 'Errore')
  process.exitCode = 1
} finally {
  server.kill('SIGTERM')
  await Promise.race([exited, delay(3000)])
  if (server.exitCode === null && server.signalCode === null) server.kill('SIGKILL')
}
