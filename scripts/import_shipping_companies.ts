/**
 * Catalogo delle compagnie di navigazione passeggeri → CRM (/navigazione).
 *
 * Legge scripts/data/shipping-companies.json (crociere, expedition, fluviali e
 * traghetti di tutto il mondo, con sede, riferimenti e scali a Napoli e
 * Civitavecchia) e lo scrive in `shipping_companies`, creando per ogni
 * compagnia un contatto nella cartella holding "Compagnie di navigazione".
 *
 *   npm run shipping:import                          # prova a secco: report, nessuna scrittura
 *   npm run shipping:import -- --csv navigazione.csv # anche un CSV da aprire in Excel
 *   npm run shipping:import -- --apply               # scrive (workspace da AUTOMATION_WORKSPACE_USER_ID)
 *   npm run shipping:import -- --apply --user-id UUID
 *   npm run shipping:import -- --apply --no-contacts # solo il catalogo, nessun contatto
 *
 * Rilanciarlo e' sicuro: la compagnia si riconosce dallo slug, il contatto da
 * `legacy_id = shipping-<slug>`. Sul contatto gia' esistente si riempiono solo i
 * campi vuoti (telefono, email, sito) — stato, note e responsabile sono lavoro
 * di qualcuno e restano com'erano. Gli scali corretti a mano dalla pagina
 * (`ports_manual`) non vengono sovrascritti.
 */

import fs from 'node:fs'
import path from 'node:path'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import {
  normalizeShippingCatalog,
  SHIPPING_LEGACY_PREFIX,
  ShippingCatalogEntry,
  shippingContactPayload,
  shippingHeadquarters,
  shippingPortsLabel,
  summarizeShipping,
} from '../src/lib/shipping-companies'

const DEFAULT_FILE = path.join(__dirname, 'data', 'shipping-companies.json')
const CHUNK = 200

interface Args {
  file: string
  apply: boolean
  userId: string
  csv: string
  contacts: boolean
}

function parseArgs(argv: string[]): Args {
  const args: Args = { file: DEFAULT_FILE, apply: false, userId: '', csv: '', contacts: true }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--apply') args.apply = true
    else if (arg === '--file') args.file = argv[++index]
    else if (arg === '--user-id') args.userId = argv[++index]
    else if (arg === '--csv') args.csv = argv[++index]
    else if (arg === '--no-contacts') args.contacts = false
    else if (arg === '--help') {
      console.log('Uso: npm run shipping:import -- [--file PATH] [--csv PATH] [--apply [--user-id UUID] [--no-contacts]]')
      process.exit(0)
    } else {
      throw new Error(`Opzione sconosciuta: ${arg}`)
    }
  }
  return args
}

function readEnv() {
  const env: Record<string, string | undefined> = { ...process.env }
  const envPath = path.join(process.cwd(), '.env.local')
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      if (!line.includes('=') || line.trim().startsWith('#')) continue
      const separator = line.indexOf('=')
      const key = line.slice(0, separator).trim()
      if (env[key]) continue
      env[key] = line.slice(separator + 1).trim().replace(/^["']|["']$/g, '')
    }
  }
  return env
}

function csvCell(value: unknown) {
  const raw = value === null || value === undefined ? '' : String(value)
  return /[",\n;]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw
}

function yesNo(value: boolean | null) {
  return value === true ? 'sì' : value === false ? 'no' : 'da verificare'
}

function toCsv(entries: ShippingCatalogEntry[]) {
  const header = [
    'Compagnia', 'Tipo', 'Segmento', 'Gruppo', 'Sede', 'Indirizzo sede', 'Sito', 'Telefono', 'Email',
    'Ufficio Italia', 'Riferimenti', 'Napoli', 'Civitavecchia (Roma)', 'Note scali', 'Navi', 'Attiva',
  ]
  const rows = entries.map((entry) => {
    const office = entry.italy_office
    return [
      entry.name, entry.kind, entry.segment, entry.parent_group, shippingHeadquarters(entry), entry.hq_address,
      entry.website, entry.phone, entry.email,
      office ? [office.city, office.address, office.phone, office.email].filter(Boolean).join(' · ') : '',
      entry.contacts.map((ref) => `${ref.label}: ${ref.value}`).join(' | '),
      yesNo(entry.calls_naples), yesNo(entry.calls_civitavecchia), entry.ports_note,
      entry.ships.join(', '), entry.active ? 'sì' : 'no',
    ].map(csvCell).join(',')
  })
  return `﻿${[header.join(','), ...rows].join('\n')}\n`
}

function chunks<T>(items: T[], size = CHUNK) {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size))
  return result
}

