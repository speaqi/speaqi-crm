// Gateway locale compatibile Supabase per le prove end-to-end di Speaqi Agency.
// - /rest/v1/*    → PostgREST vero (RLS, trigger e vincoli veri su Postgres 16)
// - /auth/v1/*    → un utente solo, JWT HS256 firmati con lo stesso segreto di PostgREST
// - /storage/v1/* → bucket su disco (upload, download, list, remove, URL firmati)
// Uso: node tests/agency-stack/gateway.mjs (variabili in stack.sh).
import http from 'node:http'
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync, rmSync } from 'node:fs'
import path from 'node:path'

const PORT = Number(process.env.GATEWAY_PORT || 54321)
const REST = process.env.POSTGREST_URL || 'http://127.0.0.1:54322'
const SECRET = process.env.JWT_SECRET || 'super-secret-jwt-token-with-at-least-32-characters-long'
const STORAGE = process.env.STORAGE_DIR || '/tmp/agency-storage'
const USER = {
  id: process.env.E2E_USER_ID || '11111111-1111-4111-8111-111111111111',
  email: process.env.E2E_USER_EMAIL || 'owner@example.com',
  password: process.env.E2E_USER_PASSWORD || 'password-di-prova'
}
mkdirSync(STORAGE, { recursive: true })

const b64 = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url')
export function sign(payload) {
  const head = b64({ alg: 'HS256', typ: 'JWT' })
  const body = b64(payload)
  return `${head}.${body}.${createHmac('sha256', SECRET).update(`${head}.${body}`).digest('base64url')}`
}
function verify(token) {
  const [h, b, s] = String(token || '').split('.')
  if (!h || !b || !s) return null
  const expected = createHmac('sha256', SECRET).update(`${h}.${b}`).digest('base64url')
  if (expected.length !== s.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(s))) return null
  const payload = JSON.parse(Buffer.from(b, 'base64url').toString())
  if (payload.exp && payload.exp < Date.now() / 1000) return null
  return payload
}
const userJson = () => ({ id: USER.id, aud: 'authenticated', role: 'authenticated', email: USER.email, app_metadata: { provider: 'email' }, user_metadata: { full_name: 'Titolare di prova' }, created_at: '2026-01-01T00:00:00Z' })
const session = () => {
  const exp = Math.floor(Date.now() / 1000) + 3600
  return { access_token: sign({ sub: USER.id, role: 'authenticated', aud: 'authenticated', email: USER.email, exp }), token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: randomUUID(), user: userJson() }
}

const readBody = (req) => new Promise((resolve) => { const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => resolve(Buffer.concat(chunks))) })
const send = (res, status, data, headers = {}) => {
  const body = Buffer.isBuffer(data) ? data : Buffer.from(typeof data === 'string' ? data : JSON.stringify(data))
  res.writeHead(status, { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'content-type': 'application/json', ...headers })
  res.end(body)
}
const safe = (p) => { const n = path.normalize(decodeURIComponent(p)).replace(/^(\.\.(\/|$))+/, ''); return n }
const filePath = (bucket, p) => path.join(STORAGE, safe(bucket), safe(p))
const bucketDir = (b) => path.join(STORAGE, safe(b))
const MIME = new Map()

