import { EVENTS_SCHEMA_MIGRATIONS } from './office-events-schema'
import { resetOfficeDatabase } from './office-schema'

/** Migrazioni applicative originali: soltanto il confine Auth viene simulato. */
export const OFFICE_WORK_SCHEMA_MIGRATION = '20261025061329_office_persistent_work.sql'
export async function resetWorkDatabase(database: string) {
  return resetOfficeDatabase(database, [
    ...EVENTS_SCHEMA_MIGRATIONS,
    '20261002090000_automation_job_runs.sql',
    '20261019190000_tourism_decks.sql',
    '20261023090100_office_presentations.sql',
    '20261024090000_office_director_orders.sql',
    '20261024120000_opportunities.sql',
    '20261024140000_office_queue_update.sql',
    OFFICE_WORK_SCHEMA_MIGRATION,
  ])
}
