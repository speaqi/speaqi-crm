import { NextRequest } from 'next/server'
import { errorMessage } from '@/lib/server/http'
import { requireRouteUser } from '@/lib/server/supabase'
import {
  DEFAULT_WINE_PROJECT_AUTOMATION_SETTINGS,
  loadWineProjectAutomationSettings,
  normalizeWineProjectAutomationSettings,
} from '@/lib/server/wine-project-automation'

function missingTable(error: unknown) {
  const message = String((error as { message?: unknown })?.message || '').toLowerCase()
  return message.includes('wine_project_') && (message.includes('schema cache') || message.includes('does not exist'))
}

export async function GET(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error
  if (!auth.isAdmin) return Response.json({ error: 'Solo admin' }, { status: 403 })

  try {
    const settings = await loadWineProjectAutomationSettings(auth.supabase, auth.workspaceUserId)

    // Il bacino wine-project è nell'ordine delle migliaia (import Acumbamail
    // incluso): niente id raccolti e passati con .in(), che a quella scala
    // supera il limite di lunghezza URL del gateway (verificato: 400 nudo
    // oltre ~1000 id). Le query sotto usano un join filtrato lato Postgres.
    const { count: totalContacts, error: contactsCountError } = await auth.supabase
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', auth.workspaceUserId)
      .eq('event_tag', 'wine-project')
    if (contactsCountError) throw contactsCountError

    // Somma di aperture/click: paginazione keyset su id, non su OFFSET, così
    // il costo resta lineare qualunque sia la dimensione del bacino.
    let opens = 0
    let clicksFromContacts = 0
    let cursor: string | null = null
    for (;;) {
      let query = auth.supabase
        .from('contacts')
        .select('id,email_open_count,email_click_count')
        .eq('user_id', auth.workspaceUserId)
        .eq('event_tag', 'wine-project')
        .order('id', { ascending: true })
        .limit(1000)
      if (cursor) query = query.gt('id', cursor)
      const { data: page, error: pageError } = await query
      if (pageError) throw pageError
      for (const row of page || []) {
        opens += Number(row.email_open_count || 0)
        clicksFromContacts += Number(row.email_click_count || 0)
      }
      if (!page || page.length < 1000) break
      cursor = page[page.length - 1].id
    }

    const { data: events, error: eventsError } = await auth.supabase
      .from('wine_project_followup_events')
      .select('status,contact_id')
      .eq('user_id', auth.workspaceUserId)
    if (eventsError && !missingTable(eventsError)) throw eventsError

    const { count: replies, error: repliesError } = await auth.supabase
      .from('gmail_messages')
      .select('id, contacts!inner(event_tag)', { count: 'exact', head: true })
      .eq('user_id', auth.workspaceUserId)
      .eq('direction', 'inbound')
      .eq('contacts.event_tag', 'wine-project')
    if (repliesError) throw repliesError

    const [{ data: activities, error: activitiesError }, { count: calls, error: callsError }] = await Promise.all([
      auth.supabase
        .from('activities')
        .select('type, contacts!inner(event_tag)')
        .eq('user_id', auth.workspaceUserId)
        .eq('contacts.event_tag', 'wine-project')
        .in('type', ['landing_clicked', 'demo_form_submitted', 'demo_ready', 'reply_interested']),
      auth.supabase
        .from('tasks')
        .select('id, contacts!inner(event_tag)', { count: 'exact', head: true })
        .eq('user_id', auth.workspaceUserId)
        .eq('status', 'pending')
        .eq('action', 'call')
        .eq('contacts.event_tag', 'wine-project'),
    ])
    if (activitiesError) throw activitiesError
    if (callsError) throw callsError

    const summary = (events || []).reduce((acc: Record<string, number>, event: { status: string }) => {
      acc[event.status] = (acc[event.status] || 0) + 1
      return acc
    }, {})
    // Progresso dell'arruolamento: quante cantine del bacino sono già entrate
    // in sequenza (hanno almeno un evento) e quante restano fuori in attesa
    // del prossimo giro di daily_enrollment_cap.
    const enrolledContactIds = new Set((events || []).map((event: { contact_id: string }) => event.contact_id))
    const enrolled = enrolledContactIds.size
    const activitySummary = (activities || []).reduce((acc: Record<string, number>, activity: { type: string }) => {
      acc[activity.type] = (acc[activity.type] || 0) + 1
      return acc
    }, {})

    const { data: recentSendRows, error: recentSendError } = await auth.supabase
      .from('activities')
      .select('created_at,metadata,contact:contacts(name,company,email)')
      .eq('user_id', auth.workspaceUserId)
      .eq('type', 'wine_followup_sent')
      .order('created_at', { ascending: false })
      .limit(50)
    if (recentSendError) throw recentSendError

    const recentSends = (recentSendRows || []).map((row: any) => {
      const contact = Array.isArray(row.contact) ? row.contact[0] : row.contact
      return {
        sent_at: row.created_at,
        sequence: Number(row.metadata?.sequence) || null,
        company: contact?.company || contact?.name || null,
        email: contact?.email || null,
      }
    })

    return Response.json({
      settings,
      recent_sends: recentSends,
      stats: {
        contacts: totalContacts || 0,
        enrolled,
        not_enrolled: Math.max(0, (totalContacts || 0) - enrolled),
        sent: summary.sent || 0,
        scheduled: summary.scheduled || 0,
        queued: summary.queued || 0,
        stopped: summary.skipped || 0,
        replies: replies || 0,
        opens,
        clicks: Math.max(clicksFromContacts, activitySummary.landing_clicked || 0),
        forms: activitySummary.demo_form_submitted || 0,
        demos: activitySummary.demo_ready || 0,
        interested_replies: activitySummary.reply_interested || 0,
        calls: calls || 0,
      },
    })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Impossibile caricare Wine Project') }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error
  if (!auth.isAdmin) return Response.json({ error: 'Solo admin' }, { status: 403 })

  try {
    const body = await request.json()
    const settings = normalizeWineProjectAutomationSettings(body || {})
    const { error } = await auth.supabase
      .from('wine_project_automation_settings')
      .upsert({ user_id: auth.workspaceUserId, ...settings }, { onConflict: 'user_id' })
    if (error) throw error
    return Response.json({ ok: true, settings })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Impossibile salvare Wine Project') }, { status: 500 })
  }
}

/**
 * Salvataggio di una singola email della sequenza. Il PUT sopra riscrive tutte
 * le impostazioni: con cinque testi lunghi in pagina serviva un salvataggio per
 * card, cosi si puo' correggere un messaggio senza rimandare (o rischiare di
 * perdere) tutto il resto.
 */
export async function PATCH(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error
  if (!auth.isAdmin) return Response.json({ error: 'Solo admin' }, { status: 403 })

  try {
    const body = await request.json()
    const sequence = Number(body?.sequence)
    if (!Number.isInteger(sequence)) {
      return Response.json({ error: 'Sequenza non valida' }, { status: 400 })
    }

    const current = await loadWineProjectAutomationSettings(auth.supabase, auth.workspaceUserId)
    const target = current.sequence_templates.find((template) => template.sequence === sequence)
    if (!target) {
      return Response.json({ error: `Email ${sequence} non trovata nella sequenza` }, { status: 404 })
    }

    const settings = normalizeWineProjectAutomationSettings({
      ...current,
      sequence_templates: current.sequence_templates.map((template) =>
        template.sequence === sequence
          ? {
              ...template,
              subject: typeof body?.subject === 'string' ? body.subject : template.subject,
              body: typeof body?.body === 'string' ? body.body : template.body,
            }
          : template
      ),
    })

    const { error } = await auth.supabase
      .from('wine_project_automation_settings')
      .upsert({ user_id: auth.workspaceUserId, ...settings }, { onConflict: 'user_id' })
    if (error) throw error

    return Response.json({
      ok: true,
      template: settings.sequence_templates.find((template) => template.sequence === sequence),
    })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Impossibile salvare questa email') }, { status: 500 })
  }
}
