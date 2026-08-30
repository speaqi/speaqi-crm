#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { createClient } from '@supabase/supabase-js'

function argumentsMap(argv) {
  const result = new Map()
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (!value.startsWith('--')) continue
    result.set(value.slice(2), argv[index + 1]?.startsWith('--') ? true : argv[index + 1] || true)
  }
  return result
}

function loadEnvironment(filePath) {
  for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || !line.includes('=')) continue
    const [key, ...parts] = line.split('=')
    process.env[key.trim()] ||= parts.join('=').trim().replace(/^['"]|['"]$/g, '')
  }
}

function parseCsv(input) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]
    if (quoted && char === '"' && input[index + 1] === '"') {
      field += '"'
      index += 1
    } else if (char === '"') {
      quoted = !quoted
    } else if (!quoted && char === ',') {
      row.push(field)
      field = ''
    } else if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && input[index + 1] === '\n') index += 1
      row.push(field)
      if (row.some((value) => value.length)) rows.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
  }
  if (field.length || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

function normal(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('it')
    .trim()
}

function text(value) {
  return String(value || '').trim()
}

function startOfRomeDay(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const get = (type) => parts.find((part) => part.type === type)?.value || ''
  const offset = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Rome', timeZoneName: 'longOffset' })
    .formatToParts(now)
    .find((part) => part.type === 'timeZoneName')?.value || 'GMT+00:00'
  const match = offset.match(/^GMT([+-])(\d{2}):(\d{2})$/)
  const minutes = match ? (Number(match[2]) * 60 + Number(match[3])) * (match[1] === '+' ? 1 : -1) : 0
  return new Date(Date.UTC(Number(get('year')), Number(get('month')) - 1, Number(get('day'))) - minutes * 60_000)
}

const args = argumentsMap(process.argv.slice(2))
const environmentPath = String(args.get('env') || '')
const sourcePath = String(args.get('source') || '')
const requestedLimit = Math.max(1, Math.min(500, Number(args.get('limit') || 100)))
const apply = args.has('apply')

if (!environmentPath || !sourcePath) {
  throw new Error('Uso: node scripts/import_wine_project_pilot.mjs --env /percorso/.env.local --source /percorso/vinitaly.csv [--limit 100] [--apply]')
}

loadEnvironment(environmentPath)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!supabaseUrl || !serviceRoleKey) throw new Error('Configurazione Supabase incompleta.')

const table = parseCsv(fs.readFileSync(sourcePath, 'utf8').replace(/^\uFEFF/, ''))
const headers = table[0]
const column = (name) => {
  const position = headers.indexOf(name)
  if (position < 0) throw new Error(`Colonna CSV mancante: ${name}`)
  return position
}
const companyColumn = column('Nome azienda')
const typeColumn = column('Tipologia')
const emailColumn = column('emailmarketing')
const firstNameColumn = column('Nome')
const lastNameColumn = column('Cognome')
const phoneColumn = column('Info | Numeri di telefono')
const siteColumn = column('Info | Siti Web')
const emailPattern = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const genericNames = new Set(['info', 'marketing', 'commerciale', 'amministrazione', 'reception', 'staff', 'contatti', 'contact', 'azienda', 'cantina', 'segreteria', 'vendite', 'sales', 'direzione'])
const validName = (value) => /^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ .'-]{1,59}$/.test(text(value)) && !genericNames.has(normal(value))

const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
const { data: wineContacts, error: wineContactsError } = await supabase
  .from('contacts')
  .select('user_id')
  .eq('event_tag', 'wine-project')
  .limit(100)
if (wineContactsError) throw wineContactsError
const workspaceIds = [...new Set((wineContacts || []).map((contact) => contact.user_id).filter(Boolean))]
let userId = workspaceIds.length === 1 ? workspaceIds[0] : null
if (!userId) {
  const { data: teamMembers, error: teamMembersError } = await supabase
    .from('team_members')
    .select('user_id, name, email')
    .limit(500)
  if (teamMembersError) throw teamMembersError
  const candidates = [...new Set((teamMembers || [])
    .filter((member) => normal(member.name).includes('massimo') || ['piquattrodigital@gmail.com', 'massimo@speaqi.com'].includes(normal(member.email)))
    .map((member) => member.user_id)
    .filter(Boolean))]
  if (candidates.length === 1) userId = candidates[0]
}
if (!userId) {
  throw new Error(`Impossibile determinare un workspace Wine Project (${workspaceIds.length} flussi Wine e nessun team Massimo univoco).`)
}

