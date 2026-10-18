/** Validate acquisition data using the exact application import contract. */
import { readFile, writeFile } from 'node:fs/promises'
import { normalizeRecord, normalizeEvidence } from '../../src/lib/tourism'

async function main() {
  const path = process.argv[2] || 'backups/tourism-acquisition/candidates.json'
  const input = JSON.parse(await readFile(path, 'utf8')) as Record<
    string,
    unknown
  >[]
  const valid: Record<string, unknown>[] = []
  const errors: { index: number; name: unknown; error: string }[] = []
  for (const [index, row] of input.entries()) {
    try {
      const normalized = normalizeRecord(row, 'import')
      const sources = Array.isArray(row.source_evidence)
        ? row.source_evidence.map((source) =>
            normalizeEvidence(source, 'import')
          )
        : [normalized.evidence]
      valid.push({ ...normalized, source_evidence: sources })
    } catch (error) {
      errors.push({
        index,
        name: row.name,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }
  await writeFile(
    path.replace(/\.json$/, '-validated.json'),
    JSON.stringify(valid, null, 2) + '\n'
  )
  await writeFile(
    path.replace(/\.json$/, '-errors.json'),
    JSON.stringify(errors, null, 2) + '\n'
  )
  console.log(
    JSON.stringify({
      input: input.length,
      valid: valid.length,
      rejected: errors.length,
      errors: errors.slice(0, 8)
    })
  )
  if (errors.length) process.exitCode = 1
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
