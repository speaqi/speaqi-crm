/**
 * Porti, aeroporti e stazioni → Tourism Intelligence (`tourism_hubs`).
 *
 *   # 1. dal dataset pubblico al catalogo versionato (prova a secco: solo report)
 *   npx tsx scripts/tourism/hubs.ts airports --input /percorso/airports.csv
 *   npx tsx scripts/tourism/hubs.ts airports --input /percorso/airports.csv --write
 *
 *   # 2. dal catalogo ai blocchi SQL da applicare sul Supabase del CRM
 *   npx tsx scripts/tourism/hubs.ts sql --input scripts/data/tourism-airports.json --owner UUID
 *
 * `airports.csv` e' quello di OurAirports (pubblico dominio):
 * https://github.com/davidmegginson/ourairports-data. Si scaricano in una
 * cartella vuota, mai dentro il repository.
 *
 * I blocchi SQL hanno la stessa forma di `scripts/tourism/prepare.py`: identita'
 * del proprietario in transazione e ruolo authenticated, quindi RLS e
 * `auth.uid()` come in pagina. Applicarli piu' volte non cambia niente:
 * `tourism_import_hubs` ritrova l'hub per codice e riempie solo i vuoti.
 */

import fs from 'node:fs'
import path from 'node:path'
import { parseCsvText } from '../../src/lib/csv-import'
import {
  airportsFromOurAirports,
  dedupeHubs,
  HubImport,
  hubImportSql,
  normalizeHub,
  summarizeHubs,
} from '../../src/lib/tourism-hubs'

const CATALOGS = {
  airports: 'scripts/data/tourism-airports.json',
} as const

function option(name: string, fallback?: string) {
  const index = process.argv.indexOf(`--${name}`)
  if (index === -1) return fallback
  const value = process.argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`--${name} vuole un valore`)
  return value
}

const flag = (name: string) => process.argv.includes(`--${name}`)

function readCatalog(file: string): HubImport[] {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  const list = Array.isArray(raw) ? raw : raw.hubs
  if (!Array.isArray(list)) throw new Error(`${file}: serve un array o { "hubs": [...] }`)
  return list.map((row: Record<string, unknown>) => normalizeHub(row))
}

function airports() {
  const input = option('input')
  if (!input) throw new Error('--input /percorso/airports.csv')
  const rows = parseCsvText(fs.readFileSync(input, 'utf8'))
  const { hubs, skipped } = airportsFromOurAirports(rows)
  const { hubs: unique, duplicates } = dedupeHubs(hubs)
  unique.sort((a, b) => (a.country || '').localeCompare(b.country || '') || a.name.localeCompare(b.name))
  const report = {
    source_rows: rows.length,
    selected: unique.length,
    duplicates: duplicates.length,
    skipped,
    ...summarizeHubs(unique),
  }
  console.log(JSON.stringify(report, null, 2))
  if (!flag('write')) {
    console.log('\nProva a secco: nessun file scritto. Aggiungi --write per aggiornare il catalogo.')
    return
  }
  const out = option('out', CATALOGS.airports)!
  fs.mkdirSync(path.dirname(out), { recursive: true })
  const document = {
    source: 'OurAirports (pubblico dominio), https://ourairports.com/data/',
    filter: 'large_airport | medium_airport, scheduled_service = yes, codice IATA',
    generated_at: new Date().toISOString().slice(0, 10),
    hubs: unique,
  }
  // Una riga per hub: il diff fra due aggiornamenti si legge.
  const body = document.hubs.map((hub) => `    ${JSON.stringify(hub)}`).join(',\n')
  const head = JSON.stringify({ ...document, hubs: [] }, null, 2).replace(/"hubs": \[\]\n\}$/, '"hubs": [\n')
  fs.writeFileSync(out, `${head}${body}\n  ]\n}\n`)
  console.log(`\nScritto ${out}`)
}

function sql() {
  const input = option('input')
  const owner = option('owner', process.env.AUTOMATION_WORKSPACE_USER_ID)
  if (!input || !owner) throw new Error('--input catalogo.json --owner UUID')
  const size = Number(option('batch-size', '500'))
  if (!Number.isInteger(size) || size < 1 || size > 500) throw new Error('--batch-size fra 1 e 500')
  const { hubs, duplicates } = dedupeHubs(readCatalog(input))
  const out = option('out', `backups/tourism-hubs/${path.basename(input, '.json')}`)!
  fs.mkdirSync(out, { recursive: true })
  const batches = Math.ceil(hubs.length / size)
  for (const stale of fs.readdirSync(out)) {
    const match = /^import-(\d{4})\.sql$/.exec(stale)
    if (match && Number(match[1]) >= batches) fs.unlinkSync(path.join(out, stale))
  }
  for (let index = 0; index < hubs.length; index += size) {
    fs.writeFileSync(path.join(out, `import-${String(index / size).padStart(4, '0')}.sql`), hubImportSql(hubs.slice(index, index + size), owner))
  }
  console.log(JSON.stringify({ hubs: hubs.length, duplicates: duplicates.length, batches, out }, null, 2))
}

const commands: Record<string, () => void> = { airports, sql }
const command = commands[process.argv[2] || '']
if (!command) {
  console.error('Uso: hubs.ts airports --input airports.csv [--write] | sql --input catalogo.json --owner UUID')
  process.exit(1)
}
try {
  command()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
