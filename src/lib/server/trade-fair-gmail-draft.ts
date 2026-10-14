import { createContactDraft, findSentGmailDraftCandidates, findSentGmailMessageByRfc822Id, getGmailAccessToken, getSentGmailMessageContent, gmailDraftExists } from './gmail'

type DraftInput = { to: string; subject: string; text: string; html: string; messageIdHeader: string }

export async function prepareSignedGmailDraft(supabase: any, userId: string, input: DraftInput) {
  const draft = await createContactDraft(supabase, userId, { email: input.to, name: '' }, {
    subject: input.subject, text: input.text, html: input.html, messageIdHeader: input.messageIdHeader, appendSignature: false,
  })
  if (!draft?.messageId) throw new Error('Impossibile creare la bozza in Gmail.')
  return { draftId: draft.draftId, messageId: draft.messageId }
}

export type DraftInspection =
  | { state: 'draft' | 'missing' | 'unavailable' }
  | { state: 'sent'; id: string; sentAt: string | null; subject: string | null; text: string | null }

type StoredDraft = { gmail_draft_id?: string; gmail_message_id?: string; message_id_header?: string; account_email?: string; prepared_at?: string; original_text?: string; to: string; subject: string; body: string }

function fold(text: string) { return text.replace(/\s+/g, ' ').trim().toLowerCase() }

/** La scomparsa di una bozza da sola non prova l'invio: serve un messaggio in Inviati. */
export async function inspectPreparedGmailDraft(supabase: any, userId: string, draft: StoredDraft): Promise<DraftInspection> {
  const session = await getGmailAccessToken(supabase, userId)
  if (!session || session.account.email.toLowerCase() !== draft.account_email?.toLowerCase() || !draft.gmail_draft_id) return { state: 'unavailable' }
  const exists = await gmailDraftExists(session.accessToken, draft.gmail_draft_id)
  if (exists === true) return { state: 'draft' }
  if (exists === null) return { state: 'unavailable' }

  if (draft.message_id_header) {
    const sentId = await findSentGmailMessageByRfc822Id(supabase, userId, draft.message_id_header, session.accessToken)
    if (sentId) {
      const sent = await getSentGmailMessageContent(session.accessToken, sentId)
      if (sent.recipients.some((email) => email.toLowerCase() === draft.to.toLowerCase())) {
        return { state: 'sent', id: sent.id, sentAt: sent.sentAt, subject: sent.subject, text: sent.text }
      }
    }
  }

  // Gmail può cambiare l'id quando una bozza viene inviata dall'interfaccia.
  // Si verifica destinatario, data, oggetto e contenuto; un'altra email allo stesso destinatario non basta.
  const since = new Date(draft.prepared_at || 0).getTime()
  if (!since) return { state: 'missing' }
  const recent = await findSentGmailDraftCandidates(session.accessToken, draft.to, since / 1000, draft.subject)
  const candidates = recent.filter((message) => message.recipients.some((email) => email.toLowerCase() === draft.to.toLowerCase())
    && message.subject === draft.subject && new Date(message.sentAt || 0).getTime() >= since)
  for (const candidate of candidates) {
    const sent = await getSentGmailMessageContent(session.accessToken, candidate.id)
    if (sent.id === draft.gmail_message_id || (sent.text && fold(sent.text).includes(fold(draft.original_text || draft.body)))) {
      return { state: 'sent', id: sent.id, sentAt: sent.sentAt, subject: sent.subject, text: sent.text }
    }
  }
  return { state: 'missing' }
}

export function gmailDraftUrl(accountEmail: string, messageId: string) {
  return `https://mail.google.com/mail/u/${encodeURIComponent(accountEmail)}/#drafts?compose=${encodeURIComponent(messageId)}`
}
