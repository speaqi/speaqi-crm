/** Run a previously leased source. Persist the result through tourism_finish_site. */
import { readFile, writeFile } from 'node:fs/promises'
import { crawlTourismSite } from '../../src/lib/server/tourism-site-crawler'
import {
  inventoryChanges,
  type SiteSource
} from '../../src/lib/tourism-research'

async function main() {
  const [input, output] = process.argv.slice(2)
  if (!input || !output)
    throw new Error('Usage: crawl-site-job.ts claimed-source.json result.json')
  const source = JSON.parse(await readFile(input, 'utf8')) as SiteSource & {
    lease_token: string
  }
  if (!source.id || !source.lease_token)
    throw new Error('A claimed source and lease token are required')
  const report = await crawlTourismSite(source.url, {
    maxRequests: source.max_requests
  })
  await writeFile(
    output,
    JSON.stringify(
      {
        source_id: source.id,
        lease_token: source.lease_token,
        report,
        changes: inventoryChanges(source.latest_report, report)
      },
      null,
      2
    ) + '\n'
  )
  console.log(
    JSON.stringify({
      source_id: source.id,
      state: report.state,
      requests: report.requests,
      candidates: report.candidates.length
    })
  )
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
