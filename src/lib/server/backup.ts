import { gzipSync } from 'node:zlib'
import { describeR2Config, probeR2Read, putR2Object, r2BackupConfig } from './r2'

/**
 * Backup del database eseguito in produzione.
 *
 * Il piano Free di Supabase non ha backup automatici ne PITR: senza questo,
 * una scrittura sbagliata sui contatti non e recuperabile. Il dump viene
 * salvato su Supabase Storage (ripristino comodo, storico datato) e, solo se
 * pesa meno di 8 MB, spedito via email. Oggi il dump e' piu' grande: l'email
 * viene saltata (`skipped_too_large`) e l'unica copia sta dentro Supabase.
 *
 * La versione locale e `scripts/backup_supabase.mjs` (`npm run backup`), che
 * fa lo stesso lavoro attaccandosi al database direttamente: se cambi l'elenco
 * delle tabelle qui, allineala.
 */

/**
 * Cio che non si rigenera: contatti con la loro storia, trattative, preventivi,
 * l'elenco delle aziende turistiche e le ricerche (Tourism Intelligence), le
 * compagnie e i porti di Navigazione (lavoro fatto a mano), le fiere, bozze e
 * invii email, le impostazioni e le campagne.
 *
 * Fuori di proposito: `tourism_revisions` (36 MB di storico, pesa piu di meta
 * del database e farebbe saltare memoria e tempo del dump), `gmail_accounts`
 * (segreti: si ricollega l'account), `automation_job_runs` e le tabelle di n8n
 * rimaste (log). Aggiungendo una tabella con chiave diversa da `id`, mettila
 * anche in BACKUP_ORDER.
 */
export const BACKUP_TABLES = [
  'contacts',
  'deals',
  'activities',
  'tasks',
  'quotes',
  // Firme disegnate dei contratti in abbonamento: sono prove, vanno salvate.
  'quote_signatures',
  'lead_memories',
  'pipeline_stages',
  'stage_transitions',
  'team_members',
  'user_settings',
  'user_state',
  'sales_links',
  'todo_board_columns',
  'business_goals',
  // Soldi da ricevere (/incassi): pochi, ma sono soldi.
  'receivables',
  // Registro, bozze e spesa dell'ufficio.
  'office_agents',
  'office_events',
  'office_director_orders',
  'office_work_items',
  'office_work_dependencies',
  'office_work_attempts',
  'office_work_outputs',
  'office_work_revisions',
  'office_work_events',
  'office_work_imports',
  'office_event_batches',
  'office_news_batches',
  'office_news_seen',
  'office_news_deliveries',
  'office_social_batches',
  'office_social_snapshots',
  'office_presentation_tasks',
  'office_agent_runs',
  'office_agent_outputs',
  'office_budget_ledger',
  'office_agent_daily_quotas',
  // Tourism Intelligence: l'elenco delle aziende turistiche e cio che si e' trovato.
  'tourism_taxonomy',
  'tourism_entities',
  'tourism_evidence',
  'tourism_relations',
  'tourism_crm_links',
  'tourism_crm_matches',
  'tourism_jobs',
  'tourism_acquisitions',
  'tourism_site_sources',
  'tourism_site_scans',
  'tourism_poi_candidates',
  'tourism_project_opportunities',
  'tourism_canonical_links',
  // Turismo operativo: schede di lavoro assegnate a collaboratori e partner.
  'tourism_work_members',
  'tourism_work_items',
  'tourism_work_notes',
  'tourism_work_events',
  'tourism_work_rules',
  // Porti, aeroporti e stazioni; i porti di Navigazione sono la vista shipping_ports su questa tabella.
  'tourism_hubs',
  'tourism_destinations',
  'tourism_hub_destinations',
  'tourism_hub_operators',
  // Navigazione e fiere.
  'shipping_companies',
  'shipping_itineraries',
  'shipping_itinerary_stops',
  'trade_fair_exhibitors',
  // Email, campagne e notifiche.
  'email_drafts',
  'email_logs',
  'gmail_messages',
  'ai_decision_logs',
  'acumbamail_campaigns',
  'acumbamail_campaign_engagements',
  'wine_project_automation_settings',
  'wine_project_followup_events',
  'wine_project_reply_checks',
  'commercial_campaigns',
  'commercial_campaign_steps',
  'commercial_import_batches',
  'commercial_enrollments',
  'commercial_messages',
  'commercial_suppressions',
  'whatsapp_notification_settings',
] as const

/** Colonna di ordinamento per le tabelle senza `id`: la paginazione ne ha bisogno. */
export const BACKUP_ORDER: Record<string, string> = {
  user_state: 'user_id',
  whatsapp_notification_settings: 'user_id',
  wine_project_automation_settings: 'user_id',
  wine_project_reply_checks: 'contact_id',
  tourism_taxonomy: 'code',
  tourism_crm_links: 'entity_id',
  tourism_destinations: 'entity_id',
}

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
  /** Copia su Cloudflare R2, fuori da Supabase: `not_configured` finche' mancano le variabili R2_BACKUP_*. */
  r2: 'ok' | 'not_configured' | string
  email: 'ok' | 'skipped_too_large' | 'not_configured' | 'disabled' | string
  pruned: number
}

/**
 * Un backup e' sano se il dump e' nello Storage, nessun invio e' fallito e
 * esiste almeno una copia fuori da Supabase (R2 o email). L'email saltata perche'
 * troppo grande non e' un guasto: lo e' restare senza copia esterna.
 */
export function backupDegraded(result: Pick<BackupResult, 'storage' | 'email' | 'r2'>) {
  const emailFailed = !['ok', 'skipped_too_large', 'not_configured', 'disabled'].includes(result.email)
  const r2Failed = !['ok', 'not_configured'].includes(result.r2)
  const noOffsiteCopy = result.r2 !== 'ok' && result.email !== 'ok' && result.email !== 'disabled'
  return result.storage !== 'ok' || emailFailed || r2Failed || noOffsiteCopy
}

async function fetchAllRows(supabase: any, table: string) {
  const rows: unknown[] = []

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .order(BACKUP_ORDER[table] || 'id', { ascending: true })
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

  // La copia fuori da Supabase non deve mai far fallire il backup: se R2 non
  // risponde il dump resta comunque nel bucket e l'errore si legge nel risultato.
  let r2: BackupResult['r2'] = 'not_configured'
  const r2Config = r2BackupConfig()
  if (r2Config) {
    try {
      await putR2Object(r2Config, `crm/${file}`, payload, 'application/gzip')
      r2 = 'ok'
    } catch (error) {
      const reading = await probeR2Read(r2Config)
      r2 = `${error instanceof Error ? error.message : String(error)} [${describeR2Config(r2Config)}; lettura=${reading}]`
    }
  }

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

  return { file, bytes: payload.byteLength, tables, storage, r2, email, pruned }
}
