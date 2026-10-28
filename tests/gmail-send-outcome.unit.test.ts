import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

process.env.GOOGLE_CLIENT_ID = 'client-test'
process.env.GOOGLE_CLIENT_SECRET = 'secret-test'
process.env.GOOGLE_REDIRECT_URI = 'http://localhost/api/gmail/callback'
process.env.GMAIL_TOKEN_ENCRYPTION_KEY = 'chiave-di-prova-lunga-almeno-32-caratteri'

type Scenario = { send: number; read: number }

async function attempt(scenario: Scenario) {
  const gmail = await import('../src/lib/server/gmail')
  const account = { id: 'acc', user_id: 'u', email: 'me@x.it', refresh_token: gmail.encryptSecret('refresh'), scope: '' }
  const supabase = {
    from: () => {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: account, error: null }),
      }
      return chain
    },
  }
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (url: unknown) => {
    const href = String(url)
    if (href.includes('oauth2')) return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 })
    if (href.endsWith('/messages/send')) {
      return scenario.send === 200
        ? new Response(JSON.stringify({ id: 'm1', threadId: 't1' }), { status: 200 })
        : new Response(JSON.stringify({ error: { message: `send ${scenario.send}` } }), { status: scenario.send })
    }
    return new Response(JSON.stringify({ error: { message: 'lettura fallita' } }), { status: scenario.read })
  }) as typeof fetch
  try {
    await gmail.sendContactEmail(supabase, 'u', { id: 'c', email: 'cliente@x.it' } as any, {
      subject: 'Ciao',
      html: '<p>ciao</p>',
      text: 'ciao',
      appendSignature: false,
    })
    return { gmail, error: null as unknown }
  } catch (error) {
    return { gmail, error }
  } finally {
    globalThis.fetch = originalFetch
  }
}

describe('esito di sendContactEmail: si può reinviare solo se non è partita', () => {
  test('Gmail rifiuta (4xx): errore normale, la bozza può tornare in coda', async () => {
    const { gmail, error } = await attempt({ send: 400, read: 500 })
    assert.ok(error instanceof gmail.GmailRequestError)
    assert.equal(error instanceof gmail.GmailSendOutcomeError, false)
    assert.match((error as Error).message, /send 400/)
  })

  test('errore 5xx sull’invio: esito incerto', async () => {
    const { gmail, error } = await attempt({ send: 503, read: 500 })
    assert.ok(error instanceof gmail.GmailSendOutcomeError)
    assert.equal((error as InstanceType<typeof gmail.GmailSendOutcomeError>).outcome, 'unknown')
  })

  test('partita, registrazione nel CRM fallita: inviata, con l’id Gmail', async () => {
    const { gmail, error } = await attempt({ send: 200, read: 500 })
    assert.ok(error instanceof gmail.GmailSendOutcomeError)
    const outcome = error as InstanceType<typeof gmail.GmailSendOutcomeError>
    assert.equal(outcome.outcome, 'sent')
    assert.equal(outcome.gmailMessageId, 'm1')
  })
})

describe('invio incerto: la riconciliazione decide quando Gmail lo sa', () => {
  test('trovato fra le inviate: inviata; assente dopo mezz’ora: in coda; prima: si aspetta', async () => {
    const { uncertainDraftDecision, UNCERTAIN_SEND_GRACE_MS } = await import('../src/lib/server/draft-reconcile')
    const now = Date.parse('2026-10-28T10:00:00Z')
    const recent = new Date(now - 5 * 60 * 1000).toISOString()
    const old = new Date(now - UNCERTAIN_SEND_GRACE_MS - 1000).toISOString()
    assert.equal(uncertainDraftDecision({ foundInGmail: true, attemptAt: recent, now }), 'sent')
    assert.equal(uncertainDraftDecision({ foundInGmail: false, attemptAt: recent, now }), 'wait')
    assert.equal(uncertainDraftDecision({ foundInGmail: false, attemptAt: old, now }), 'requeue')
    // Senza ora del tentativo non si rimette in coda: meglio aspettare che reinviare.
    assert.equal(uncertainDraftDecision({ foundInGmail: false, attemptAt: null, now }), 'wait')
  })
})
