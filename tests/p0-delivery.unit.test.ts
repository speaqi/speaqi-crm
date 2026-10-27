import assert from 'node:assert/strict'
import { afterEach, beforeEach, mock, test } from 'node:test'
import { NextRequest } from 'next/server'
import { GET as gmailCallback } from '../src/app/api/gmail/callback/route'
import { sendDraftAutomatically } from '../src/lib/server/automation-send'
import { subscriptionCheckoutSession } from '../src/lib/server/quote-checkout'

const envKeys = ['STRIPE_SECRET_KEY', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI',
  'GMAIL_TOKEN_ENCRYPTION_KEY'] as const
let saved: Record<string, string | undefined>
beforeEach(() => {
  saved = Object.fromEntries(envKeys.map(key => [key, process.env[key]]))
  for (const key of envKeys) process.env[key] = 'test-only'
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://db.example.test'
  process.env.GOOGLE_REDIRECT_URI = 'https://crm.example.com/api/gmail/callback'
})
afterEach(() => {
  mock.restoreAll()
  for (const key of envKeys) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
})

for (const contactPatch of [
  {hidden: true}, {marketing_eligibility: 'excluded'}, {marketing_eligibility: ' SUPPRESSED '},
  {email_unsubscribed_at: '2026-10-01'}, {marketing_status: 'paused', marketing_paused_until: null},
]) {
  test(`bozze automatiche: nessun claim o invio per ${JSON.stringify(contactPatch)}`, async () => {
    const supabase = {
      from(table: string) {
        assert.ok(['email_drafts', 'contacts'].includes(table), 'Nessuna query successiva ai guardrail')
        const builder = {
          select() { return builder }, eq() { return builder },
          async maybeSingle() {
            return { data: table === 'email_drafts'
              ? {id:'draft',contact_id:'contact',status:'pending',source:'auto',created_at:'2026-01-01'}
              : {id:'contact',email:'client@example.com',contact_scope:'holding',...contactPatch}, error:null }
          },
        }
        return builder
      },
      rpc() { assert.fail('Il contatto escluso non deve acquisire una bozza') },
    }
    const result = await sendDraftAutomatically(supabase,
      {workspaceUserId:'owner',senderUserId:'owner',timezone:'Europe/Rome'},
      {draftId:'draft',minAgeMinutes:0})
    assert.equal(result.sent, false)
    assert.equal(result.reason, 'email_not_eligible')
  })
}

function oauthRequest(code = 'code-a', cookie = 'state-1') {
  return new NextRequest(`https://crm.example.com/api/gmail/callback?state=state-1&code=${code}`, {
    headers: {cookie:`speaqi_gmail_oauth_state=${cookie}`},
  })
}
function oauthNetwork(options: {deleteError?: boolean; expired?: boolean} = {}) {
  let consumed = false
  let exchanges = 0
  mock.method(globalThis, 'fetch', async (input: any, init?: RequestInit) => {
    const url = String(input)
    if (url.includes('/gmail_oauth_states')) {
      assert.equal(init?.method, 'DELETE')
      if (options.deleteError) return Response.json({code:'42501',message:'delete denied'}, {status:403})
      if (consumed) return Response.json([])
      consumed = true
      return Response.json([{state:'state-1',user_id:'owner',code_verifier:'verifier',
        expires_at:new Date(Date.now() + (options.expired ? -60_000 : 60_000)).toISOString()}])
    }
    if (url === 'https://oauth2.googleapis.com/token') {
      exchanges++
      assert.equal(new URLSearchParams(init?.body as URLSearchParams).get('code_verifier'), 'verifier')
      return Response.json({access_token:'access',refresh_token:'refresh'})
    }
    if (url.endsWith('/profile')) return Response.json({emailAddress:'client@example.com'})
    if (url.includes('/gmail_accounts')) return Response.json([])
    assert.fail(`Chiamata inattesa: ${url}`)
  })
  return {exchanges:() => exchanges}
}

test('OAuth: due callback con codici diversi consumano un solo state', async () => {
  const network = oauthNetwork()
  const responses = await Promise.all([gmailCallback(oauthRequest()), gmailCallback(oauthRequest('code-b'))])
  const statuses = responses.map(r => new URL(r.headers.get('location')!).searchParams.get('gmail')).sort()
  assert.deepEqual(statuses, ['connected','error'], responses.map(r => r.headers.get('location')).join('\n'))
  assert.equal(network.exchanges(), 1)
  assert.ok(responses.every(r => /Max-Age=0/i.test(r.headers.get('set-cookie')!)))
})
for (const options of [{deleteError:true}, {expired:true}]) {
  test(`OAuth: nessuno scambio se lo state non è consumabile ${JSON.stringify(options)}`, async () => {
    const network = oauthNetwork(options)
    const response = await gmailCallback(oauthRequest())
    assert.equal(new URL(response.headers.get('location')!).searchParams.get('gmail'), 'error')
    assert.equal(network.exchanges(), 0)
  })
}
test('OAuth: cookie diverso non accede al database né a Google', async () => {
  mock.method(globalThis, 'fetch', async () => assert.fail('Cookie non valido'))
  const response = await gmailCallback(oauthRequest('code-a', 'wrong'))
  assert.equal(new URL(response.headers.get('location')!).searchParams.get('gmail'), 'error')
})

const quote = {id:'quote-1',public_token:'public-1',total_amount:1207.8,currency:'EUR'}
const params = () => new URLSearchParams({mode:'subscription', 'metadata[quote_id]':quote.id, success_url:'https://crm.example.com/success'})
const session = (id = 'cs_new') => ({id,url:`https://checkout.stripe.com/${id}`,mode:'subscription',
  status:'open',client_reference_id:quote.public_token,metadata:{quote_id:quote.id},amount_total:120780,currency:'eur'})

