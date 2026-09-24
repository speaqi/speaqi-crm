import { NextRequest } from 'next/server'
import { applicationSummary, parseSalesApplication } from '@/lib/sales-program'
import { createLeadTask } from '@/lib/server/ai-ready'
import { automationContext } from '@/lib/server/automation-auth'
import { createActivities } from '@/lib/server/crm'
import { errorMessage } from '@/lib/server/http'
import { escapeLike } from '@/lib/server/sales-links'
import { createServiceRoleClient } from '@/lib/server/supabase'

const SOURCE = 'candidatura_commerciale'
const CATEGORY = 'Candidato commerciale'
/** Tetto globale: la pagina e' pubblica, un modulo non deve poter riempire il CRM. */
const HOURLY_LIMIT = 30

function tomorrowAtTen() {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000)
  date.setUTCHours(8, 0, 0, 0)
  return date.toISOString()
}

/**
 * Candidatura da /diventa-commerciale. Il candidato entra fra i contatti
 * personali (non nella pipeline clienti) con una chiamata per il giorno dopo;
 * chi viene scelto riceve poi il link vendita da Impostazioni → Team.
 * Il workspace arriva dall'ambiente, mai dal corpo della richiesta.
 */
export async function POST(request: NextRequest) {
  try {
    const parsed = parseSalesApplication(await request.json().catch(() => null))
    if (!parsed.ok) {
      if ('spam' in parsed) return Response.json({ success: true })
      return Response.json({ error: parsed.error }, { status: 400 })
    }
    const application = parsed.value

    const context = automationContext()
    if (!context) {
      return Response.json({ error: 'Candidature non disponibili al momento' }, { status: 503 })
    }
    const workspaceUserId = context.workspaceUserId
    const admin = createServiceRoleClient()

    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const { count } = await admin
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', workspaceUserId)
      .eq('source', SOURCE)
      .gte('created_at', hourAgo)
    if ((count || 0) >= HOURLY_LIMIT) {
      return Response.json({ error: 'Troppe candidature in questo momento: riprova più tardi' }, { status: 429 })
    }

    const { data: matches, error: lookupError } = await admin
      .from('contacts')
      .select('id, email')
      .eq('user_id', workspaceUserId)
      .ilike('email', escapeLike(application.email))
      .limit(5)
    if (lookupError) throw lookupError
    let contactId: string | null =
      (matches || []).find((row: any) => String(row.email || '').trim().toLowerCase() === application.email)?.id || null

    const summary = applicationSummary(application)
    if (!contactId) {
      const { data: inserted, error: insertError } = await admin
        .from('contacts')
        .insert({
          user_id: workspaceUserId,
          name: application.name,
          email: application.email,
          phone: application.phone,
          category: CATEGORY,
          source: SOURCE,
          contact_scope: 'personal',
          status: 'New',
          note: summary,
          stage_entered_at: new Date().toISOString(),
        })
        .select('id')
        .single()
      if (insertError) throw insertError
      contactId = inserted.id
    }

    await createActivities(admin, [
      {
        user_id: workspaceUserId,
        contact_id: contactId!,
        type: 'system',
        content: summary,
        metadata: { source: SOURCE, area: application.area },
      },
    ])
    await createLeadTask(admin, workspaceUserId, {
      leadId: contactId!,
      action: 'call',
      type: 'call',
      dueAt: tomorrowAtTen(),
      priority: 'medium',
      note: `Richiamare candidato commerciale (${application.area})`,
      idempotencyKey: `candidatura:${contactId}:${new Date().toISOString().slice(0, 10)}`,
    })

    return Response.json({ success: true })
  } catch (error) {
    console.error('candidatura commerciale', errorMessage(error, 'errore'))
    return Response.json({ error: 'Candidatura non inviata, riprova tra poco' }, { status: 500 })
  }
}
