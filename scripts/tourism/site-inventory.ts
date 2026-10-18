/** Operator pilot: no paid APIs and no catalog/CRM mutations. */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { crawlTourismSite } from '../../src/lib/server/tourism-site-crawler'
import {
  DESTINATION_TYPES,
  estimateCrawlCost
} from '../../src/lib/tourism-research'

async function main() {
  const input =
    process.argv[2] ||
    'backups/tourism-acquisition/site-inventory/catalog-sites.json'
  const output =
    process.argv[3] || 'backups/tourism-acquisition/site-inventory/pilot.json'
  const pilotOnly = process.argv.includes('--pilot')
  const all = JSON.parse(await readFile(input, 'utf8')) as {
    id?: string
    name: string
    country_code: string
    type_code: string
    website: string
  }[]
  const destinations = all.filter((r) =>
    (DESTINATION_TYPES as readonly string[]).includes(r.type_code)
  )
  const hosts = new Set(
    destinations.map((r) => new URL(r.website).hostname.replace(/^www\./, ''))
  )
  const seeds = pilotOnly
    ? [
        {
          name: 'WienTourismus · portale turistico di Vienna',
          country_code: 'AT',
          website: 'https://www.wien.info/en',
          type_code: 'dmo'
        },
        {
          name: 'InCampania · portale turistico regionale',
          country_code: 'IT',
          website: 'https://www.incampania.com/',
          type_code: 'rto'
        },
        {
          name: 'NapoliForMe · Comune di Napoli',
          country_code: 'IT',
          website: 'https://napoliforme.comune.napoli.it/',
          type_code: 'local_office'
        }
      ]
    : destinations.slice(0, 10)
  const results: unknown[] = []
  for (let i = 0; i < seeds.length; i += 2) {
    const batch = await Promise.all(
      seeds
        .slice(i, i + 2)
        .map(async (seed) => ({
          seed,
          report: await crawlTourismSite(seed.website, { maxRequests: 15 })
        }))
    )
    for (const result of batch) {
      results.push(result)
      console.log(
        JSON.stringify({
          name: result.seed.name,
          state: result.report.state,
          requests: result.report.requests,
          urls: result.report.sitemap_urls_seen,
          poi: result.report.candidates.length,
          errors: result.report.errors
        })
      )
    }
    await mkdir(dirname(output), { recursive: true })
    await writeFile(
      output,
      JSON.stringify(
        {
          acquired_at: new Date().toISOString(),
          catalog: {
            organizations_with_site: all.length,
            destination_candidates: destinations.length,
            unique_destination_hosts: hosts.size
          },
          sample_note:
            'Campione di convenienza dei domini consentiti; non rappresentativo del mondo. Ruolo ufficiale e riuso dei contenuti da confermare.',
          results,
          scenarios: [
            estimateCrawlCost(hosts.size, 20),
            estimateCrawlCost(hosts.size, 100),
            estimateCrawlCost(hosts.size, 1000, 0.2),
            estimateCrawlCost(hosts.size, 5000, 0.2, 0.1)
          ]
        },
        null,
        2
      ) + '\n'
    )
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