async function storage(req, res, rest, url) {
  const parts = rest.split('/').filter(Boolean)
  const auth = verify(String(req.headers.authorization || '').replace(/^Bearer /i, ''))
  // URL firmato: si serve senza autenticazione, solo col token giusto.
  if (parts[0] === 'object' && parts[1] === 'sign' && req.method === 'GET') {
    const bucket = parts[2]
    const p = parts.slice(3).join('/')
    const tok = verify(url.searchParams.get('token'))
    if (!tok || tok.url !== `${bucket}/${decodeURIComponent(p)}`) return send(res, 400, { error: 'invalid signature' })
    const fp = filePath(bucket, p)
    if (!existsSync(fp)) return send(res, 404, { error: 'not_found', message: 'Object not found', statusCode: '404' })
    return send(res, 200, readFileSync(fp), { 'content-type': MIME.get(fp) || 'application/octet-stream' })
  }
  if (!auth || auth.role !== 'service_role') return send(res, 403, { error: 'Unauthorized', message: 'service role richiesto', statusCode: '403' })
  if (parts[0] === 'bucket') {
    if (req.method === 'GET' && parts[1]) return existsSync(bucketDir(parts[1])) ? send(res, 200, { id: parts[1], name: parts[1], public: false }) : send(res, 400, { statusCode: '404', error: 'Bucket not found', message: 'Bucket not found' })
    if (req.method === 'POST') { const b = JSON.parse((await readBody(req)).toString() || '{}'); mkdirSync(bucketDir(b.id || b.name), { recursive: true }); return send(res, 200, { name: b.id || b.name }) }
  }
  if (parts[0] === 'object') {
    if (parts[1] === 'list' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString() || '{}')
      const dir = path.join(bucketDir(parts[2]), safe(body.prefix || ''))
      if (!existsSync(dir)) return send(res, 200, [])
      return send(res, 200, readdirSync(dir).map((name) => { const st = statSync(path.join(dir, name)); return st.isDirectory() ? { name, id: null, metadata: null } : { name, id: randomUUID(), metadata: { size: st.size } } }))
    }
    if (parts[1] === 'sign' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString() || '{}')
      const bucket = parts[2]
      const exp = Math.floor(Date.now() / 1000) + Number(body.expiresIn || 60)
      if (Array.isArray(body.paths)) return send(res, 200, body.paths.map((p) => ({ path: p, error: existsSync(filePath(bucket, p)) ? null : 'not found', signedURL: existsSync(filePath(bucket, p)) ? `/object/sign/${bucket}/${p}?token=${sign({ url: `${bucket}/${p}`, exp })}` : null })))
      const p = parts.slice(3).join('/')
      return send(res, 200, { signedURL: `/object/sign/${bucket}/${p}?token=${sign({ url: `${bucket}/${decodeURIComponent(p)}`, exp })}` })
    }
    if (req.method === 'DELETE' && parts.length === 2) {
      const body = JSON.parse((await readBody(req)).toString() || '{}')
      const removed = []
      for (const p of body.prefixes || []) { const fp = filePath(parts[1], p); if (existsSync(fp)) { rmSync(fp); removed.push({ name: p }) } }
      return send(res, 200, removed)
    }
    const bucket = parts[1]
    const p = parts.slice(2).join('/')
    const fp = filePath(bucket, p)
    if (req.method === 'POST' || req.method === 'PUT') {
      if (existsSync(fp) && req.headers['x-upsert'] !== 'true') return send(res, 400, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' })
      mkdirSync(path.dirname(fp), { recursive: true })
      writeFileSync(fp, await readBody(req))
      MIME.set(fp, String(req.headers['content-type'] || 'application/octet-stream'))
      return send(res, 200, { Key: `${bucket}/${p}`, Id: randomUUID() })
    }
    if (req.method === 'GET') {
      if (!existsSync(fp)) return send(res, 400, { statusCode: '404', error: 'not_found', message: 'Object not found' })
      return send(res, 200, readFileSync(fp), { 'content-type': MIME.get(fp) || 'application/octet-stream' })
    }
  }
  return send(res, 404, { error: 'not implemented', path: rest })
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local')
  if (req.method === 'OPTIONS') return send(res, 204, '')
  try {
    if (url.pathname.startsWith('/rest/v1')) {
      const target = `${REST}${url.pathname.slice('/rest/v1'.length) || '/'}${url.search}`
      const headers = { ...req.headers }
      delete headers.host
      delete headers['content-length']
      // Come Kong in Supabase: la apikey vale come Bearer se manca l'Authorization.
      if (!headers.authorization && headers.apikey) headers.authorization = `Bearer ${headers.apikey}`
      const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await readBody(req)
      const r = await fetch(target, { method: req.method, headers, body })
      const out = Buffer.from(await r.arrayBuffer())
      const h = {}
      r.headers.forEach((v, k) => { if (!['content-encoding', 'transfer-encoding', 'content-length', 'connection'].includes(k)) h[k] = v })
      return send(res, r.status, out, h)
    }
    if (url.pathname === '/auth/v1/user') {
      const p = verify(String(req.headers.authorization || '').replace(/^Bearer /i, ''))
      if (!p || p.sub !== USER.id) return send(res, 401, { msg: 'invalid JWT', code: 401 })
      return send(res, 200, userJson())
    }
    if (url.pathname === '/auth/v1/token') {
      const body = JSON.parse((await readBody(req)).toString() || '{}')
      if (url.searchParams.get('grant_type') === 'password' && (body.email !== USER.email || body.password !== USER.password)) return send(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials', code: 400 })
      return send(res, 200, session())
    }
    if (url.pathname === '/auth/v1/logout') return send(res, 204, '')
    if (url.pathname.startsWith('/storage/v1/')) return storage(req, res, url.pathname.slice('/storage/v1/'.length), url)
    return send(res, 404, { error: 'not found' })
  } catch (error) {
    console.error('gateway', error)
    return send(res, 500, { error: String(error?.message || error) })
  }
})
server.listen(PORT, '127.0.0.1', () => console.log(`gateway su http://127.0.0.1:${PORT}`))
