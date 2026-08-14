import { NextRequest } from 'next/server'
import { errorMessage } from '@/lib/server/http'
import { createEmailDraftRecord } from '@/lib/server/email-drafts'
import { EMPTY_USER_SETTINGS, loadUserSettings } from '@/lib/server/user-settings'
import { requireRouteUser } from '@/lib/server/supabase'
import type { CRMContact } from '@/types'
import { inferContactName, normalizeEmail, normalizeText } from '@/lib/server/acumbamail-api'

async function findContactByEmail(supabase: any, userId: string, email: string) {
  const { data, error } = await supabase
    .from('contacts')
    .select('*')
    .eq('user_id', userId)
    .ilike('email', email)
    .limit(1)
  if (error) throw error
  return (data?.[0] || null) as CRMContact | null
}

async function createMinimalContact(
  supabase: any,
  userId: string,
  email: string,
  name: string,
  source: string,
  listName: string,
  eventTag: string | null
) {
  const { data, error } = await supabase
    .from('contacts')
    .insert({
      user_id: userId,
      name,
      email,
      status: 'New',
      source,
      contact_scope: 'holding',
      priority: 2,
      list_name: listName,
      event_tag: eventTag,
      note: `Creato da Acumbamail per generazione bozza.`,
    })
    .select('*')
    .single()
  if (error) throw error
  return data as CRMContact
}

export async function POST(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error
  if (!auth.isAdmin) return Response.json({ error: 'Solo admin' }, { status: 403 })

  try {
    const body = await request.json().catch(() => ({}))
    const rawEmail = normalizeEmail(body.email)
    if (!rawEmail) return Response.json({ error: 'email obbligatoria' }, { status: 400 })

    const email = rawEmail
    const contactName = normalizeText(body.name) || inferContactName(email)
    const listName = normalizeText(body.list_name) || 'Acumbamail'
    const campaignKey = normalizeText(body.campaign_key) || null
    const note = normalizeText(body.note) || null

    let contact = await findContactByEmail(auth.supabase, auth.workspaceUserId, email)
    if (!contact) {
      contact = await createMinimalContact(
        auth.supabase,
        auth.workspaceUserId,
        email,
        contactName,
        'acumbamail',
        listName,
        campaignKey
      )
    }

    const settings = await loadUserSettings(auth.supabase, auth.workspaceUserId).catch(() => EMPTY_USER_SETTINGS)

    const result = await createEmailDraftRecord(
      auth.supabase,
      auth.workspaceUserId,
      contact,
      note,
      { settings, source: 'manual' }
    )

    if ('error' in result) {
      return Response.json({ error: result.error, contact_id: contact.id }, { status: 500 })
    }

    return Response.json({
      ok: true,
      contact_id: contact.id,
      draft_id: result.draftId,
    })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Creazione bozza non riuscita') }, { status: 500 })
  }
}
