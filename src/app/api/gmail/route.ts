import { NextRequest } from 'next/server'
import { getGmailAccount, gmailStatus, isMissingRelation } from '@/lib/server/gmail'
import { requireRouteUser } from '@/lib/server/supabase'

const GMAIL_MIGRATION_ERROR =
  'Schema Gmail non presente. Applica la migration 20260327154240_gmail_integration.sql.'

export async function GET(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const account = await getGmailAccount(auth.supabase, auth.user.id)
    return Response.json({
      ready: true,
      gmail: gmailStatus(account),
    })
  } catch (error) {
    if (isMissingRelation(error)) {
      return Response.json({
        ready: false,
        gmail: { connected: false },
        error: GMAIL_MIGRATION_ERROR,
      })
    }

    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to load Gmail status' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const { error } = await auth.supabase
      .from('gmail_accounts')
      .delete()
      .eq('user_id', auth.user.id)

    if (error) throw error

    return Response.json({ success: true })
  } catch (error) {
    if (isMissingRelation(error)) {
      return Response.json({ error: GMAIL_MIGRATION_ERROR }, { status: 500 })
    }

    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to disconnect Gmail' },
      { status: 500 }
    )
  }
}
