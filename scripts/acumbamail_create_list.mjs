#!/usr/bin/env node

/**
 * Crea una lista su Acumbamail e ci carica gli iscritti.
 *
 * Sorgente: il JSON prodotto da `import_touring_club_contacts.mjs
 * --emit-acumbamail`, cioe le stesse righe che finiscono nel CRM — email gia
 * validate, deduplicate e con i nomi riparati dal mojibake.
 *
 * Dry run per default: senza `--apply` non tocca Acumbamail, stampa soltanto
 * cosa caricherebbe.
 */

import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Il token sta in .env.local, che un `node script.mjs` non carica da se. */
function envLocal() {
  const path = join(process.cwd(), '.env.local')
  if (!existsSync(path)) return {}
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split('\n')
      .filter((line) => line.includes('=') && !line.trim().startsWith('#'))
      .map((line) => {
        const separator = line.indexOf('=')
        return [line.slice(0, separator).trim(), line.slice(separator + 1).trim().replace(/^["']|["']$/g, '')]
      })
  )
}

const API = 'https://acumbamail.com/api/1'
const MERGE_TAGS = ['first_name', 'full_name', 'greeting', 'company', 'demo_url']

async function call(functionName, token, data = {}) {
  const form = new URLSearchParams()
  for (const [key, value] of Object.entries({ ...data, auth_token: token, response_type: 'json' })) {
    form.set(key, value && typeof value === 'object' ? JSON.stringify(value) : String(value ?? ''))
  }
  const response = await fetch(`${API}/${functionName}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
  })
  const raw = await response.text()
  let payload
  try { payload = raw ? JSON.parse(raw) : {} } catch { payload = { raw } }
  if (!response.ok) {
    throw new Error(`Acumbamail ${functionName} (${response.status}): ${JSON.stringify(payload).slice(0, 400)}`)
  }
  return payload
}

/** L'id torna in forme diverse a seconda della funzione chiamata. */
function extractId(payload) {
  if (typeof payload === 'string' || typeof payload === 'number') return String(payload).trim()
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const direct = payload.id ?? payload.list_id
    if (direct !== undefined && direct !== null && String(direct).trim()) return String(direct)
    const keys = Object.keys(payload)
    if (keys.length === 1 && /^\d+$/.test(keys[0])) return keys[0]
  }
  throw new Error(`Acumbamail non ha restituito un id: ${JSON.stringify(payload).slice(0, 300)}`)
}

function parseArgs(argv) {
  const args = {
    from: '', name: 'Touring Club Italia', sender: 'info@speaqi.com',
    apply: false, chunk: 500, listId: '', locale: '',
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--apply') args.apply = true
    else if (arg === '--from') args.from = argv[++index]
    else if (arg === '--name') args.name = argv[++index]
    else if (arg === '--sender') args.sender = argv[++index]
    else if (arg === '--chunk') args.chunk = Math.max(50, Math.min(1000, Number(argv[++index]) || 500))
    else if (arg === '--list-id') args.listId = argv[++index]
    else if (arg === '--locale') args.locale = argv[++index]
    else if (arg === '--help') {
      console.log([
        'Usage: node scripts/acumbamail_create_list.mjs --from PATH [options]',
        '',
        '  --from PATH      JSON da import_touring_club_contacts.mjs --emit-acumbamail',
        '  --name NAME      nome della lista (default "Touring Club Italia")',
        '  --sender EMAIL   mittente della lista (default info@speaqi.com)',
        '  --locale it|en   carica solo gli iscritti di quella lingua (default: tutti)',
        '  --list-id ID     salta la creazione e carica su una lista esistente',
        '  --chunk N        iscritti per chiamata (default 500)',
        '  --apply          esegue davvero (senza, e un dry run)',
        '',
        'Richiede ACUMBAMAIL_AUTH_TOKEN nell\'ambiente.',
      ].join('\n'))
      process.exit(0)
    }
  }
  if (!args.from) { console.error('Manca --from'); process.exit(1) }
  return args
}

const args = parseArgs(process.argv.slice(2))
const all = JSON.parse(await readFile(args.from, 'utf8'))
const subscribers = args.locale ? all.filter((row) => row.locale === args.locale) : all

console.log(`Sorgente : ${args.from}`)
console.log(`Iscritti : ${subscribers.length}${args.locale ? ` (locale ${args.locale})` : ''}`)
console.log(`Lista    : ${args.listId ? `esistente #${args.listId}` : `nuova "${args.name}"`}`)
console.log(`Mittente : ${args.sender}`)

if (!args.apply) {
  console.log('\nDRY RUN — niente e stato inviato. Aggiungi --apply per eseguire.')
  console.log('Esempio dei primi 3:')
  for (const row of subscribers.slice(0, 3)) console.log(`  ${row.email}  ${row.company}`)
  process.exit(0)
}

const token = process.env.ACUMBAMAIL_AUTH_TOKEN || envLocal().ACUMBAMAIL_AUTH_TOKEN
if (!token) { console.error('Manca ACUMBAMAIL_AUTH_TOKEN (in .env.local o nell\'ambiente)'); process.exit(1) }

let listId = args.listId
if (!listId) {
  listId = extractId(await call('createList', token, {
    name: args.name,
    sender_email: args.sender,
    description: 'Lista Touring Club Italia. Gestita da Speaqi CRM.',
  }))
  console.log(`\nLista creata: #${listId}`)
  for (const field of MERGE_TAGS) {
    await call('addMergeTag', token, { list_id: listId, field_name: field, field_type: 'text' })
  }
  console.log(`Merge tag aggiunti: ${MERGE_TAGS.join(', ')}`)
}

let uploaded = 0
for (let cursor = 0; cursor < subscribers.length; cursor += args.chunk) {
  const slice = subscribers.slice(cursor, cursor + args.chunk).map((row) => ({
    email: row.email,
    company: row.company,
    full_name: row.company,
  }))
  await call('batchAddSubscribers', token, {
    list_id: listId,
    update_subscriber: 1,
    complete_json: 1,
    subscribers_data: slice,
  })
  uploaded += slice.length
  process.stderr.write(`\r  caricati ${uploaded}/${subscribers.length}`)
}
process.stderr.write('\n')

const stats = await call('getListStats', token, { list_id: listId })
console.log(`\nFatto. Lista #${listId} — iscritti totali secondo Acumbamail: ${stats?.total_subscribers ?? '?'}`)
