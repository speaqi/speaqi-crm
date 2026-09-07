#!/usr/bin/env node

/**
 * Import Touring Club Italia -> contacts.
 *
 * Il CSV sorgente e mojibake: UTF-8 gia letto una volta come MacRoman ("Caff√®"
 * invece di "Caffè"). Va riparato prima di scrivere, altrimenti le email
 * partono col nome dell'attivita storpiato.
 *
 * Le righe si dividono in due campagne per lingua, perche il motore ha una sola
 * sequenza per campagna: `touring-club` (italiane) e `touring-club-en` (estere).
 *
 * Dry run per default. `--apply` scrive davvero.
 */

import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'

const LIST_NAME = 'Touring Club Italia'
const SOURCE = 'touring-club-italia'
const EVENT_TAG_IT = 'touring-club'
const EVENT_TAG_EN = 'touring-club-en'
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i

// Il Touring Club e la fonte della lista, non un potenziale cliente: le sue
// caselle interne e quelle dei volontari non vanno contattate.
const INTERNAL_DOMAINS = new Set(['touringclub.it', 'volontaritouring.it', 'touringclub.com'])

const ITALIAN_REGIONS = new Set([
  'abruzzo', 'basilicata', 'calabria', 'campania', 'emilia-romagna', 'emilia romagna',
  'friuli venezia giulia', 'friuli-venezia giulia', 'lazio', 'liguria', 'lombardia',
  'marche', 'molise', 'piemonte', 'puglia', 'sardegna', 'sicilia', 'toscana',
  'trentino-alto adige', 'trentino alto adige', 'umbria', "valle d'aosta", 'veneto',
])

const MACROMAN_HIGH =
  'ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø¿¡¬√ƒ≈∆«»… ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄€‹›ﬁﬂ‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ'

const MACROMAN_REVERSE = new Map(
  [...MACROMAN_HIGH].map((char, index) => [char, 0x80 + index])
)

/**
 * Ripara il doppio encoding. Se la stringa non e mojibake (o lo e solo in
 * parte, e i byte non formano UTF-8 valido) si tiene l'originale: meglio un
 * accento sbagliato che un campo distrutto.
 */
function repairMojibake(value) {
  if (!value || !/[√≈‚„†¬–—]/.test(value)) return value
  const bytes = []
  for (const char of value) {
    const code = char.codePointAt(0)
    if (code < 0x80) bytes.push(code)
    else if (MACROMAN_REVERSE.has(char)) bytes.push(MACROMAN_REVERSE.get(char))
    else return value
  }
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true })
    return decoder.decode(Uint8Array.from(bytes))
  } catch {
    return value
  }
}

function parseCsv(text) {
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  const input = text.replace(/^﻿/, '')
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') { cell += '"'; index += 1 }
      else if (char === '"') quoted = false
      else cell += char
    } else if (char === '"') quoted = true
    else if (char === ',') { row.push(cell); cell = '' }
    else if (char === '\n') { row.push(cell); rows.push(row); row = []; cell = '' }
    else if (char !== '\r') cell += char
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  const headers = (rows.shift() || []).map((value, index) => value.trim() || `column_${index + 1}`)
  return rows
    .filter((cells) => cells.some((value) => value.trim()))
    .map((cells) => Object.fromEntries(headers.map((header, index) => [header, repairMojibake((cells[index] || '').trim())])))
}

