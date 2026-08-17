import { gzipSync } from 'node:zlib'

/**
 * Backup del database eseguito in produzione.
 *
 * Il piano Free di Supabase non ha backup automatici ne PITR: senza questo,
 * una scrittura sbagliata sui contatti non e recuperabile. Il dump viene
 * salvato su Supabase Storage (ripristino comodo, storico datato) e spedito
 * via email (copia fuori da Supabase).
 *
 * La versione locale e `scripts/backup_supabase.mjs` (`npm run backup`), che
 * fa lo stesso lavoro attaccandosi al database direttamente: se cambi l'elenco
 * delle tabelle qui, allineala.
 */

/** Contatti piu tutto cio che li rende leggibili: storia, impegni, trattative. */
export const BACKUP_TABLES = [
  'contacts',
  'deals',
  'activities',
  'tasks',
  'quotes',
  'lead_memories',
  'pipeline_stages',
  'team_members',
  'user_settings',
] as const

/** PostgREST tronca a 1000 righe: senza paginazione il backup e silenziosamente incompleto. */
const PAGE_SIZE = 1000

export const BACKUP_BUCKET = 'backups'

/** Oltre questa soglia il dump non viene allegato all'email (limite provider). */
const MAX_EMAIL_ATTACHMENT_BYTES = 8 * 1024 * 1024

export type BackupResult = {
  file: string
  bytes: number
  tables: Record<string, { rows: number } | { error: string }>
  storage: 'ok' | string
  email: 'ok' | 'skipped_too_large' | 'not_configured' | 'disabled' | string
  pruned: number
}

async function fetchAllRows(supabase: any, table: string) {
  const rows: unknown[] = []

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)

    if (error) throw error
    const page = data || []
    rows.push(...page)
    if (page.length < PAGE_SIZE) break
  }

  return rows
}

async function ensureBucket(supabase: any) {
  const { data } = await supabase.storage.getBucket(BACKUP_BUCKET)
  if (data) return
  await supabase.storage.createBucket(BACKUP_BUCKET, { public: false })
}

/** Tiene i `keep` backup piu recenti nel bucket. */
async function pruneStorage(supabase: any, keep: number) {
  const { data, error } = await supabase.storage.from(BACKUP_BUCKET).list('', {
    limit: 1000,
    sortBy: { column: 'name', order: 'asc' },
  })
  if (error || !Array.isArray(data)) return 0

  const owned = data
    .map((item: { name: string }) => item.name)
    .filter((name: string) => /^speaqi-backup_\d{4}-\d{2}-\d{2}.*\.json\.gz$/.test(name))
    .sort()

  const obsolete = owned.slice(0, Math.max(0, owned.length - keep))
  if (!obsolete.length) return 0

  await supabase.storage.from(BACKUP_BUCKET).remove(obsolete)
  return obsolete.length
}

export async function runDatabaseBackup(
  supabase: any,
  options?: { keep?: number; email?: string | null; sendEmail?: boolean }
): Promise<BackupResult> {
  const keep = options?.keep ?? 30
  const now = new Date()
  const stamp = `${now.toISOString().slice(0, 10)}_${String(now.getUTCHours()).padStart(2, '0')}${String(now.getUTCMinutes()).padStart(2, '0')}`
  const file = `speaqi-backup_${stamp}.json.gz`

  const tables: BackupResult['tables'] = {}
  const dump: Record<string, unknown> = { created_at: now.toISOString(), tables: {} }
  let failed = 0

  for (const table of BACKUP_TABLES) {
    try {
      const rows = await fetchAllRows(supabase, table)
      ;(dump.tables as Record<string, unknown>)[table] = rows
      tables[table] = { rows: rows.length }
    } catch (error) {
      failed += 1
      tables[table] = { error: error instanceof Error ? error.message : String(error) }
    }
  }

  // Se i contatti mancano, il backup non vale: meglio fallire rumorosamente
  // che archiviare un file inutile e far credere di essere coperti.
  if (!('rows' in (tables.contacts || { error: 'assente' }))) {
    throw new Error(`Backup interrotto: tabella contacts non salvata (${JSON.stringify(tables.contacts)})`)
  }

  const payload = gzipSync(Buffer.from(JSON.stringify(dump)))

  await ensureBucket(supabase)
  const upload = await supabase.storage.from(BACKUP_BUCKET).upload(file, payload, {
    contentType: 'application/gzip',
    upsert: true,
  })
  const storage = upload.error ? upload.error.message : ('ok' as const)

  // Rotazione solo dopo un backup integro: uno rotto non deve far scadere i buoni.
  const pruned = !upload.error && !failed ? await pruneStorage(supabase, keep) : 0

  let email: BackupResult['email'] = 'not_configured'
  const recipient = options?.sendEmail === false ? null : options?.email || process.env.REMINDER_EMAIL
  if (options?.sendEmail === false) email = 'disabled'
  if (recipient && process.env.RESEND_API_KEY) {
    if (payload.byteLength > MAX_EMAIL_ATTACHMENT_BYTES) {
      email = 'skipped_too_large'
    } else {
      try {
        const { sendBackupEmail } = await import('@/lib/email')
        await sendBackupEmail(recipient, {
          filename: file,
          content: payload.toString('base64'),
          summary: tables,
          bytes: payload.byteLength,
        })
        email = 'ok'
      } catch (error) {
        email = error instanceof Error ? error.message : String(error)
      }
    }
  }

  return { file, bytes: payload.byteLength, tables, storage, email, pruned }
}
