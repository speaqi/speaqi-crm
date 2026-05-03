import { NextRequest } from 'next/server'
import { maybeAutoCreateFollowupDraft } from '@/lib/server/email-drafts'
import { sendContactEmail, simpleTextToHtml } from '@/lib/server/gmail'
import { requireRouteUser } from '@/lib/server/supabase'

type RouteContext = {
  params: Promise<{ id: string }>
}

async function getContact(supabase: any, userId: string, id: string) {
  const { data, error } = await supabase
    .from('contacts')
    .select('*')
    .eq('user_id', userId)
    .eq('id', id)
    .single()

  if (error) throw error
  return data
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message || '')
  }
  return ''
}

function isMissingOptionalMarketingColumn(error: unknown, column: 'marketing_status' | 'marketing_paused_until') {
  const message = errorMessage(error).toLowerCase()
  return (
    message.includes(column) &&
    (message.includes('schema cache') || message.includes('column') || message.includes('could not find'))
  )
}

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const { id } = await context.params
    const body = await request.json()
    const subject = String(body.subject || '').trim()
    const text = String(body.body || '').trim()
    const followupAt = body.followup_at ? String(body.followup_at) : null

    if (!subject) {
      return Response.json({ error: 'Oggetto email obbligatorio' }, { status: 400 })
    }

    if (!text) {
      return Response.json({ error: 'Corpo email obbligatorio' }, { status: 400 })
    }

    const contact = await getContact(auth.supabase, auth.workspaceUserId, id)
    const result = await sendContactEmail(auth.supabase, auth.workspaceUserId, contact, {
      subject,
      text,
      html: simpleTextToHtml(text),
      followupAt,
    })
    const marketingUpdate = await auth.supabase
      .from('contacts')
      .update({
        marketing_status: followupAt ? 'followup_due' : 'sent',
        marketing_paused_until: null,
      })
      .eq('user_id', auth.workspaceUserId)
      .eq('id', id)
    if (
      marketingUpdate.error &&
      (isMissingOptionalMarketingColumn(marketingUpdate.error, 'marketing_status') ||
        isMissingOptionalMarketingColumn(marketingUpdate.error, 'marketing_paused_until'))
    ) {
      // Marketing columns are optional until the production migration/schema cache has caught up.
    } else if (marketingUpdate.error) {
      throw marketingUpdate.error
    }
    const autoFollowupDraft = await maybeAutoCreateFollowupDraft(auth.supabase, auth.workspaceUserId, contact)

    return Response.json({
      message: result.message,
      auto_followup_draft_created: Boolean(autoFollowupDraft?.draftId),
      auto_followup_draft_id: autoFollowupDraft?.draftId || null,
      gmail: {
        connected: true,
        email: result.account.email,
      },
    })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to send Gmail email' },
      { status: 500 }
    )
  }
}
