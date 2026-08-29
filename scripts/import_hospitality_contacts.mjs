#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const DEFAULT_FILE = '/Users/massimo/Downloads/Hotel Totale - Hotel Italia Full.csv'
const DEFAULT_LIST = 'Hospitality Italia 2026'
const DEFAULT_EVENT = 'hospitality-project'
const DEFAULT_SOURCE = 'hotel-italia-full'
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i
const PERSONAL_NAME_BLOCKLIST = /^(?:info|booking|reception|receptions?|hotel|albergo|agriturismo|amministrazione|commerciale|marketing|office|reservations?|direzione|staff|contact|contatti|posta|email|mail|webmaster|supporto|segreteria)(?:\s|$)/i
const FREE_OR_AGENCY_DOMAINS = new Set([
  'gmail.com', 'hotmail.com', 'outlook.com', 'libero.it', 'virgilio.it', 'yahoo.com',
  'yahoo.it', 'icloud.com', 'live.it', 'tiscali.it', 'alice.it', 'pec.it', 'beb.it',
])
const INCLUDE = [
  'hotel', 'resort', 'bed & breakfast', 'bed and breakfast', 'b&b', 'agriturismo',
  'residence', 'camping', 'campeggio', 'casa vacanza', 'case vacanza', 'holiday home',
  'villa', 'ostello', 'hostel', 'pensione', 'relais', 'lodge', 'locanda', 'motel',
  'guest house', 'guesthouse', 'affittacamere', 'aparthotel', 'chalet', 'rifugio',
  'alloggi al coperto', 'alloggio turistico', 'alloggio completo di servizi',
  'appartamento vacanze', 'appartamento per vacanza', 'alloggio con uso cucina',
  'alloggio in famiglia', 'appartamenti', 'cottage', 'farmstay', 'beherbergung',
  'area di campeggio', 'villaggio di casette da campeggio', 'parco vacanze',
  'area di sosta per camper',
]
const EXCLUDE = [
  'ristorante', 'restaurant', 'pizzeria', 'bar ', 'pub ', 'attrazione', 'museum', 'museo',
  'tour operator', 'agenzia', 'travel agency', 'wedding venue', 'location eventi', 'cantina',
  'winery', 'fornitore', 'supplier', 'associazione', 'consorzio', 'stabilimento balneare',
  'municipio', 'comune', 'azienda agricola', 'fattoria', 'centro convegni', 'spa ',
  'parco divertimenti', 'discoteca', 'night club', 'servizio di catering',
]

function parseArgs(argv) {
  const result = { file: DEFAULT_FILE, apply: false, report: '', batchSize: 250, userId: '' }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--apply') result.apply = true
    else if (arg === '--file') result.file = argv[++index]
    else if (arg === '--report') result.report = argv[++index]
    else if (arg === '--batch-size') result.batchSize = Math.max(10, Number(argv[++index]) || 250)
    else if (arg === '--user-id') result.userId = argv[++index]
    else if (arg === '--help') {
      console.log('Usage: npm run hospitality:import -- [--file PATH] [--report PATH] [--apply --user-id UUID]')
      process.exit(0)
    }
  }
  return result
}

function parseCsv(text) {
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  const input = text.replace(/^\uFEFF/, '')
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
  const rawHeaders = rows.shift() || []
  const used = new Set()
  const headers = rawHeaders.map((value, index) => {
    const base = value.trim() || `column_${index + 1}`
    let header = base
    let suffix = 2
    while (used.has(header)) header = `${base}_${suffix++}`
    used.add(header)
    return header
  })
  return rows.filter((cells) => cells.some((value) => value.trim())).map((cells) =>
    Object.fromEntries(headers.map((header, index) => [header, cells[index]?.trim() || ''])))
}

function clean(value) {
  const normalized = String(value || '').trim()
  return !normalized || ['#N/A', 'N/A', 'None', 'null'].includes(normalized) ? '' : normalized
}