/** Contatti: crea i mancanti, sugli esistenti riempie solo i campi vuoti. */
async function syncContacts(supabase: SupabaseClient, userId: string, entries: ShippingCatalogEntry[]) {
  const contactIds = new Map<string, string>()
  const existing = new Map<string, Record<string, any>>()
  for (const slice of chunks(entries)) {
    const { data, error } = await supabase
      .from('contacts')
      .select('id, legacy_id, phone, email, normalized_website, company, country')
      .eq('user_id', userId)
      .in('legacy_id', slice.map((entry) => `${SHIPPING_LEGACY_PREFIX}${entry.slug}`))
    if (error) throw error
    for (const row of data || []) existing.set(row.legacy_id, row)
  }

  const toInsert = []
  let filled = 0
  for (const entry of entries) {
    const payload = shippingContactPayload(entry, userId)
    const current = existing.get(payload.legacy_id)
    if (!current) {
      toInsert.push(payload)
      continue
    }
    contactIds.set(entry.slug, current.id)
    const patch: Record<string, unknown> = {}
    for (const field of ['phone', 'email', 'normalized_website', 'company', 'country'] as const) {
      if (!current[field] && payload[field]) patch[field] = payload[field]
    }
    if (!Object.keys(patch).length) continue
    const { error } = await supabase.from('contacts').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', current.id)
    if (error) throw error
    filled += 1
  }

  for (const slice of chunks(toInsert)) {
    const { data, error } = await supabase.from('contacts').insert(slice).select('id, legacy_id')
    if (error) throw error
    for (const row of data || []) contactIds.set(String(row.legacy_id).slice(SHIPPING_LEGACY_PREFIX.length), row.id)
  }

  return { contactIds, created: toInsert.length, filled }
}

async function applyCatalog(args: Args, entries: ShippingCatalogEntry[]) {
  const env = readEnv()
  const url = env.NEXT_PUBLIC_SUPABASE_URL
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  const userId = args.userId || env.AUTOMATION_WORKSPACE_USER_ID || ''
  if (!url || !key) throw new Error('--apply richiede NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY (ambiente o .env.local)')
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error('--apply richiede --user-id UUID (o AUTOMATION_WORKSPACE_USER_ID)')

  const supabase = createClient(url, key, { auth: { persistSession: false } })

  const { data: current, error: currentError } = await supabase
    .from('shipping_companies')
    .select('slug, ports_manual, contact_id')
    .eq('user_id', userId)
  if (currentError) throw currentError
  const bySlug = new Map((current || []).map((row: any) => [row.slug, row]))

  const contacts = args.contacts
    ? await syncContacts(supabase, userId, entries)
    : { contactIds: new Map<string, string>(), created: 0, filled: 0 }

  const today = new Date().toISOString().slice(0, 10)
  const now = new Date().toISOString()
  const regular: Record<string, unknown>[] = []
  const manual: Record<string, unknown>[] = []
  for (const entry of entries) {
    const previous = bySlug.get(entry.slug)
    const row: Record<string, unknown> = {
      ...entry,
      user_id: userId,
      contact_id: contacts.contactIds.get(entry.slug) || previous?.contact_id || null,
      checked_at: today,
      updated_at: now,
    }
    if (previous?.ports_manual) {
      // Upsert con colonne diverse: le mancanti diventerebbero null. Due gruppi.
      delete row.calls_naples
      delete row.calls_civitavecchia
      delete row.ports_note
      manual.push(row)
    } else {
      regular.push(row)
    }
  }

  for (const group of [regular, manual]) {
    for (const slice of chunks(group)) {
      const { error } = await supabase.from('shipping_companies').upsert(slice, { onConflict: 'user_id,slug' })
      if (error) throw error
    }
  }

  return {
    user_id: userId,
    companies_created: entries.filter((entry) => !bySlug.has(entry.slug)).length,
    companies_updated: entries.filter((entry) => bySlug.has(entry.slug)).length,
    ports_kept_manual: manual.length,
    contacts_created: contacts.created,
    contacts_filled: contacts.filled,
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const raw = JSON.parse(fs.readFileSync(args.file, 'utf8'))
  const { entries, errors } = normalizeShippingCatalog(raw)
  const summary = summarizeShipping(entries)

  const report: Record<string, unknown> = {
    dry_run: !args.apply,
    file: path.resolve(args.file),
    ...summary,
    discarded: errors,
    naples_list: entries.filter((entry) => entry.calls_naples).map((entry) => entry.name),
    civitavecchia_list: entries.filter((entry) => entry.calls_civitavecchia).map((entry) => entry.name),
    to_verify: entries
      .filter((entry) => entry.active && (entry.calls_naples === null || entry.calls_civitavecchia === null))
      .map((entry) => `${entry.name} (${shippingPortsLabel(entry)})`),
  }

  if (args.csv) {
    fs.writeFileSync(args.csv, toCsv(entries))
    report.csv = path.resolve(args.csv)
  }
  if (args.apply) Object.assign(report, await applyCatalog(args, entries))

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
