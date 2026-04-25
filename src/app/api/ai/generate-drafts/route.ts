import { NextRequest } from 'next/server'
import { errorMessage } from '@/lib/server/http'
import { createGeneratedContactDraft } from '@/lib/server/email-drafts'
import { contactAssigneeMatchOrFilter } from '@/lib/server/collaborator-filters'
import { loadGmailSignature } from '@/lib/server/gmail'
import { requireRouteUser } from '@/lib/server/supabase'
import { loadUserSettings } from '@/lib/server/user-settings'

type DraftRequest = {
  contact_id: string
  note?: string
}

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
) {
  const results = new Array<R>(items.length)
  let nextIndex = 0

  async function runNext() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      results[currentIndex] = await worker(items[currentIndex], currentIndex)
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => runNext())
  )

  return results
}

function mergeNotes(primary?: string | null, common?: string | null) {
  return [primary, common]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join('\n\n') || null
}

export async function POST(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const body = await request.json()
    const drafts: DraftRequest[] = Array.isArray(body.drafts) ? body.drafts : []
    const commonNote = String(body.common_note || '').trim() || null

    if (!drafts.length) {
      return Response.json({ error: 'Nessun contatto fornito' }, { status: 400 })
    }

    const contactIds = drafts.map((draft) => draft.contact_id)
    let contactsQuery = auth.supabase
      .from('contacts')
      .select('*')
      .eq('user_id', auth.workspaceUserId)
      .in('id', contactIds)

    if (!auth.isAdmin) {
      if (!auth.memberName) {
        return Response.json({ error: 'Collaboratore non associato a un membro team' }, { status: 403 })
      }
      const assigneeOr = contactAssigneeMatchOrFilter(auth.memberName)
      contactsQuery = assigneeOr ? contactsQuery.or(assigneeOr) : contactsQuery.eq('responsible', '__no_member__')
    }

    const contactsResult = await contactsQuery
    if (contactsResult.error) throw contactsResult.error

    const contacts = contactsResult.data || []
    const contactMap = new Map((contacts || []).map((contact: any) => [contact.id, contact]))
    const [settings, emailSignature] = await Promise.all([
      loadUserSettings(auth.supabase, auth.workspaceUserId),
      loadGmailSignature(auth.supabase, auth.workspaceUserId).catch(() => null),
    ])
    const results = await runWithConcurrency(drafts, 3, async (item) => {
      const contact = contactMap.get(item.contact_id)
      if (!contact) {
        return { contact_id: item.contact_id, error: 'Contatto non trovato' }
      }

      const result = await createGeneratedContactDraft(
        auth.supabase,
        auth.workspaceUserId,
        contact,
        mergeNotes(item.note, commonNote),
        { settings, emailSignature }
      )
      if ('error' in result) {
        return { contact_id: item.contact_id, error: result.error }
      }

      return { contact_id: item.contact_id, draft_id: result.draftId }
    })

    const created = results.filter((result) => result.draft_id).length
    const failed = results.filter((result) => result.error).length

    return Response.json({ results, created, failed })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Failed to generate drafts') }, { status: 500 })
  }
}
