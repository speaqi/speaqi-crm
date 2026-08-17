/**
 * Riconciliazione bozze /email <-> Gmail.
 *
 * Il flusso "Salva in bozza" lascia la mail in Gmail: se l'utente la apre e la
 * spedisce da li, il CRM non se ne accorgeva e la bozza restava in "Da inviare"
 * per sempre. Qui confrontiamo le bozze pending con la posta inviata di Gmail:
 * se il contatto e' stato scritto dopo la creazione della bozza, la bozza viene
 * chiusa come inviata (`sent_via = 'gmail'`) e sparisce dalla coda.
 *
 * Le conseguenze CRM (attivita nel log, follow-up, last_contact_at) restano a
 * carico di `syncContactGmailMessages`, che e' gia la sorgente unica per le
 * email spedite fuori dal CRM.
 */
import {
  findSentGmailMessageToRecipient,
  getGmailAccessToken,
  getSentGmailMessageContent,
  gmailDraftExists,
  listRecentSentGmailMessages,
  syncContactGmailMessages,
  type SentGmailMessageInfo,
} from '@/lib/server/gmail'
import type { CRMContact } from '@/types'

type PendingDraftRow = {
  id: string
  contact_id: string
  subject: string | null
  created_at: string
  gmail_draft_id: string | null
  contact: { id: string; name: string | null; email: string | null } | null
}

/** Solo le bozze che cambiano stato: le pending restano un semplice conteggio. */
export type DraftReconcileOutcome = {
  draft_id: string
  contact_id: string
  contact_name: string | null
  outcome: 'sent_from_gmail' | 'gmail_draft_removed'
  gmail_message_id?: string
  sent_at?: string | null
  subject?: string | null
}

export type DraftReconcileResult = {
  gmail_connected: boolean
  dry_run: boolean
  checked: number
  marked_sent: number
  gmail_drafts_removed: number
  results: DraftReconcileOutcome[]
  errors: string[]
}

export type DraftReconcileOptions = {
  dryRun?: boolean
  lookbackDays?: number
  maxSentScan?: number
  maxDraftChecks?: number
  maxContactSyncs?: number
}

