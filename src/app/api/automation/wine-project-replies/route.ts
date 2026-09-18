import { NextRequest } from 'next/server'
import { validateAutomationSecret } from '@/lib/server/automation-auth'
import { syncContactGmailMessages } from '@/lib/server/gmail'
import { errorMessage } from '@/lib/server/http'
import { createServiceRoleClient } from '@/lib/server/supabase'
import { markWineContactsReplyChecked, selectWineContactsForReplySync } from '@/lib/server/wine-project-automation'

const DEFAULT_BATCH = 100

export async function POST(request: NextRequest) {
  if (!validateAutomationSecret(request)) return Response.json({ error: 'Unauthorized automation' }, { status: 401 })
  try {
    const body = await request.json().catch(() => ({}))
    const requested = Number(body?.limit)
    const batch = Number.isInteger(requested) && requested > 0 && requested <= 500 ? requested : DEFAULT_BATCH

    const supabase = createServiceRoleClient()
    const contacts = await selectWineContactsForReplySync(supabase, batch)

    let synced = 0
    // Il motivo del fallimento e' l'informazione: un `catch {}` muto rendeva
    // indistinguibile "nessuna risposta" da "il token Gmail e' scaduto". Il
    // giro continua comunque — una cantina che non si sincronizza non deve
    // fermare le altre — ma l'errore esce dalla rotta.
    const failures: Array<{ contact_id: string; error: string }> = []
    for (const contact of contacts) {
      try {
        const result = await syncContactGmailMessages(supabase, contact.user_id, contact as any, 20)
        synced += result.synced
      } catch (contactError) {
        failures.push({ contact_id: contact.id, error: errorMessage(contactError, 'Sync Gmail non riuscito') })
      }
    }
    await markWineContactsReplyChecked(supabase, contacts.map((contact) => contact.id))

    // Due viste sullo stesso guasto: `errors` dice *cosa* e' andato storto
    // (un token scaduto da' cento volte lo stesso messaggio, e una volta
    // basta), `failures` dice *a chi*, per poterlo aprire nel CRM.
    const errors = [...new Set(failures.map((failure) => failure.error))]
    if (failures.length) {
      console.error(`wine-project-replies: ${failures.length}/${contacts.length} contatti non sincronizzati`, errors[0])
    }
    return Response.json({
      ok: failures.length === 0,
      checked: contacts.length,
      messages_synced: synced,
      failures: failures.length,
      errors,
      failed_contacts: failures.slice(0, 5),
    })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Wine Project reply sync failed') }, { status: 500 })
  }
}