function checkoutNetwork(options: {saveFailsOnce?: boolean; markFailsOnce?: boolean; attempt?: any; existing?: any; readFails?: boolean} = {}) {
  let attempt: any = options.attempt || null
  let serial = 0, saves = 0, marks = 0, created = 0
  const requests: {key:string;body:string}[] = []
  const sessions = new Map<string, any>()
  if (options.existing) sessions.set(options.existing.id, options.existing)
  const stripeKeys = new Map<string, {body:string;session:any}>()
  mock.method(globalThis, 'fetch', async (input: any, init?: RequestInit) => {
    const url = String(input)
    assert.ok(url.startsWith('https://api.stripe.com/v1/checkout/sessions'))
    if (init?.method === 'POST') {
      const key = new Headers(init.headers).get('Idempotency-Key')!
      const body = String(init.body)
      requests.push({key,body})
      if (!stripeKeys.has(key)) {
        created++
        const value = session(`cs_${created}`)
        stripeKeys.set(key,{body,session:value}); sessions.set(value.id,value)
      }
      assert.equal(stripeKeys.get(key)!.body,body, 'Stripe rifiuta parametri diversi per la stessa chiave')
      return Response.json(stripeKeys.get(key)!.session)
    }
    if (options.readFails) return Response.json({error:{message:'unavailable'}},{status:503})
    return Response.json(sessions.get(url.split('/').pop()!))
  })
  const admin = {
    async rpc(name: string, body: any) {
      if (name === 'claim_quote_checkout_attempt') {
        if (!attempt || attempt.attempt_id === body.p_replaces_attempt) {
          attempt = {attempt_id:`attempt-${++serial}`,params:body.p_params,stripe_session_id:null,
            created_at:new Date(Date.now()).toISOString()}
        }
        return {data:structuredClone(attempt),error:null}
      }
      assert.equal(name, 'mark_quote_checkout_created')
      if (++marks === 1 && options.markFailsOnce) return {error:new Error('quote write failed')}
      return {data:null,error:null}
    },
    from(name: string) {
      assert.equal(name, 'quote_checkout_attempts')
      let change: any
      const filters: Record<string,string> = {}
      const builder = {
        update(value: any) { change=value; return builder },
        eq(key: string,value: string) { filters[key]=value; return builder },
        select() { return builder },
        async single() {
          if (++saves === 1 && options.saveFailsOnce) return {error:new Error('attempt write failed')}
          if (filters.attempt_id !== attempt.attempt_id) return {data:null,error:new Error('stale')}
          Object.assign(attempt,change)
          return {data:{attempt_id:attempt.attempt_id},error:null}
        },
      }
      return builder
    },
  }
  return {admin,requests,created:() => created,attempt:() => attempt}
}

test('Stripe: richieste concorrenti al cambio ora condividono chiave e parametri', async () => {
  let now = Date.parse('2026-10-27T09:59:59.999Z')
  mock.method(Date,'now',() => now)
  const network = checkoutNetwork()
  const first = subscriptionCheckoutSession(network.admin,quote,params())
  now++
  const changedParams = params(); changedParams.set('success_url','https://changed.example.com/success')
  const second = subscriptionCheckoutSession(network.admin,quote,changedParams)
  const [a,b] = await Promise.all([first,second])
  assert.equal(a.id,b.id)
  assert.equal(new Set(network.requests.map(r => r.key)).size,1)
  assert.equal(network.created(),1)
})
for (const options of [{saveFailsOnce:true}, {markFailsOnce:true}]) {
  test(`Stripe: errore di persistenza dopo la creazione non duplica la sessione ${JSON.stringify(options)}`, async () => {
    const network = checkoutNetwork(options)
    await assert.rejects(subscriptionCheckoutSession(network.admin,quote,params()), /write failed/)
    const result = await subscriptionCheckoutSession(network.admin,quote,params())
    assert.equal(result.id,'cs_1')
    assert.equal(network.created(),1)
  })
}
test('Stripe: solo una sessione verificata scaduta permette un nuovo tentativo', async () => {
  const network = checkoutNetwork({attempt:{attempt_id:'expired-attempt',params:Object.fromEntries(params()),
    stripe_session_id:'cs_old',created_at:new Date().toISOString()},existing:{...session('cs_old'),status:'expired'}})
  const [a,b] = await Promise.all([
    subscriptionCheckoutSession(network.admin,quote,params()),
    subscriptionCheckoutSession(network.admin,quote,params()),
  ])
  assert.equal(a.id,b.id)
  assert.equal(network.created(),1)
})
for (const options of [{existing:{...session('cs_old'),status:'complete'}}, {existing:session('cs_old'),readFails:true}]) {
  test(`Stripe: esito completo o illeggibile non apre un secondo pagamento ${options.readFails ? 'read failure' : 'complete'}`, async () => {
    const network = checkoutNetwork(options)
    await assert.rejects(subscriptionCheckoutSession(network.admin,{...quote,stripe_checkout_session_id:'cs_old'},params()))
    assert.equal(network.created(),0)
  })
}
test('Stripe: tentativo senza esito oltre la finestra idempotente richiede riconciliazione', async () => {
  const network = checkoutNetwork({attempt:{attempt_id:'orphan',params:Object.fromEntries(params()),
    stripe_session_id:null,created_at:new Date(Date.now()-24*3_600_000).toISOString()}})
  await assert.rejects(subscriptionCheckoutSession(network.admin,quote,params()), /da verificare/)
  assert.equal(network.created(),0)
})
