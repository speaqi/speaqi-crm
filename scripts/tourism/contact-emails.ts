/**
 * Cerca le email d'ufficio degli enti italiani che non ne hanno una, leggendo i loro siti pubblici.
 *
 *   npx tsx scripts/tourism/contact-emails.ts --tiers=A,B,C --out=out/contact-emails
 *   npx tsx scripts/tourism/contact-emails.ts --tiers=A --limit=20          # prova su pochi
 *   npx tsx scripts/tourism/contact-emails.ts --types=dmc,tour_operator --resume
 *
 * SOLA LETTURA: legge `tourism_entities` e `tourism_distribution`, scrive file in `--out` e non
 * tocca il database. Le email entrano nel CRM solo dopo che qualcuno ha guardato il CSV.
 *
 * Serve NEXT_PUBLIC_SUPABASE_URL (o SUPABASE_URL) e SUPABASE_SERVICE_ROLE_KEY, nell'ambiente o in
 * .env.local. Con AUTOMATION_WORKSPACE_USER_ID si limita al workspace del titolare.
 *
 * Va lanciato da una rete libera (il workflow GitHub Actions `tourism-contact-emails`, o un computer):
 * dagli ambienti con rete a elenco chiuso i siti degli enti non si raggiungono.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHostGate, scanSiteForEmails, type ScanResult } from '../../src/lib/server/tourism-contact-scan'

type Row = { id: string; name: string; type: string; tier: string; score: number; website: string }
type Line = { row: Row; result: ScanResult; at: string }

const args = new Map<string, string>()
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a)
  if (m) args.set(m[1], m[2] ?? 'true')
}
const opt = (name: string, fallback: string) => args.get(name) ?? fallback

function loadEnv() {
  const file = path.resolve('.env.local')
  if (!fs.existsSync(file)) return
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

async function rest<T>(base: string, key: string, table: string, query: string): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += 1000) {
    const response = await fetch(`${base}/rest/v1/${table}?${query}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Range: `${from}-${from + 999}`, 'Range-Unit': 'items' }
    })
    if (!response.ok) throw new Error(`${table}: HTTP ${response.status} ${(await response.text()).slice(0, 200)}`)
    const page = (await response.json()) as T[]
    rows.push(...page)
    if (page.length < 1000) return rows
  }
}

async function loadRows(): Promise<Row[]> {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/$/, '')
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  if (!base || !key) throw new Error('Servono NEXT_PUBLIC_SUPABASE_URL (o SUPABASE_URL) e SUPABASE_SERVICE_ROLE_KEY.')
  const tiers = opt('tiers', 'A,B,C').split(',').map((t) => t.trim().toUpperCase()).filter(Boolean)
  const types = new Set(opt('types', '').split(',').map((t) => t.trim()).filter(Boolean))
  const owner = process.env.AUTOMATION_WORKSPACE_USER_ID ? `&user_id=eq.${process.env.AUTOMATION_WORKSPACE_USER_ID}` : ''

  const dist = await rest<{ entity_id: string; tier: string; score: number }>(base, key, 'tourism_distribution',
    `select=entity_id,tier,score&tier=in.(${tiers.join(',')})&order=entity_id${owner}`)
  const tierOf = new Map(dist.map((d) => [d.entity_id, d]))
  const entities = await rest<{ id: string; name: string; type_code: string; website: string | null; email: string | null }>(base, key, 'tourism_entities',
    `select=id,name,type_code,website,email&kind=eq.organization&country_code=eq.IT&disabled=eq.false&website=not.is.null&order=id${owner}`)

  const rows: Row[] = []
  for (const e of entities) {
    const d = tierOf.get(e.id)
    if (!d || !e.website?.trim() || (e.email && e.email.trim())) continue
    if (types.size && !types.has(e.type_code)) continue
    rows.push({ id: e.id, name: e.name, type: e.type_code, tier: d.tier, score: Number(d.score) || 0, website: e.website.trim() })
  }
  // Prima i livelli alti, dentro il livello i punteggi più alti: se la corsa si ferma, ha fatto i migliori.
  rows.sort((a, b) => a.tier.localeCompare(b.tier) || b.score - a.score || a.id.localeCompare(b.id))
  const limit = Number(opt('limit', '0'))
  return limit > 0 ? rows.slice(0, limit) : rows
}

const csvCell = (value: unknown) => {
  const text = String(value ?? '')
  return /[;"\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function writeCsv(file: string, lines: Line[]) {
  const header = ['livello', 'tipo', 'ente', 'sito', 'esito', 'classe', 'email', 'trovata_in', 'come', 'sul_dominio', 'altre_email',
    'scartate_personali', 'scartate_di_terzi', 'pagine_lette', 'errore', 'entity_id']
  const body = lines.map(({ row, result: r }) => [
    row.tier, row.type, row.name, row.website, r.status, r.best?.class ?? '', r.best?.email ?? '', r.best?.url ?? '', r.best?.via ?? '',
    r.best ? (r.best.domainMatch ? 'sì' : 'no') : '', r.alternatives.map((a) => a.email).join(' | '),
    r.rejected.personal, r.rejected.foreign, r.pages.length, r.error ?? '', row.id
  ].map(csvCell).join(';'))
  fs.writeFileSync(file, '﻿' + [header.join(';'), ...body].join('\n') + '\n')
}

function summarize(lines: Line[]) {
  const by = <K extends string>(key: (l: Line) => K) => {
    const out: Record<string, Record<string, number>> = {}
    for (const l of lines) { const k = key(l); out[k] ||= {}; out[k][l.result.status] = (out[k][l.result.status] || 0) + 1 }
    return out
  }
  const total: Record<string, number> = {}
  for (const l of lines) total[l.result.status] = (total[l.result.status] || 0) + 1
  return { scanned: lines.length, total, by_tier: by((l) => l.row.tier), by_type: by((l) => l.row.type),
    requests: lines.reduce((n, l) => n + l.result.requests, 0) }
}

async function main() {
  loadEnv()
  const out = path.resolve(opt('out', 'out/contact-emails'))
  fs.mkdirSync(out, { recursive: true })
  const jsonl = path.join(out, 'results.jsonl')
  const done = new Map<string, Line>()
  if (args.has('resume') && fs.existsSync(jsonl)) {
    for (const l of fs.readFileSync(jsonl, 'utf8').split('\n').filter(Boolean)) { const line = JSON.parse(l) as Line; done.set(line.row.id, line) }
  } else if (fs.existsSync(jsonl)) fs.unlinkSync(jsonl)

  const rows = await loadRows()
  const todo = rows.filter((r) => !done.has(r.id))
  console.log(`Enti italiani senza email nei livelli scelti: ${rows.length}. Da leggere: ${todo.length}.`)
  if (args.has('list')) { console.table(todo.slice(0, 20)); return }

  const concurrency = Math.max(1, Math.min(24, Number(opt('concurrency', '8'))))
  const deadline = Number(opt('max-minutes', '0')) > 0 ? Date.now() + Number(opt('max-minutes', '0')) * 60_000 : Infinity
  const gate = createHostGate()
  let next = 0
  let stop = false
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { stop = true; console.log(`\n${signal}: chiudo i siti in corso e scrivo i file.`) })

  const worker = async () => {
    while (!stop && Date.now() < deadline) {
      const row = todo[next++]
      if (!row) return
      let result: ScanResult
      try { result = await scanSiteForEmails(row.website, { gate }) }
      catch (error) { result = { status: 'error', best: null, alternatives: [], pages: [], requests: 0, rejected: { junk: 0, pec: 0, foreign: 0, personal: 0 }, error: (error as Error).message } }
      const line: Line = { row, result, at: new Date().toISOString() }
      done.set(row.id, line)
      fs.appendFileSync(jsonl, JSON.stringify(line) + '\n')
      if (done.size % 50 === 0) console.log(`  ${done.size}/${rows.length} letti`)
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))

  const lines = rows.flatMap((r) => (done.has(r.id) ? [done.get(r.id)!] : []))
  writeCsv(path.join(out, 'contact-emails.csv'), lines)
  const summary = { ...summarize(lines), remaining: rows.length - lines.length, finished_at: new Date().toISOString() }
  fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2))
  console.log(JSON.stringify(summary.total), `— rimasti da leggere: ${summary.remaining}`)
}

main().catch((error) => { console.error(error); process.exit(1) })
