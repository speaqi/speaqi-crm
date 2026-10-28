import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { buildGmailConnectUrl, isMissingRelation } from '@/lib/server/gmail'
import { GMAIL_OAUTH_STATE_COOKIE, gmailOAuthCookieOptions } from '@/lib/server/gmail-oauth-state'
import { requireRouteUser, requireArea } from '@/lib/server/supabase'

const GMAIL_MIGRATION_ERROR =
  'Schema Gmail non presente. Applica la migration 20260327154240_gmail_integration.sql.'

export async function POST(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error
  const areaError = requireArea(auth, 'email')
  if (areaError) return areaError

  try {
    const state = crypto.randomUUID()

    await auth.supabase
      .from('gmail_oauth_states')
      .delete()
      .eq('user_id', auth.user.id)

    const { error } = await auth.supabase
      .from('gmail_oauth_states')
      .insert({
        state,
        user_id: auth.user.id,
      })

    if (error) throw error

    const response = NextResponse.json({
      url: buildGmailConnectUrl(state),
    })
    response.cookies.set(GMAIL_OAUTH_STATE_COOKIE, state, gmailOAuthCookieOptions())
    return response
  } catch (error) {
    if (isMissingRelation(error)) {
      return Response.json({ error: GMAIL_MIGRATION_ERROR }, { status: 500 })
    }

    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to start Gmail OAuth' },
      { status: 500 }
    )
  }
}
