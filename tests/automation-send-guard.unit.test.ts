import assert from 'node:assert/strict'
import { test } from 'node:test'

// Il client service role si crea senza rete: bastano valori finti. Nessuna
// chiamata al database deve partire prima del kill switch.
process.env.AUTOMATION_SECRET = 'segreto-test'
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:9'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-test'
delete process.env.AUTOMATION_SEND_ENABLED

function sendRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/automation/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-automation-secret': 'segreto-test' },
    body: JSON.stringify(body),
  }) as any
}

test('kill switch spento: anche l’invio ad hoc per contact_id risponde 503', async () => {
  const { POST } = await import('../src/app/api/automation/send/route')
  const originalFetch = globalThis.fetch
  let networkCalls = 0
  globalThis.fetch = (async () => {
    networkCalls += 1
    throw new Error('nessuna chiamata di rete attesa')
  }) as typeof fetch
  try {
    const response = await POST(sendRequest({ contact_id: '00000000-0000-4000-8000-000000000001' }))
    assert.equal(response.status, 503)
    assert.equal(networkCalls, 0)

    const draftResponse = await POST(sendRequest({ draft_id: '00000000-0000-4000-8000-000000000002' }))
    assert.equal(draftResponse.status, 503)
  } finally {
    globalThis.fetch = originalFetch
  }
})
