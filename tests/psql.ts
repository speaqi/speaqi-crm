/**
 * Accesso al Postgres usa-e-getta dei test tramite `psql`: nessuna dipendenza
 * nuova nel progetto per far girare test che hanno bisogno di un database vero.
 */
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)

const SEPARATOR = '~|~'

export const HOST = process.env.PGHOST || '/tmp'
export const PORT = process.env.PGPORT || '55432'
export const DB = process.env.PGDATABASE || 'campagne_test'

export function psqlArgs(query: string, database = DB) {
  return ['-h', HOST, '-p', PORT, '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-tA', '-F', SEPARATOR, '-c', query]
}

export async function sql(query: string, database = DB) {
  const { stdout } = await run('psql', psqlArgs(query, database))
  return stdout.trim().split('\n').filter(Boolean).map((line) => line.split(SEPARATOR))
}

/** Prima colonna della prima riga. */
export async function scalar(query: string, database = DB) {
  const rows = await sql(query, database)
  return rows[0]?.[0] ?? null
}

/** Esegue e cattura l'errore invece di propagarlo: serve ai test sui trigger. */
export async function expectError(query: string, database = DB) {
  try {
    await sql(query, database)
    return null
  } catch (error) {
    return String((error as { stderr?: string }).stderr || error)
  }
}

export async function resetDatabase() {
  await run('bash', [fileURLToPath(new URL('./db.sh', import.meta.url)), 'reset'])
}
