import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cityForEntity, crmErrorText, entitySearchPattern, pickOrderEntity, siteCandidates, siteMatchesEntity, websiteFromText } from '../src/lib/office/entity-activation'
import { activateEntityForOrder } from '../src/lib/server/office-entity-activation'
import { BudgetExceeded, type AgentContext } from '../src/lib/server/office-agents'

const ENTITY = { id: 'e1', name: 'VISIT BERGAMO', country_code: 'IT', type_code: 'dmo', aliases: [], website: null, email: null, phone: null, status: 'NEEDS_REVIEW' }
const ctx = { agent: { model: 'gpt-5-mini', user_id: 'owner' } } as unknown as AgentContext
const HOME = '<html><body><h1>VisitBergamo</h1><p>VisitBergamo è l’agenzia per il turismo di Bergamo e del suo territorio.</p><footer>Scrivici: info@visitbergamo.example</footer></body></html>'
const fetchPage = async (url: string) => url.includes('visitbergamo.example')
  ? { status: 200, text: HOME, bytes: HOME.length, headers: {} }
  : { status: 404, text: '', bytes: 0, headers: {} }
const fakeAdmin = () => {
  const calls: any[] = []
  return { calls, rpc: async (name: string, args: any) => { calls.push({ name, args }); return { data: { place_id: 'p1', contact_id: 'c1', contact_created: true, crm_error: null, filled: ['website', 'email'] }, error: null } } }
}

test('il sito si prende dall’ordine, mai da un’email o da un social', () => {
  assert.equal(websiteFromText('presentazione per Visit Bergamo, sito visitbergamo.net'), 'https://visitbergamo.net')
  assert.equal(websiteFromText('scrivi a info@visitbergamo.net'), null)
  assert.equal(websiteFromText('https://www.facebook.com/visitbergamo'), null)
  assert.deepEqual(siteCandidates('Il sito è https://www.visitbergamo.net/it/', ['https://it.wikipedia.org/wiki/Bergamo', 'https://visitbergamo.net/contatti']),
    ['https://www.visitbergamo.net', 'https://visitbergamo.net'])
})

test('un sito vale solo se nomina l’ente; la città si ritrova nel nome', () => {
  assert.equal(siteMatchesEntity('https://www.visitbergamo.example', 'Benvenuti', 'VISIT BERGAMO'), true)
  assert.equal(siteMatchesEntity('https://www.hotel-roma.example', 'Un hotel a Roma', 'VISIT BERGAMO'), false)
  assert.equal(cityForEntity({ proposed: 'Bergamo', entityName: 'VISIT BERGAMO', orderText: '' }), 'Bergamo')
  assert.equal(cityForEntity({ proposed: 'Milano', entityName: 'VISIT BERGAMO', orderText: 'presentazione per visit bergamo' }), 'Bergamo')
  assert.equal(cityForEntity({ proposed: null, entityName: 'Office de Tourisme de Marseille', orderText: '' }), 'Marseille')
  assert.equal(cityForEntity({ proposed: null, entityName: 'ATL del Ponente', orderText: '' }), null)
  assert.match(crmErrorText('Ambiguous CRM match: review existing contacts')!, /più contatti con lo stesso nome/)
})

test('ente non attivo e senza sito: lo cerca, lo legge, prende l’email e lo attiva a nome del titolare', async () => {
  const admin = fakeAdmin()
  const model = async (_ctx: AgentContext, options: any) => options.webSearch
    ? { text: 'https://www.visitbergamo.example', citations: ['https://www.visitbergamo.example'], costCents: 1, tokensIn: 1, tokensOut: 1 }
    : { text: JSON.stringify({ identity_quote: 'VisitBergamo è l’agenzia per il turismo di Bergamo e del suo territorio.', identity_url: 'https://www.visitbergamo.example/',
        coverage_relation: 'COVERS', coverage_quote: 'VisitBergamo è l’agenzia per il turismo di Bergamo e del suo territorio.', coverage_url: 'https://www.visitbergamo.example/',
        email: 'info@visitbergamo.example', email_quote: 'Scrivici: info@visitbergamo.example', email_url: 'https://www.visitbergamo.example/',
        phone: '', phone_quote: '', phone_url: '', decision_maker_type: '', decision_maker_quote: '', decision_maker_url: '' }), costCents: 1, tokensIn: 1, tokensOut: 1 }
  const result = await activateEntityForOrder(admin, ctx, 'owner', ENTITY, { orderText: 'Prepara la presentazione per visit bergamo', proposedCity: 'Bergamo' },
    { model: model as any, fetchPage })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.placeId, 'p1')
  assert.match(result.note, /ho trovato il sito visitbergamo\.example/)
  assert.match(result.note, /aggiunto ai contatti/)
  const payload = admin.calls[0].args.p_payload
  assert.equal(admin.calls[0].name, 'tourism_activate')
  assert.equal(payload.origin, 'director'); assert.equal(payload.city, 'Bergamo')
  assert.equal(payload.website, 'https://www.visitbergamo.example'); assert.equal(payload.email, 'info@visitbergamo.example')
  assert.equal(payload.coverage.relation, 'COVERS')
})

