import { NextRequest } from 'next/server'
import {
  formatMissingGmailConfigMessage,
  getGmailAccount,
  getGmailConfigStatus,
  gmailStatus,
  isMissingRelation,
} from '@/lib/server/gmail'
import { requireRouteUser } from '@/lib/server/supabase'
import type { SentMessageHistoryItem } from '@/types'

const GMAIL_MIGRATION_ERROR =
  'Schema Gmail non presente. Applica la migration 20260327154240_gmail_integration.sql.'
const GMAIL_ADMIN_ERROR =
  'SUPABASE_SERVICE_ROLE_KEY mancante nel deploy. Serve per completare il callback Gmail OAuth.'

function normalizeRelatedContact(value: any) {
  return Array.isArray(value) ? value[0] || null : value || null
}

async function loadSentHistory(supabase: any, userId: string) {
  const [
    { data: gmailMessages, error: gmailMessagesError },
    { data: emailLogs, error: emailLogsError },
  ] = await Promise.all([
    supabase
      .from('gmail_messages')
      .select('id, subject, to_emails, sent_at, created_at, contact:contacts(id, name)')
      .eq('user_id', userId)
      .eq('direction', 'outbound')
      .order('sent_at', { ascending: false, nullsFirst: false })
      .limit(40),
    supabase
      .from('email_logs')
      .select('id, to, subject, type, status, created_at')
      .eq('user_id', userId)
      .neq('type', 'gmail')
      .order('created_at', { ascending: false })
      .limit(40),
  ])

  if (gmailMessagesError && !isMissingRelation(gmailMessagesError)) throw gmailMessagesError
  if (emailLogsError) throw emailLogsError

  const gmailItems: SentMessageHistoryItem[] = (gmailMessages || []).map((message: any) => ({
    id: `gmail:${message.id}`,
    source: 'gmail',
    subject: message.subject || 'Senza oggetto',
    recipient: Array.isArray(message.to_emails) ? message.to_emails.join(', ') : '',
    status: 'sent',
    sent_at: message.sent_at || message.created_at,
    contact: normalizeRelatedContact(message.contact),
  }))

  const logItems: SentMessageHistoryItem[] = (emailLogs || []).map((log: any) => ({
    id: `log:${log.id}`,
    source: log.type || 'email',
    subject: log.subject || 'Senza oggetto',
    recipient: log.to || 'Destinatario non disponibile',
    status: log.status || 'sent',
    sent_at: log.created_at,
    contact: null,
  }))

  return [...gmailItems, ...logItems]
    .sort((left, right) => new Date(right.sent_at).getTime() - new Date(left.sent_at).getTime())
    .slice(0, 60)
}

export async function GET(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const config = getGmailConfigStatus()
    if (!config.configured) {
      return Response.json({
        ready: false,
        gmail: { connected: false },
        sent_history: [],
        error: formatMissingGmailConfigMessage(config.missing),
        missing_env: config.missing,
      })
    }

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return Response.json({
        ready: false,
        gmail: { connected: false },
        sent_history: [],
        error: GMAIL_ADMIN_ERROR,
        missing_env: ['SUPABASE_SERVICE_ROLE_KEY'],
      })
    }

    const account = await getGmailAccount(auth.supabase, auth.user.id)
    const sentHistory = await loadSentHistory(auth.supabase, auth.user.id)
    return Response.json({
      ready: true,
      gmail: gmailStatus(account),
      sent_history: sentHistory,
      missing_env: [],
    })
  } catch (error) {
    if (isMissingRelation(error)) {
      return Response.json({
        ready: false,
        gmail: { connected: false },
        sent_history: [],
        error: GMAIL_MIGRATION_ERROR,
        missing_env: [],
      })
    }

    return Response.json(
      {
        ready: false,
        gmail: { connected: false },
        sent_history: [],
        error: error instanceof Error ? error.message : 'Failed to load Gmail status',
        missing_env: [],
      },
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
