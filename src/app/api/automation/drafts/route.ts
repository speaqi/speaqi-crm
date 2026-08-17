import { NextRequest } from 'next/server'
import { requireRouteUser } from '@/lib/server/supabase'
import { errorMessage } from '@/lib/server/http'
import { isWineSegmentContact } from '@/lib/server/email-draft-context'
import { EMPTY_USER_SETTINGS, loadUserSettings } from '@/lib/server/user-settings'
import { getWineEmailTemplates } from '@/lib/email-wine-templates'
import type { CRMContact } from '@/types'

export async function GET(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const url = new URL(request.url)
    const statusFilter = url.searchParams.get('status') || 'pending'

    let query = auth.supabase
      .from('email_drafts')
      .select(`
        *,
        contact:contact_id (
          id, name, email, company, status, score, priority, next_followup_at,
          source, category, list_name
        )
      `)
      .eq('user_id', auth.workspaceUserId)
      .order('created_at', { ascending: false })
      .limit(50)

    // Allow filtering by status (pending, sent, dismissed)
    if (statusFilter === 'all') {
      // no status filter
    } else {
      query = query.eq('status', statusFilter)
    }

    const { data: drafts, error } = await query

    if (error) throw error

    // `wine_segment` dice alla UI se mostrare il selettore dei modelli vino:
    // la regola di segmento resta server-side.
    const enriched = (drafts || []).map((draft: any) => ({
      ...draft,
      wine_segment: draft.contact ? isWineSegmentContact(draft.contact as CRMContact) : false,
    }))

    // I modelli sono modificabili da /impostazioni/email-ai: il selettore in
    // /email deve mostrare quelli del workspace, non quelli di default.
    const hasWineDraft = enriched.some((draft: any) => draft.wine_segment)
    const settings = hasWineDraft
      ? await loadUserSettings(auth.supabase, auth.workspaceUserId).catch(() => EMPTY_USER_SETTINGS)
      : null

    return Response.json({
      drafts: enriched,
      wine_templates: settings
        ? getWineEmailTemplates(settings.email_wine_templates).map(({ id, label }) => ({ id, label }))
        : [],
    })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Failed to load drafts') }, { status: 500 })
  }
}
