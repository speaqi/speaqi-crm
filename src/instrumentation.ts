/**
 * Eseguito da Next.js una volta all'avvio del server. Accende il pianificatore
 * delle automazioni (`AUTOMATION_SCHEDULER_ENABLED=true`), che ha preso il
 * posto di n8n.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { startAutomationScheduler } = await import(
    '@/lib/server/automation-scheduler'
  )
  startAutomationScheduler()
  const { startTourismResearchScheduler } = await import(
    '@/lib/server/tourism-research-scheduler'
  )
  startTourismResearchScheduler()
}