test('senza sito trovato o senza budget non scrive niente e chiede il sito', async () => {
  const admin = fakeAdmin()
  const nothing = async () => ({ text: 'NESSUNO', citations: [], costCents: 1, tokensIn: 1, tokensOut: 1 })
  const result = await activateEntityForOrder(admin, ctx, 'owner', ENTITY, { orderText: 'presentazione per visit bergamo', proposedCity: null }, { model: nothing as any, fetchPage })
  assert.equal(result.ok, false)
  assert.match(!result.ok ? result.reply : '', /non ho trovato il suo sito/)
  const broke = async () => { throw new BudgetExceeded() }
  const noBudget = await activateEntityForOrder(admin, ctx, 'owner', ENTITY, { orderText: 'presentazione per visit bergamo', proposedCity: null }, { model: broke as any, fetchPage })
  assert.match(!noBudget.ok ? noBudget.reply : '', /budget/)
  assert.equal(admin.calls.length, 0)
  // Il sito scritto nell'ordine basta, senza ricerca.
  const given = await activateEntityForOrder(admin, ctx, 'owner', ENTITY, { orderText: 'presentazione per visit bergamo, sito visitbergamo.example', proposedCity: null },
    { model: nothing as any, fetchPage })
  assert.equal(given.ok, true)
  assert.equal(admin.calls[0].args.p_payload.website, 'https://visitbergamo.example')
})

test('l’ente di un ordine: l’archiviato non conta, «Visit Bergamo» trova «VisitBergamo», nel dubbio nessuno', () => {
  // Il caso del 25 ottobre: il doppione archiviato veniva scelto al posto di quello verificato.
  const archived = { name: 'VISIT BERGAMO', status: 'NEEDS_REVIEW', disabled: true }
  const good = { name: 'VisitBergamo', status: 'VERIFIED', disabled: false }
  assert.equal(pickOrderEntity([archived, good], 'Visit Bergamo'), good)
  assert.equal(entitySearchPattern('Visit Bergamo'), '%Visit%Bergamo%')
  // Due enti vivi con lo stesso nome: vince l’unico verificato; due verificati, nessuno.
  const twin = { name: 'Visit Bergamo', status: 'UNVERIFIED', disabled: false }
  assert.equal(pickOrderEntity([twin, good], 'visit bergamo'), good)
  assert.equal(pickOrderEntity([{ ...twin, status: 'VERIFIED' }, good], 'visit bergamo'), null)
  // Un nome che non coincide con nessuno vale solo se il risultato è uno.
  const incoming = { name: 'Incoming BERGAMO - ITALY', status: 'UNVERIFIED', disabled: false }
  assert.equal(pickOrderEntity([incoming], 'Bergamo'), incoming)
  assert.equal(pickOrderEntity([incoming, good], 'Bergamo'), null)
  // Un alias vale come il nome; doppioni e inattivi mai.
  assert.equal(pickOrderEntity([{ name: 'Agenzia turistica', aliases: ['Visit Bergamo'], status: 'VERIFIED' }], 'VisitBergamo')?.name, 'Agenzia turistica')
  assert.equal(pickOrderEntity([{ name: 'VisitBergamo', status: 'DUPLICATE' }], 'VisitBergamo'), null)
})
