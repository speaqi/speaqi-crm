import { readFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { sql } from './psql'

/** DDL reali, non copie semplificate di email_drafts/contacts/gmail_messages. */
export const OFFICE_SCHEMA_MIGRATIONS = [
  '20260325150000_crm_schema.sql',
  '20260327154240_gmail_integration.sql',
  '20260330150000_contact_scope.sql',
  '20260330170000_email_engagement_tracking.sql',
  '20260421193000_personal_contacts.sql',
  '20260604100000_hidden_contacts.sql',
  '20260609140000_email_drafts.sql',
  '20261022160000_office_agents.sql',
  '20261022170450_office_finance.sql',
  '20261022175856_office_sales_followup.sql',
  '20261022183327_office_director.sql',
]
export async function officeSchemaSql() {
  const auth=await readFile(new URL('./sql/office-auth.sql',import.meta.url),'utf8')
  const files=await Promise.all(OFFICE_SCHEMA_MIGRATIONS.map((file)=>readFile(new URL(`../supabase/migrations/${file}`,import.meta.url),'utf8')))
  // PGlite include gen_random_uuid ma non il modulo pgcrypto. Nessun DDL di
  // tabella o vincolo viene tolto/adattato per l'ambiente dei test.
  return auth+'\n'+files.join('\n').replace(/create extension if not exists pgcrypto;/i,'')
}
export async function resetOfficeDatabase(database:string, extra:string[]=[]) {
  await promisify(execFile)('bash',[fileURLToPath(new URL('./db.sh',import.meta.url)),'reset-office',database])
  await sql(await officeSchemaSql(),database)
  for(const file of extra) await sql(await readFile(new URL(`../supabase/migrations/${file}`,import.meta.url),'utf8'),database)
}
