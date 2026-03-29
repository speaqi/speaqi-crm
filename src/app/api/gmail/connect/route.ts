import crypto from 'crypto'
import { NextRequest } from 'next/server'
import { buildGmailConnectUrl, isMissingRelation } from '@/lib/server/gmail'
import { requireRouteUser } from '@/lib/server/supabase'

const GMAIL_MIGRATION_ERROR =
  'Schema Gmail non presente. Applica la migration 20260327154240_gmail_integration.sql.'

export async function POST(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

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

    return Response.json({
      url: buildGmailConnectUrl(state),
    })
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
