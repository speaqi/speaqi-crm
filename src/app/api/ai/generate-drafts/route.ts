import { NextRequest } from 'next/server'
import { errorMessage } from '@/lib/server/http'
import { createGeneratedContactDraft } from '@/lib/server/email-drafts'
import { requireRouteUser } from '@/lib/server/supabase'

type DraftRequest = {
  contact_id: string
  note?: string
}

function isMissingEmailDraftNoteColumn(error: unknown) {
  const message = errorMessage(error, '').toLowerCase()
  return (
    message.includes('email_draft_note') &&
    (message.includes('schema cache') || message.includes('column') || message.includes('could not find'))
  )
}

export async function POST(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const body = await request.json()
    const drafts: DraftRequest[] = Array.isArray(body.drafts) ? body.drafts : []

    if (!drafts.length) {
      return Response.json({ error: 'Nessun contatto fornito' }, { status: 400 })
    }

    const contactIds = drafts.map((draft) => draft.contact_id)
    const primaryContactsResult = await auth.supabase
      .from('contacts')
      .select('id, name, email, company, last_activity_summary, email_draft_note')
      .eq('user_id', auth.user.id)
      .in('id', contactIds)

    let contacts = primaryContactsResult.data || []
    if (primaryContactsResult.error && isMissingEmailDraftNoteColumn(primaryContactsResult.error)) {
      const fallbackContactsResult = await auth.supabase
        .from('contacts')
        .select('id, name, email, company, last_activity_summary')
        .eq('user_id', auth.user.id)
        .in('id', contactIds)

      if (fallbackContactsResult.error) throw fallbackContactsResult.error
      contacts = (fallbackContactsResult.data || []).map((contact: any) => ({
        ...contact,
        email_draft_note: null,
      }))
    } else if (primaryContactsResult.error) {
      throw primaryContactsResult.error
    }

    const contactMap = new Map((contacts || []).map((contact: any) => [contact.id, contact]))
    const results: { contact_id: string; draft_id?: string; error?: string }[] = []

    for (const item of drafts) {
      const contact = contactMap.get(item.contact_id)
      if (!contact) {
        results.push({ contact_id: item.contact_id, error: 'Contatto non trovato' })
        continue
      }

      const result = await createGeneratedContactDraft(auth.supabase, auth.user.id, contact, item.note || null)
      if ('error' in result) {
        results.push({ contact_id: item.contact_id, error: result.error })
        continue
      }

      results.push({ contact_id: item.contact_id, draft_id: result.draftId })
    }

    const created = results.filter((result) => result.draft_id).length
    const failed = results.filter((result) => result.error).length

    return Response.json({ results, created, failed })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Failed to generate drafts') }, { status: 500 })
  }
}
