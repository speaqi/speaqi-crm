#!/usr/bin/env node
/**
 * Backup locale del database Supabase.
 *
 * Il piano Free non ha backup automatici ne point-in-time recovery: se una
 * scrittura sbagliata cancella o sovrascrive dei contatti, non c'e nulla da cui
 * ripartire. Questo script tiene una copia locale, datata, dei dati che
 * fanno male a perdere.
 *
 *   npm run backup              # tabelle predefinite
 *   npm run backup -- contacts  # solo alcune tabelle
 *
 * Scrive in backups/<YYYY-MM-DD_HHMM>/: un JSON per tabella (righe complete,
 * riutilizzabili per un ripristino via upsert), contacts.csv per aprirlo in
 * Excel, e manifest.json con i conteggi.
 *
 * La cartella backups/ e in .gitignore: contiene dati reali e non va su git.
 */

import fs from 'node:fs'
import path from 'node:path'

/** Contatti piu tutto cio che li rende leggibili: storia, impegni, trattative. */
const DEFAULT_TABLES = [
  'contacts',
  'deals',
  'activities',
  'tasks',
  'quotes',
  'lead_memories',
  'pipeline_stages',
  'team_members',
  'user_settings',
]

/** PostgREST tronca a 1000 righe: senza paginazione un backup e silenziosamente incompleto. */
const PAGE_SIZE = 1000

function loadEnv() {
  const fromProcess = {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
  }
  if (fromProcess.url && fromProcess.key) return fromProcess

  const envPath = path.join(process.cwd(), '.env.local')
  if (!fs.existsSync(envPath)) {
    throw new Error('Servono NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY (in .env.local o nell ambiente).')
  }

  const parsed = Object.fromEntries(
    fs
      .readFileSync(envPath, 'utf8')
      .split('\n')
      .filter((line) => line.includes('=') && !line.trim().startsWith('#'))
      .map((line) => {
        const separator = line.indexOf('=')
        return [line.slice(0, separator).trim(), line.slice(separator + 1).trim().replace(/^["']|["']$/g, '')]
      })
  )

  const url = parsed.NEXT_PUBLIC_SUPABASE_URL
  const key = parsed.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('.env.local non contiene NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.')
  }
  return { url, key }
}

async function fetchTable(url, key, table) {
  const rows = []

  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1
    const response = await fetch(`${url}/rest/v1/${table}?select=*&order=id.asc`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Range: `${from}-${to}`,
        Prefer: 'count=exact',
      },
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new Error(`HTTP ${response.status} ${detail.slice(0, 200)}`)
    }

    const page = await response.json()
    if (!Array.isArray(page)) throw new Error('Risposta inattesa dal database')
    rows.push(...page)

    // Ultima pagina: meno righe della dimensione richiesta.
    if (page.length < PAGE_SIZE) break
  }

  return rows
}

function toCsv(rows) {
  if (!rows.length) return ''

  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))]
  const escape = (value) => {
    if (value === null || value === undefined) return ''
    const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
    return /["\n,;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }

  return [
    columns.join(','),
    ...rows.map((row) => columns.map((column) => escape(row[column])).join(',')),
  ].join('\n')
}

async function main() {
  const { url, key } = loadEnv()
  const requested = process.argv.slice(2).filter((arg) => !arg.startsWith('-'))
  const tables = requested.length ? requested : DEFAULT_TABLES

  const now = new Date()
  const stamp = `${now.toISOString().slice(0, 10)}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`
  const outDir = path.join(process.cwd(), 'backups', stamp)
  fs.mkdirSync(outDir, { recursive: true })

  const manifest = { created_at: now.toISOString(), source: url, tables: {} }
  let failed = 0

  for (const table of tables) {
    process.stdout.write(`${table.padEnd(16)} `)
    try {
      const rows = await fetchTable(url, key, table)
      const file = path.join(outDir, `${table}.json`)
      fs.writeFileSync(file, JSON.stringify(rows, null, 2))

      // Verifica: rileggo dal disco, cosi un file troncato o corrotto si vede subito.
      const reread = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (reread.length !== rows.length) throw new Error('file scritto incompleto')

      if (table === 'contacts') {
        fs.writeFileSync(path.join(outDir, 'contacts.csv'), toCsv(rows))
      }

      manifest.tables[table] = { rows: rows.length }
      console.log(`${String(rows.length).padStart(6)} righe`)
    } catch (error) {
      failed += 1
      manifest.tables[table] = { error: error instanceof Error ? error.message : String(error) }
      console.log(`ERRORE: ${error instanceof Error ? error.message : error}`)
    }
  }

  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  console.log(`\nBackup in ${path.relative(process.cwd(), outDir)}`)
  if (failed) {
    console.log(`${failed} tabelle non salvate: controlla manifest.json`)
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(`Backup non riuscito: ${error instanceof Error ? error.message : error}`)
  process.exit(1)
})
