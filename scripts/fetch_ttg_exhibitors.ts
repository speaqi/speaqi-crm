/**
 * Scarica gli espositori di TTG Travel Experience (ttgexpo.it) e scrive un CSV
 * pronto per «Importa elenco» in /fiere.
 *
 *   npm run ttg:fetch                       # elenco + scheda di ogni espositore
 *   npm run ttg:fetch -- --no-detail        # solo nome e posizione (veloce)
 *   npm run ttg:fetch -- --out scripts/csv/ttg.csv --concurrency 4
 *
 * L'elenco viene dall'API che usa la pagina stessa; ogni scheda e' una GET
 * (circa 2.300): piano, quattro alla volta, con un nuovo tentativo sugli errori.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { parseDetail, parseListCard, splitPosition, TtgDetail } from '../src/lib/ttg-exhibitors'

const BASE = 'https://www.ttgexpo.it'
const LIST_URL = `${BASE}/it/elenco-espositori`
const UA = 'Mozilla/5.0 (compatible; SpeaqiCRM/1.0)'

function arg(name: string, fallback: string) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

async function get(url: string, attempts = 3): Promise<string> {
  for (let i = 1; ; i += 1) {
    try {
      const response = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html,application/json' } })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return await response.text()
    } catch (error) {
      if (i >= attempts) throw error
      await new Promise((resolve) => setTimeout(resolve, 800 * i))
    }
  }
}

function csvCell(value: unknown) {
  const text = String(value ?? '').replace(/[\r\n]+/g, ' ')
  return /[;"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

async function main() {
  const page = await get(LIST_URL)
  const folder = /data-folder="(\d+)"/.exec(page)?.[1]
  const edition = /data-exhibition-edition="(\d+)"/.exec(page)?.[1]
  if (!folder || !edition) throw new Error('Struttura della pagina cambiata: cartella o edizione non trovate')

  const api = `${BASE}/it/api/v1/filterDataObjects/default?type=digital-profiles&folder=${folder}&itemsPerPage=10000&exhibitionEdition=${edition}`
  const payload = JSON.parse(await get(api)) as { items: { content: string }[]; paginationVariables?: { totalCount?: number } }
  const list = payload.items.map((item) => parseListCard(item.content)).filter((item): item is NonNullable<typeof item> => Boolean(item))
  console.log(`Elenco: ${list.length} espositori (${payload.items.length} voci nell'API)`)
  if (payload.items.length >= 10000) console.warn('Attenzione: raggiunto il tetto di 10000, potrebbero mancarne')

  const details = new Map<string, TtgDetail>()
  if (!process.argv.includes('--no-detail')) {
    const concurrency = Math.max(1, Number(arg('concurrency', '4')) || 4)
    let next = 0
    let done = 0
    let failed = 0
    await Promise.all(
      Array.from({ length: concurrency }, async () => {
        while (next < list.length) {
          const item = list[next++]
          try {
            details.set(item.profileId, parseDetail(await get(`${BASE}${item.detailPath}`)))
          } catch (error) {
            failed += 1
            console.warn(`  scheda non letta: ${item.name} (${error instanceof Error ? error.message : error})`)
          }
          done += 1
          if (done % 100 === 0) console.log(`  schede: ${done}/${list.length}`)
        }
      })
    )
    console.log(`Schede lette: ${details.size}, non lette: ${failed}`)
  }

  const header = ['Espositore', 'Padiglione', 'Stand', 'Paese', 'Città', 'Categoria', 'Sito', 'Email', 'Telefono', 'Scheda']
  const rows = list.map((item) => {
    const detail = details.get(item.profileId)
    const { hall, stand } = splitPosition(item.position)
    return [item.name, hall, stand, detail?.country, detail?.city, detail?.categories, detail?.website, detail?.email, detail?.phone, `${BASE}${item.detailPath}`]
  })

  const out = arg('out', 'scripts/csv/ttg-espositori.csv')
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, '﻿' + [header, ...rows].map((row) => row.map(csvCell).join(';')).join('\n'))
  console.log(`Scritto ${out}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