const existingEmails = new Set()
for (let offset = 0; ; offset += 1000) {
  const { data, error } = await supabase
    .from('contacts')
    .select('email')
    .eq('user_id', userId)
    .not('email', 'is', null)
    .range(offset, offset + 999)
  if (error) throw error
  for (const contact of data || []) existingEmails.add(normal(contact.email))
  if (!data || data.length < 1000) break
}

const selected = []
const seenEmail = new Set()
const seenCompany = new Set()
let skippedExisting = 0
for (let rowNumber = 1; rowNumber < table.length; rowNumber += 1) {
  const row = table[rowNumber]
  const company = text(row[companyColumn])
  const kind = text(row[typeColumn])
  const email = normal(row[emailColumn])
  const firstName = text(row[firstNameColumn])
  const lastName = text(row[lastNameColumn])
  if (
    normal(kind) !== 'winery' ||
    normal(company).includes('consorz') ||
    !emailPattern.test(email) ||
    !validName(firstName) ||
    !validName(lastName) ||
    seenEmail.has(email) ||
    seenCompany.has(normal(company))
  ) continue
  seenEmail.add(email)
  seenCompany.add(normal(company))
  if (existingEmails.has(email)) {
    skippedExisting += 1
    continue
  }
  selected.push({
    legacy_id: `vinitaly-2026-${rowNumber + 1}`,
    name: `${firstName} ${lastName}`,
    email,
    phone: text(row[phoneColumn]) || null,
    company,
    category: 'Wine Project',
    event_tag: 'wine-project',
    list_name: 'Wine Project - Pilot 100 - Vinitaly',
    source: 'vinitaly-2026',
    status: 'New',
    contact_scope: 'crm',
    priority: 1,
    last_activity_summary: 'Import pilota Wine Project: 100 cantine Vinitaly filtrate.',
    note: `Sito: ${text(row[siteColumn]) || 'non disponibile'} - Import pilota filtrato: solo Winery, esclusi consorzi e duplicati.`,
    user_id: userId,
  })
  if (selected.length === requestedLimit) break
}

if (selected.length !== requestedLimit) throw new Error(`Trovati ${selected.length} contatti idonei; richiesti ${requestedLimit}.`)

if (!apply) {
  console.log(JSON.stringify({
    dry_run: true,
    user_workspace_resolved: true,
    selected: selected.length,
    skipped_existing_email: skippedExisting,
    companies_preview: selected.slice(0, 8).map((contact) => contact.company),
  }))
  process.exit(0)
}

const { data: insertedContacts, error: insertError } = await supabase
  .from('contacts')
  .insert(selected)
  .select('id, company')
if (insertError) throw insertError
if ((insertedContacts || []).length !== selected.length) throw new Error('Import incompleto: nessuna pianificazione è stata avviata.')

const start = startOfRomeDay()
const schedule = [0, 4, 9, 16, 28]
const events = (insertedContacts || []).flatMap((contact) => schedule.map((days, index) => ({
  user_id: userId,
  contact_id: contact.id,
  sequence: index + 1,
  status: 'scheduled',
  due_at: new Date(start.getTime() + days * 24 * 60 * 60 * 1000).toISOString(),
})))
const { error: eventsError } = await supabase
  .from('wine_project_followup_events')
  .upsert(events, { onConflict: 'contact_id,sequence', ignoreDuplicates: true })
if (eventsError) throw eventsError

console.log(JSON.stringify({
  imported: insertedContacts.length,
  planned_events: events.length,
  first_message_due: start.toISOString(),
  remaining_messages_scheduled: 4,
}))