function normalizeWebsite(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`)
    url.hash = ''
    return url.toString().replace(/\/$/, '')
  } catch { return '' }
}

/**
 * Italiana o estera. Il campo `paese` e vuoto su 10.515 righe, ma quasi tutte
 * portano una regione italiana nell'indirizzo: senza questo recupero
 * finirebbero per sbaglio nella sequenza inglese.
 */
function isItalian(row) {
  const country = String(row.paese || '').trim().toUpperCase()
  if (country) return country === 'IT'
  const region = String(row.regione || '').trim().toLowerCase()
  if (region && ITALIAN_REGIONS.has(region)) return true
  const address = String(row.indirizzo || '').toLowerCase()
  for (const name of ITALIAN_REGIONS) if (address.includes(name)) return true
  return String(row.email || '').trim().toLowerCase().endsWith('.it')
}

function buildRecord(row, userId) {
  const email = String(row.email || '').trim().toLowerCase()
  if (!EMAIL_RE.test(email)) return { skip: 'email_non_valida' }
  const domain = email.split('@')[1]
  if (INTERNAL_DOMAINS.has(domain)) return { skip: 'dominio_interno_touring' }

  const italian = isItalian(row)
  const company = String(row.nome || '').trim() || 'Attività'
  const website = normalizeWebsite(row.sito_web)
  const legacyKey = String(row.id_scube || '').trim()

  return {
    email,
    italian,
    contact: {
      user_id: userId,
      legacy_id: legacyKey
        ? `touring-${legacyKey}`
        : `touring-${createHash('sha1').update(email).digest('hex').slice(0, 20)}`,
      name: company,
      email,
      phone: String(row.telefono || '').trim() || null,
      company,
      category: String(row.tipologia || '').trim() || String(row.categoria || '').trim() || null,
      country: italian ? 'Italy' : String(row.paese || '').trim() || null,
      city: String(row.citta || '').trim() || null,
      status: 'New',
      source: SOURCE,
      priority: 0,
      contact_scope: 'holding',
      event_tag: italian ? EVENT_TAG_IT : EVENT_TAG_EN,
      list_name: LIST_NAME,
      last_activity_summary: `Import ${LIST_NAME}`,
      marketing_eligibility: 'eligible',
      marketing_reason: 'lista Touring Club Italia, attività aperte al pubblico',
      marketing_source_acquired_at: new Date().toISOString(),
      normalized_website: website || null,
      language: italian ? 'it' : 'en',
    },
  }
}

/** Una email = un contatto. Vince la prima riga, che e anche la piu completa. */
function dedupe(records) {
  const byEmail = new Map()
  let duplicates = 0
  for (const record of records) {
    if (byEmail.has(record.email)) { duplicates += 1; continue }
    byEmail.set(record.email, record)
  }
  return { unique: [...byEmail.values()], duplicates }
}

function parseArgs(argv) {
  const args = { file: '', apply: false, userId: '', batchSize: 500, report: '', emit: '' }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--apply') args.apply = true
    else if (arg === '--file') args.file = argv[++index]
    else if (arg === '--user-id') args.userId = argv[++index]
    else if (arg === '--batch-size') args.batchSize = Math.max(50, Number(argv[++index]) || 500)
    else if (arg === '--report') args.report = argv[++index]
    else if (arg === '--emit-acumbamail') args.emit = argv[++index]
    else if (arg === '--help') {
      console.log('Usage: node scripts/import_touring_club_contacts.mjs --file PATH [--emit-acumbamail PATH] [--report PATH] [--apply --user-id UUID]')
      process.exit(0)
    }
  }
  if (!args.file) { console.error('Manca --file'); process.exit(1) }
  return args
}

const args = parseArgs(process.argv.slice(2))
const bytes = await readFile(args.file)
const checksum = createHash('sha256').update(bytes).digest('hex')
const rows = parseCsv(bytes.toString('utf8'))

const userId = args.userId || '00000000-0000-0000-0000-000000000000'
const skipped = {}
const parsed = []
for (const row of rows) {
  const record = buildRecord(row, userId)
  if (record.skip) { skipped[record.skip] = (skipped[record.skip] || 0) + 1; continue }
  parsed.push(record)
}
const { unique, duplicates } = dedupe(parsed)
const italian = unique.filter((record) => record.italian)
const foreign = unique.filter((record) => !record.italian)

const report = {
  dry_run: !args.apply,
  source_file: resolve(args.file),
  file_name: basename(args.file),
  checksum_sha256: checksum,
  total_rows: rows.length,
  skipped,
  duplicate_emails_collapsed: duplicates,
  unique_contacts: unique.length,
  italian_contacts: italian.length,
  foreign_contacts: foreign.length,
  event_tags: { [EVENT_TAG_IT]: italian.length, [EVENT_TAG_EN]: foreign.length },
  list_name: LIST_NAME,
}

if (args.emit) {
  await writeFile(args.emit, `${JSON.stringify(
    unique.map((record) => ({
      email: record.email,
      company: record.contact.company,
      locale: record.italian ? 'it' : 'en',
    })),
    null,
    0
  )}\n`)
  report.acumbamail_payload = resolve(args.emit)
}

if (args.apply) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key || !args.userId) {
    console.error('--apply richiede NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY e --user-id')
    process.exit(1)
  }
  const { createClient } = await import('@supabase/supabase-js')
  const supabase = createClient(url, key, { auth: { persistSession: false } })
  let written = 0
  for (let cursor = 0; cursor < unique.length; cursor += args.batchSize) {
    const slice = unique.slice(cursor, cursor + args.batchSize).map((record) => record.contact)
    const result = await supabase.from('contacts').upsert(slice, { onConflict: 'user_id,legacy_id', ignoreDuplicates: false })
    if (result.error) throw result.error
    written += slice.length
    process.stderr.write(`\r  scritti ${written}/${unique.length}`)
  }
  process.stderr.write('\n')
  report.written = written
}

const output = `${JSON.stringify(report, null, 2)}\n`
if (args.report) await writeFile(args.report, output)
process.stdout.write(output)