function normalizeWebsite(value) {
  const raw = clean(value)
  if (!raw) return ''
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`)
    url.hash = ''
    return url.toString().replace(/\/$/, '')
  } catch { return '' }
}

function hostname(value) {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, '') } catch { return '' }
}

function normalizeEmail(value) {
  const email = clean(value).toLowerCase()
  return EMAIL_RE.test(email) ? email : ''
}

function emailDomainLinked(email, website) {
  if (!email) return false
  const domain = email.split('@')[1]
  const siteDomain = hostname(website)
  if (!siteDomain) return !FREE_OR_AGENCY_DOMAINS.has(domain)
  return domain === siteDomain || domain.endsWith(`.${siteDomain}`) || siteDomain.endsWith(`.${domain}`)
}

function genericMailbox(email) {
  return /^(?:info|booking|reception|reservations?|office|admin|commerciale|marketing|contatti|contact|segreteria|posta|mail)@/i.test(email)
}

function personalName(value) {
  const raw = clean(value).replace(/\s+/g, ' ')
  if (!raw || raw.length > 80 || PERSONAL_NAME_BLOCKLIST.test(raw) || /[@\d/_]/.test(raw)) return ''
  const tokens = raw.split(' ').filter(Boolean)
  if (tokens.length > 5 || tokens.some((token) => token.length < 2)) return ''
  return raw
}

function classify(row) {
  const haystack = [row.range, row.subtypes, row.category, row.type, row.name]
    .map((value) => clean(value).toLowerCase()).join(' | ')
  const includes = INCLUDE.filter((term) => haystack.includes(term))
  const excludes = EXCLUDE.filter((term) => haystack.includes(term))
  if (includes.length && !excludes.length) return { decision: 'include', reason: `ricettiva:${includes[0]}` }
  if (excludes.length && !includes.length) return { decision: 'exclude', reason: `non_ricettiva:${excludes[0]}` }
  if (includes.length && excludes.length) {
    if (/agriturismo|hotel|resort|b&b|bed & breakfast|bed and breakfast|residence/.test(haystack)) {
      return { decision: 'include', reason: `ricettiva_mista:${includes[0]}` }
    }
    return { decision: 'review', reason: 'categoria_mista' }
  }
  return { decision: 'review', reason: 'categoria_non_classificata' }
}

function buildRecord(row, userId, batchId) {
  const website = normalizeWebsite(row.site)
  const primary = normalizeEmail(row.email_1)
  const alternatives = [normalizeEmail(row.email_2), normalizeEmail(row.email_3)]
    .filter((email, index, all) => email && email !== primary && all.indexOf(email) === index)
  const classification = classify(row)
  let eligibility = classification.decision === 'include' ? 'eligible' : classification.decision === 'exclude' ? 'excluded' : 'review'
  let reason = classification.reason
  if (!primary) { eligibility = 'excluded'; reason = 'email_primaria_non_valida' }
  else if (!emailDomainLinked(primary, website) && (
    primary.endsWith('@beb.it') || (FREE_OR_AGENCY_DOMAINS.has(primary.split('@')[1]) && genericMailbox(primary))
  )) {
    eligibility = classification.decision === 'include' ? 'review' : eligibility
    reason = `${reason};email_dominio_non_collegato`
  }
  const company = clean(row.name) || clean(row.name_for_emails) || 'Struttura ricettiva'
  const contactName = personalName(row.email_1_full_name)
  const placeId = clean(row.place_id)
  const googleId = clean(row.google_id)
  const structureKey = placeId || googleId || hostname(website) || `email:${primary}`
  return {
    structureKey,
    contact: {
      user_id: userId,
      legacy_id: placeId ? `hotel-place-${placeId}` : `hotel-${createHash('sha1').update(structureKey).digest('hex').slice(0, 20)}`,
      name: contactName || company,
      email: primary || null,
      phone: clean(row.phone) || clean(row.phone_1) || null,
      company,
      category: clean(row.category) || clean(row.type) || null,
      country: clean(row.country) || 'Italy',
      status: 'New',
      source: DEFAULT_SOURCE,
      priority: 0,
      contact_scope: 'holding',
      event_tag: DEFAULT_EVENT,
      list_name: DEFAULT_LIST,
      last_activity_summary: 'Import Hospitality Italia 2026',
      marketing_eligibility: eligibility,
      marketing_reason: reason,
      normalized_website: website || null,
      alternative_emails: alternatives,
      source_place_id: placeId || null,
      source_google_id: googleId || null,
      hospitality_filter_decision: classification.decision,
      import_batch_id: batchId || null,
    },
  }
}

function summarize(records, checksum, file) {
  const byDecision = { include: 0, review: 0, exclude: 0 }
  const byEligibility = { eligible: 0, review: 0, excluded: 0, suppressed: 0 }
  const structures = new Set()
  const primaryEmails = new Set()
  const alternativeEmails = new Set()
  let duplicates = 0
  for (const record of records) {
    byDecision[record.contact.hospitality_filter_decision] += 1
    byEligibility[record.contact.marketing_eligibility] += 1
    if (structures.has(record.structureKey)) duplicates += 1
    structures.add(record.structureKey)
    if (record.contact.email) primaryEmails.add(record.contact.email)
    for (const email of record.contact.alternative_emails) alternativeEmails.add(email)
  }
  return {
    dry_run: true,
    source_file: resolve(file),
    checksum_sha256: checksum,
    total_rows: records.length,
    unique_structures: structures.size,
    duplicate_structure_rows: duplicates,
    unique_primary_emails: primaryEmails.size,
    unique_alternative_emails: alternativeEmails.size,
    filter_decisions: byDecision,
    marketing_eligibility: byEligibility,
    assumptions: { list_name: DEFAULT_LIST, event_tag: DEFAULT_EVENT, source: DEFAULT_SOURCE },
  }
}

async function applyImport(args, records, checksum, report) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key || !args.userId) throw new Error('--apply requires NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and --user-id')
  const supabase = createClient(url, key, { auth: { persistSession: false } })
  const { data: existing, error: existingError } = await supabase.from('commercial_import_batches')
    .select('*').eq('user_id', args.userId).eq('vertical', 'hospitality').eq('checksum_sha256', checksum).maybeSingle()
  if (existingError) throw existingError
  let batch = existing
  if (!batch) {
    const created = await supabase.from('commercial_import_batches').insert({
      user_id: args.userId, vertical: 'hospitality', list_name: DEFAULT_LIST, event_tag: DEFAULT_EVENT,
      source: DEFAULT_SOURCE, source_file: basename(args.file), checksum_sha256: checksum,
      status: 'running', dry_run: false, total_rows: records.length, started_at: new Date().toISOString(), report,
    }).select('*').single()
    if (created.error) throw created.error
    batch = created.data
  }
  let cursor = Math.max(0, Number(batch.cursor_row) || 0)
  let imported = Number(batch.imported_rows) || 0
  for (; cursor < records.length; cursor += args.batchSize) {
    const slice = records.slice(cursor, cursor + args.batchSize).map((record) => ({ ...record.contact, import_batch_id: batch.id }))
    const result = await supabase.from('contacts').upsert(slice, { onConflict: 'user_id,legacy_id', ignoreDuplicates: false })
    if (result.error) throw result.error
    imported += slice.length
    const checkpoint = Math.min(records.length, cursor + slice.length)
    const update = await supabase.from('commercial_import_batches').update({ cursor_row: checkpoint, imported_rows: imported }).eq('id', batch.id)
    if (update.error) throw update.error
  }
  const finalReport = { ...report, dry_run: false, batch_id: batch.id }
  const completed = await supabase.from('commercial_import_batches').update({
    status: 'completed', cursor_row: records.length, imported_rows: imported,
    eligible_rows: report.marketing_eligibility.eligible, review_rows: report.marketing_eligibility.review,
    excluded_rows: report.marketing_eligibility.excluded, report: finalReport, completed_at: new Date().toISOString(),
  }).eq('id', batch.id)
  if (completed.error) throw completed.error
  return finalReport
}

const args = parseArgs(process.argv.slice(2))
const bytes = await readFile(args.file)
const checksum = createHash('sha256').update(bytes).digest('hex')
const rows = parseCsv(bytes.toString('utf8'))
const records = rows.map((row) => buildRecord(row, args.userId || '00000000-0000-0000-0000-000000000000', null))
let report = summarize(records, checksum, args.file)
if (args.apply) report = await applyImport(args, records, checksum, report)
const output = `${JSON.stringify(report, null, 2)}\n`
if (args.report) await writeFile(args.report, output)
process.stdout.write(output)
