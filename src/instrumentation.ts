/**
 * Eseguito da Next.js una volta all'avvio del server. Accende il pianificatore
 * delle automazioni (`AUTOMATION_SCHEDULER_ENABLED=true`), che ha preso il
 * posto di n8n.
 */
export async function register() {
  // Il ramo esplicito permette a Next di escludere i moduli Node (undici)
  // dalla compilazione Edge dell'instrumentation.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startAutomationScheduler } = await import(
      '@/lib/server/automation-scheduler'
    )
    startAutomationScheduler()
    const { startTourismResearchScheduler } = await import(
      '@/lib/server/tourism-research-scheduler'
    )
    startTourismResearchScheduler()
  }
}
