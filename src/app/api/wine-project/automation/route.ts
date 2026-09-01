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
    const { data: wineContacts, error: contactsError } = await auth.supabase
      .from('contacts')
      .select('id,email_open_count,email_click_count')
      .eq('user_id', auth.workspaceUserId)
      .eq('event_tag', 'wine-project')
    if (contactsError) throw contactsError

    const { data: events, error: eventsError } = await auth.supabase
      .from('wine_project_followup_events')
      .select('status,contact_id')
      .eq('user_id', auth.workspaceUserId)
    if (eventsError && !missingTable(eventsError)) throw eventsError

    const { count: replies, error: repliesError } = await auth.supabase
      .from('gmail_messages')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', auth.workspaceUserId)
      .eq('direction', 'inbound')
      .in('contact_id', (wineContacts || []).map((row: { id: string }) => row.id).length
        ? (wineContacts || []).map((row: { id: string }) => row.id)
        : ['00000000-0000-0000-0000-000000000000'])
    if (repliesError) throw repliesError

    const contactIds = (wineContacts || []).map((row: { id: string }) => row.id)
    const ids = contactIds.length ? contactIds : ['00000000-0000-0000-0000-000000000000']
    const [{ data: activities, error: activitiesError }, { count: calls, error: callsError }] = await Promise.all([
      auth.supabase
        .from('activities')
        .select('type')
        .eq('user_id', auth.workspaceUserId)
        .in('contact_id', ids)
        .in('type', ['landing_clicked', 'demo_form_submitted', 'demo_ready', 'reply_interested']),
      auth.supabase
        .from('tasks')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', auth.workspaceUserId)
        .eq('status', 'pending')
        .eq('action', 'call')
        .in('contact_id', ids),
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
    const totalContacts = wineContacts?.length || 0
    const activitySummary = (activities || []).reduce((acc: Record<string, number>, activity: { type: string }) => {
      acc[activity.type] = (acc[activity.type] || 0) + 1
      return acc
    }, {})

    return Response.json({
      settings,
      stats: {
        contacts: totalContacts,
        enrolled,
        not_enrolled: Math.max(0, totalContacts - enrolled),
        sent: summary.sent || 0,
        scheduled: summary.scheduled || 0,
        queued: summary.queued || 0,
        stopped: summary.skipped || 0,
        replies: replies || 0,
        opens: (wineContacts || []).reduce((total: number, contact: { email_open_count?: number | null }) => total + Number(contact.email_open_count || 0), 0),
        clicks: Math.max(
          (wineContacts || []).reduce((total: number, contact: { email_click_count?: number | null }) => total + Number(contact.email_click_count || 0), 0),
          activitySummary.landing_clicked || 0,
        ),
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