function clamp(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Math.floor(Number(value))
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function normalizeEmail(value?: string | null) {
  return String(value || '').trim().toLowerCase()
}

function timestamp(value?: string | null) {
  const parsed = new Date(value || 0).getTime()
  return Number.isFinite(parsed) ? parsed : 0
}

export async function reconcileGmailSentDrafts(
  supabase: any,
  userId: string,
  options: DraftReconcileOptions = {}
): Promise<DraftReconcileResult> {
  const dryRun = options.dryRun === true
  const lookbackDays = clamp(options.lookbackDays, 7, 1, 30)
  const maxSentScan = clamp(options.maxSentScan, 60, 1, 200)
  const maxDraftChecks = clamp(options.maxDraftChecks, 25, 0, 100)
  const maxContactSyncs = clamp(options.maxContactSyncs, 10, 0, 50)

  const errors: string[] = []
  const results: DraftReconcileOutcome[] = []

  const { data, error } = await supabase
    .from('email_drafts')
    .select('id, contact_id, subject, created_at, gmail_draft_id, contact:contact_id ( id, name, email )')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) throw error

  const pending = ((data || []) as PendingDraftRow[]).filter((draft) =>
    Boolean(normalizeEmail(draft.contact?.email))
  )

  if (!pending.length) {
    return {
      gmail_connected: true,
      dry_run: dryRun,
      checked: 0,
      marked_sent: 0,
      gmail_drafts_removed: 0,
      results,
      errors,
    }
  }

  const gmail = await getGmailAccessToken(supabase, userId)
  if (!gmail) {
    return {
      gmail_connected: false,
      dry_run: dryRun,
      checked: pending.length,
      marked_sent: 0,
      gmail_drafts_removed: 0,
      results,
      errors,
    }
  }

  const { accessToken } = gmail

  // ─── 1. Posta inviata recente, indicizzata per destinatario ───
  const sentByRecipient = new Map<string, SentGmailMessageInfo[]>()
  const sentMessages = await listRecentSentGmailMessages(accessToken, {
    newerThanDays: lookbackDays,
    maxResults: maxSentScan,
  })

  for (const message of sentMessages) {
    for (const recipient of message.recipients) {
      const bucket = sentByRecipient.get(recipient)
      if (bucket) bucket.push(message)
      else sentByRecipient.set(recipient, [message])
    }
  }

  // ─── 2. Match bozza -> messaggio inviato dopo la creazione della bozza ───
  // Un messaggio gia collegato a una bozza chiusa (invio dal CRM o riconciliazione
  // precedente) non puo essere riusato per chiuderne un'altra.
  // `provider_message_id` ha gia un indice unico: la stessa email non puo
  // chiudere due bozze diverse.
  const usedMessageIds = new Set<string>()
  const { data: alreadyLinked } = await supabase
    .from('email_drafts')
    .select('provider_message_id')
    .eq('user_id', userId)
    .not('provider_message_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(500)

  for (const row of alreadyLinked || []) {
    if (row?.provider_message_id) usedMessageIds.add(String(row.provider_message_id))
  }

  const matches: Array<{ draft: PendingDraftRow; message: SentGmailMessageInfo }> = []
  const unmatchedWithGmailDraft: PendingDraftRow[] = []

  for (const draft of pending) {
    const email = normalizeEmail(draft.contact?.email)
    const createdAt = timestamp(draft.created_at)
    const candidate = (sentByRecipient.get(email) || [])
      .filter((message) => timestamp(message.sentAt) > createdAt && !usedMessageIds.has(message.id))
      .sort((left, right) => timestamp(left.sentAt) - timestamp(right.sentAt))[0]

    if (candidate) {
      usedMessageIds.add(candidate.id)
      matches.push({ draft, message: candidate })
      continue
    }

    // Senza bozza in Gmail non c'e' altro da controllare: resta pending.
    if (draft.gmail_draft_id) unmatchedWithGmailDraft.push(draft)
  }

  // ─── 3. Bozze salvate in Gmail e sparite: inviate fuori finestra o cestinate ───
  const gmailDraftsRemoved: PendingDraftRow[] = []

  for (const draft of unmatchedWithGmailDraft.slice(0, maxDraftChecks)) {
    try {
      // `null` = Gmail non risponde: nel dubbio la bozza resta dov'e'.
      const stillADraft = await gmailDraftExists(accessToken, String(draft.gmail_draft_id))
      if (stillADraft !== false) continue

      const createdAt = timestamp(draft.created_at)
      const message = await findSentGmailMessageToRecipient(
        accessToken,
        String(draft.contact?.email),
        Math.floor(createdAt / 1000)
      )

      if (message && timestamp(message.sentAt) > createdAt && !usedMessageIds.has(message.id)) {
        usedMessageIds.add(message.id)
        matches.push({ draft, message })
        continue
      }

      gmailDraftsRemoved.push(draft)
      results.push({
        draft_id: draft.id,
        contact_id: draft.contact_id,
        contact_name: draft.contact?.name || null,
        outcome: 'gmail_draft_removed',
      })
    } catch (err) {
      errors.push(err instanceof Error ? err.message : 'Controllo bozza Gmail fallito')
    }
  }

  // ─── 4. Chiusura delle bozze effettivamente spedite ───
  let markedSent = 0
  const closedContactIds = new Set<string>()

  for (const { draft, message } of matches) {
    // Il testo puo essere stato ritoccato in Gmail: in "Inviate" deve comparire
    // quello che il contatto ha davvero ricevuto.
    let sentSubject = message.subject || draft.subject
    let sentText: string | null = null
    let sentHtml: string | null = null

    try {
      const content = await getSentGmailMessageContent(accessToken, message.id)
      sentSubject = content.subject || sentSubject
      sentText = content.text
      sentHtml = content.html
    } catch (err) {
      errors.push(err instanceof Error ? err.message : 'Lettura messaggio inviato fallita')
    }

    if (!dryRun) {
      const { error: updateError } = await supabase
        .from('email_drafts')
        .update({
          status: 'sent',
          sent_at: message.sentAt || new Date().toISOString(),
          sent_via: 'gmail',
          provider_message_id: message.id,
          gmail_draft_id: null,
          subject: sentSubject,
          ...(sentText ? { body_text: sentText } : {}),
          ...(sentHtml ? { body_html: sentHtml } : {}),
        })
        .eq('id', draft.id)
        .eq('user_id', userId)
        .eq('status', 'pending')

      if (updateError) {
        errors.push(updateError.message || 'Aggiornamento bozza fallito')
        continue
      }
    }

    markedSent++
    closedContactIds.add(draft.contact_id)
    results.push({
      draft_id: draft.id,
      contact_id: draft.contact_id,
      contact_name: draft.contact?.name || null,
      outcome: 'sent_from_gmail',
      gmail_message_id: message.id,
      sent_at: message.sentAt,
      subject: sentSubject,
    })
  }

  // La bozza non c'e' piu in Gmail ma non risulta inviata: l'utente l'ha
  // cestinata. La riga resta pending (il contatto va ancora scritto), ma il
  // riferimento alla bozza Gmail non e' piu valido.
  if (!dryRun && gmailDraftsRemoved.length) {
    const { error: clearError } = await supabase
      .from('email_drafts')
      .update({ gmail_draft_id: null })
      .in('id', gmailDraftsRemoved.map((draft) => draft.id))
      .eq('user_id', userId)
      .eq('status', 'pending')

    if (clearError) errors.push(clearError.message || 'Pulizia riferimenti bozze Gmail fallita')
  }

  // ─── 5. Allineamento CRM (attivita, follow-up, last_contact_at) ───
  if (!dryRun && closedContactIds.size && maxContactSyncs > 0) {
    const contactIds = Array.from(closedContactIds).slice(0, maxContactSyncs)

    const { data: contacts, error: contactsError } = await supabase
      .from('contacts')
      .select('*')
      .eq('user_id', userId)
      .in('id', contactIds)

    if (contactsError) errors.push(contactsError.message || 'Caricamento contatti fallito')

    for (const contact of (contacts || []) as CRMContact[]) {
      try {
        await syncContactGmailMessages(supabase, userId, contact, 10)
      } catch (err) {
        errors.push(err instanceof Error ? err.message : `Sync Gmail fallito per ${contact.id}`)
      }
    }
  }

  return {
    gmail_connected: true,
    dry_run: dryRun,
    checked: pending.length,
    marked_sent: markedSent,
    gmail_drafts_removed: gmailDraftsRemoved.length,
    results,
    errors,
  }
}
