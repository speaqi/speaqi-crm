// Navigazione su PostgREST vero dopo il passaggio dei porti in tourism_hubs.
// Chiama le funzioni del server (loadShippingPorts, resolveStopPorts) e le
// stesse query delle rotte. Si lancia con: npm run test:postgrest

import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { PostgrestClient } from '../node_modules/@supabase/postgrest-js/dist/index.mjs'
import { loadShippingPorts, PORT_COLUMNS, resolveStopPorts } from '../src/lib/server/shipping-ports'

const OWNER = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const NAPOLI = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001'
const CIVITA = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002'
const b64 = (v: object | Buffer) => Buffer.from(v instanceof Buffer ? v : JSON.stringify(v)).toString('base64url')
function jwt(sub: string) {
  const head = b64({ alg: 'HS256', typ: 'JWT' }), body = b64({ sub, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })
  return `${head}.${body}.${createHmac('sha256', 'test-secret-test-secret-test-secret-1234').update(`${head}.${body}`).digest('base64url')}`
}
const client = (sub: string) => new PostgrestClient('http://127.0.0.1:3901', { headers: { Authorization: `Bearer ${jwt(sub)}` } }) as any
const ok: string[] = []
const step = async (name: string, fn: () => Promise<void>) => { await fn(); ok.push(name); console.log('ok -', name) }

const db = client(OWNER)
await step('loadShippingPorts: porti di base creati sulla tabella (upsert user_id,mode,slug) e letti dalla vista', async () => {
  const ports = await loadShippingPorts(db, OWNER)
  assert.ok(ports.length > 30, String(ports.length))
  const napoli = ports.find((p) => p.id === NAPOLI)!
  assert.equal(napoli.cruise_passengers, 1600000)
  assert.equal(napoli.guide_status, 'planned')
  assert.equal(napoli.guide_source, 'port')
  // un secondo giro non duplica niente
  const again = await loadShippingPorts(db, OWNER)
  assert.equal(again.length, ports.length)
})
await step('itinerari con embed port:tourism_hubs (rotta shipping-itineraries)', async () => {
  const { data, error } = await db.from('shipping_itineraries')
    .select('id, name, stops:shipping_itinerary_stops(id, position, day, port_id, role, port:tourism_hubs(id, slug, name, country, latitude, longitude))')
    .eq('user_id', OWNER)
  assert.ifError(error)
  assert.equal(data[0].stops.length, 2)
  assert.equal(data[0].stops.find((s: any) => s.position === 1).port.slug, 'napoli')
})
await step('vecchio embed port:shipping_ports (per sapere se la vista e trasparente)', async () => {
  const { data, error } = await db.from('shipping_itinerary_stops').select('itinerary_id, port:shipping_ports(slug)').eq('user_id', OWNER)
  console.log('   embed sulla vista:', error ? `errore ${error.code} ${error.message}` : `funziona (${data.length} righe)`)
})
await step('compagnie: tappe con embed port:tourism_hubs(slug) (rotta shipping-companies)', async () => {
  const { data, error } = await db.from('shipping_itinerary_stops').select('itinerary_id, port:tourism_hubs(slug)').eq('user_id', OWNER)
  assert.ifError(error)
  assert.deepEqual(data.map((r: any) => r.port.slug).sort(), ['civitavecchia', 'napoli'])
})
await step('PATCH: update sulla vista con .select().maybeSingle()', async () => {
  const { data, error } = await db.from('shipping_ports').update({ cruise_calls: 600, notes: 'prova', updated_at: new Date().toISOString() })
    .eq('user_id', OWNER).eq('id', NAPOLI).select(PORT_COLUMNS).maybeSingle()
  assert.ifError(error)
  assert.equal(data.cruise_calls, 600)
  const { data: hub } = await db.from('tourism_hubs').select('movements, version').eq('id', NAPOLI).single()
  assert.equal(hub.movements, 600)
  assert.ok(hub.version > 1)
})
await step('PATCH: numero senza anno rifiutato con 23514 (messaggio della rotta)', async () => {
  const { error } = await db.from('shipping_ports').update({ cruise_passengers: 5, passengers_year: null }).eq('id', NAPOLI).select('id').maybeSingle()
  assert.equal(error?.code, '23514')
})
await step('itinerario incollato: porto nuovo creato dalla vista (resolveStopPorts)', async () => {
  const { portIds, created } = await resolveStopPorts(db, OWNER, [{ name: 'Porto Prova Inesistente', country: 'IT', alt: null } as any])
  assert.equal(created.length, 1)
  const { data } = await db.from('tourism_hubs').select('mode').eq('id', portIds[0]).single()
  assert.equal(data.mode, 'sea')
})
await step('save_shipping_itinerary via RPC', async () => {
  const { error } = await db.rpc('save_shipping_itinerary', {
    p_itinerary: { company_id: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001', name: 'Prova' },
    p_stops: [{ position: 1, port_id: CIVITA }],
  })
  assert.ifError(error)
})
await step('DELETE di un porto usato: 23503 (la rotta risponde 409)', async () => {
  const { error } = await db.from('shipping_ports').delete().eq('user_id', OWNER).eq('id', NAPOLI).select('id').maybeSingle()
  assert.equal(error?.code, '23503')
})
await step('merge_shipping_ports via RPC sposta tappe e alias', async () => {
  const { data: extra } = await db.from('shipping_ports').insert({ slug: 'naples-old', name: 'Naples Old', user_id: OWNER }).select('id').single()
  assert.ifError((await db.rpc('merge_shipping_ports', { p_from: extra.id, p_into: NAPOLI })).error)
  const { data } = await db.from('shipping_ports').select('aliases').eq('id', NAPOLI).single()
  assert.ok(data.aliases.includes('Naples Old'))
})
await step('superguida trasferita: letta dalla destinazione, PATCH del porto rifiutato dal vincolo', async () => {
  const { data: roma } = await db.from('tourism_entities').insert({ kind: 'place', name: 'Roma', country_code: 'IT', user_id: OWNER }).select('id').single()
  const { data: moved, error } = await db.rpc('tourism_link_hub_destination', { p_hub: CIVITA, p_destination: roma.id })
  assert.ifError(error)
  assert.equal(moved.moved, true)
  const ports = await loadShippingPorts(db, OWNER)
  const civ = ports.find((p) => p.id === CIVITA)!
  assert.equal(civ.guide_source, 'destination')
  assert.equal(civ.guide_status, 'in_progress')
  const res = await db.from('shipping_ports').update({ guide_status: 'live' }).eq('id', CIVITA).select('id').maybeSingle()
  assert.equal(res.error?.code, '23514')
})
await step('un altro utente (collaboratore o altro workspace) non vede i porti del proprietario', async () => {
  const other = client(OTHER)
  const { data } = await other.from('shipping_ports').select('id').eq('user_id', OWNER)
  assert.equal(data.length, 0)
  const { data: hubs } = await other.from('tourism_hubs').select('id')
  assert.equal(hubs.length, 0)
})
await step('backup: tourism_hubs si pagina come le altre tabelle', async () => {
  const { data, error } = await db.from('tourism_hubs').select('*').order('id').range(0, 999)
  assert.ifError(error)
  assert.ok(data.length > 30)
})
console.log(`\n${ok.length} controlli passati`)
