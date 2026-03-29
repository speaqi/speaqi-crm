import { NextRequest } from 'next/server'
import { gmailStatus, isMissingRelation, syncContactGmailMessages } from '@/lib/server/gmail'
import { requireRouteUser } from '@/lib/server/supabase'
import type { GmailMessage } from '@/types'

type RouteContext = {
  params: Promise<{ id: string }>
}

const GMAIL_MIGRATION_ERROR =
  'Schema Gmail non presente. Applica la migration 20260327154240_gmail_integration.sql.'

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

async function readStoredMessages(supabase: any, userId: string, contactId: string) {
  const { data, error } = await supabase
    .from('gmail_messages')
    .select('*')
    .eq('user_id', userId)
    .eq('contact_id', contactId)
    .order('sent_at', { ascending: false, nullsFirst: false })
    .limit(30)

  if (error) throw error
  return (data || []) as GmailMessage[]
}

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const { id } = await context.params
    const contact = await getContact(auth.supabase, auth.user.id, id)
    const result = await syncContactGmailMessages(auth.supabase, auth.user.id, contact)
    const emails = await readStoredMessages(auth.supabase, auth.user.id, id)

    return Response.json({
      synced: result.synced,
      emails,
      gmail: gmailStatus(result.account),
    })
  } catch (error) {
    if (isMissingRelation(error)) {
      return Response.json({ error: GMAIL_MIGRATION_ERROR }, { status: 500 })
    }

    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to sync Gmail messages' },
      { status: 500 }
    )
  }
}
