import { randomUUID } from 'node:crypto'
import { newNote, normalizeEmail, type FairExhibitor } from '@/lib/trade-fair'
import { fairEmailAudience, FAIR_EMAIL_COPIES, fairEmailFooter } from '@/lib/trade-fair-destination-email'
import { appendEmailSignature, getConnectedGmailAddress, loadGmailSignature, sendPlainEmail, signatureFromPlainText, simpleTextToHtml, type EmailSignature } from './gmail'
import { loadUserSettings } from './user-settings'
import { errorMessage } from './http'
import { gmailDraftUrl, inspectPreparedGmailDraft, prepareSignedGmailDraft, updateSignedGmailDraft } from './trade-fair-gmail-draft'

export class DestinationEmailError extends Error {
  constructor(message: string, public status = 400) { super(message) }
}

export async function loadDestinationSignature(supabase: any, userId: string) {
  // Stessa precedenza del CRM: firma Gmail, poi firma manuale nelle impostazioni.
  const gmailSignature = await loadGmailSignature(supabase, userId)
  if (gmailSignature?.text || gmailSignature?.html) return gmailSignature
  const settings = await loadUserSettings(supabase, userId)
  const signature = signatureFromPlainText(settings?.email_signature)
  if (!signature) throw new DestinationEmailError('Firma CRM mancante: salva la firma di Massimo Morgante nelle impostazioni email.', 409)
  return signature
}

type Dependencies = {
  signature: (supabase: any, userId: string) => Promise<EmailSignature>
  sender: typeof getConnectedGmailAddress
  send: typeof sendPlainEmail
  draft?: typeof prepareSignedGmailDraft
  draftUpdate?: typeof updateSignedGmailDraft
}

/** Invio manuale singolo. La prenotazione atomica impedisce due invii da un doppio clic. */
export async function sendDestinationEmail(
  supabase: any, userId: string, input: { id: string; subject: string; text: string; mode?: 'draft' },
  deps: Dependencies = { signature: loadDestinationSignature, sender: getConnectedGmailAddress, send: sendPlainEmail }
) {
  const subject = input.subject.trim()
  const text = input.text.trim()
  if (!subject || subject.length > 200 || /[\r\n]/.test(subject) || !text || text.length > 8000) {
    throw new DestinationEmailError('Controlla oggetto e testo dell’email.')
  }
  const { data: row, error } = await supabase.from('trade_fair_exhibitors').select('*')
    .eq('user_id', userId).eq('id', input.id).maybeSingle()
  if (error) throw error
  if (!row) throw new DestinationEmailError('Destinazione non trovata.', 404)
  const audience = fairEmailAudience(row)
  if (!audience) throw new DestinationEmailError('Questo espositore non è una destinazione o un tour operator.')
  if (row.status === 'not_interested') throw new DestinationEmailError('Questa destinazione è segnata come non interessata.', 409)
  const to = normalizeEmail(row.email)
  if (!to) throw new DestinationEmailError('Aggiungi un indirizzo email valido alla destinazione.')
  const prepared = row.outreach?.destination_email
  const reusable = input.mode === 'draft' && prepared?.status === 'draft' && prepared.account_email && prepared.gmail_message_id
  if (prepared && !reusable) {
    const message = prepared.status === 'sent'
      ? 'Questa email è già stata inviata.' : 'Invio già avviato: verifica l’esito in Gmail prima di riprovare.'
    throw new DestinationEmailError(message, 409)
  }
  if (row.contact_id) {
    const contact = await supabase.from('contacts').select('*').eq('user_id', userId).eq('id', row.contact_id).maybeSingle()
    if (contact.error) throw contact.error
    if (!contact.data) throw new DestinationEmailError('Impossibile verificare il contatto collegato.', 409)
    if (contact.data.email_unsubscribed_at || contact.data.status === 'unsubscribed'
      || ['excluded', 'suppressed'].includes(contact.data.marketing_eligibility)) {
      throw new DestinationEmailError('Il contatto collegato è escluso dalle comunicazioni.', 409)
    }
  }

  if (reusable) {
    const sameDraft = prepared.subject === subject && prepared.original_text === text
    if (!sameDraft) {
      const signature = await deps.signature(supabase, userId)
      const accountEmail = await deps.sender(supabase, userId)
      if (!accountEmail || accountEmail.toLowerCase() !== prepared.account_email!.toLowerCase()) {
        throw new DestinationEmailError('L’account Gmail della bozza è cambiato. Verifica la bozza prima di procedere.', 409)
      }
      const signed = appendEmailSignature({ text, html: simpleTextToHtml(text) }, signature)
      const footer = fairEmailFooter(FAIR_EMAIL_COPIES[audience].lang)
      const signedText = `${signed.text}\n\n${footer}`
      const signedHtml = `${signed.html}<br>${simpleTextToHtml(footer)}`
      const updatedDraft = await (deps.draftUpdate || updateSignedGmailDraft)(supabase, userId, prepared.gmail_draft_id!, {
        to: prepared.to, subject, text: signedText, html: signedHtml,
        messageIdHeader: prepared.message_id_header || `<${prepared.token}@speaqi.crm>`,
      })
      const updatedRecord = { ...prepared, subject, original_text: text, body: signedText,
        gmail_draft_id: updatedDraft.draftId, gmail_message_id: updatedDraft.messageId, prepared_at: new Date().toISOString() }
      const saved = await supabase.from('trade_fair_exhibitors').update({
        outreach: { ...row.outreach, destination_email: updatedRecord }, updated_at: new Date().toISOString(),
      }).eq('user_id', userId).eq('id', row.id).eq('outreach->destination_email->>token', prepared.token)
        .eq('outreach->destination_email->>status', 'draft').select('*').maybeSingle()
      if (saved.error || !saved.data) throw new DestinationEmailError('Bozza aggiornata in Gmail, ma il CRM non è stato aggiornato. Ricarica prima di riprovare.', 503)
      return { sent: false, to: prepared.to, url: gmailDraftUrl(accountEmail, updatedDraft.messageId), exhibitor: saved.data, warning: null }
    }
    return { sent: false, to: prepared.to, exhibitor: row,
      url: gmailDraftUrl(prepared.account_email!, prepared.gmail_message_id!), warning: null }
  }

  const signature = await deps.signature(supabase, userId)
  const accountEmail = await deps.sender(supabase, userId)
  if (!accountEmail) throw new DestinationEmailError('Gmail non collegato: collegalo dalla pagina Gmail.', 409)
  const signed = appendEmailSignature({ text, html: simpleTextToHtml(text) }, signature)
  const footer = fairEmailFooter(FAIR_EMAIL_COPIES[audience].lang)
  const signedText = `${signed.text}\n\n${footer}`
  const signedHtml = `${signed.html}<br>${simpleTextToHtml(footer)}`
  const token = randomUUID()
  const sending = { status: input.mode === 'draft' ? 'preparing' as const : 'sending' as const, token, to, subject, body: signedText,
    original_text: text,
    prepared_at: input.mode === 'draft' ? new Date().toISOString() : undefined,
    mode: input.mode === 'draft' ? 'gmail' as const : 'direct' as const }
  const claim = await supabase.from('trade_fair_exhibitors')
    .update({ outreach: { ...row.outreach, destination_email: sending }, updated_at: new Date().toISOString() })
    .eq('user_id', userId).eq('id', row.id).eq('updated_at', row.updated_at)
    .is('outreach->destination_email', null).select('*').maybeSingle()
  if (claim.error) throw claim.error
  if (!claim.data) throw new DestinationEmailError('La scheda è stata aggiornata. Ricarica l’elenco prima di inviare.', 409)

  if (input.mode === 'draft') {
    const messageIdHeader = `<${token}@speaqi.crm>`
    try {
      const draft = await (deps.draft || prepareSignedGmailDraft)(supabase, userId, { to, subject, text: signedText, html: signedHtml, messageIdHeader })
      const prepared = { ...sending, status: 'draft' as const, account_email: accountEmail, gmail_draft_id: draft.draftId,
        gmail_message_id: draft.messageId, message_id_header: messageIdHeader }
      const saved = await supabase.from('trade_fair_exhibitors').update({
        outreach: { ...claim.data.outreach, destination_email: prepared }, updated_at: new Date().toISOString(),
      }).eq('user_id', userId).eq('id', row.id).eq('outreach->destination_email->>token', token).select('*').maybeSingle()
      return { sent: false, to, url: gmailDraftUrl(accountEmail, draft.messageId),
        exhibitor: saved.data || { ...claim.data, outreach: { ...claim.data.outreach, destination_email: prepared } },
        warning: saved.error || !saved.data ? 'Bozza creata in Gmail, ma il CRM non è stato aggiornato. Verifica in Gmail prima di ricrearla.' : null }
    } catch (draftError) {
      await supabase.from('trade_fair_exhibitors').update({
        outreach: { ...claim.data.outreach, destination_email: { ...sending, status: 'unknown', error: errorMessage(draftError, 'Creazione bozza non confermata') } },
        updated_at: new Date().toISOString(),
      }).eq('user_id', userId).eq('id', row.id).eq('outreach->destination_email->>token', token)
      throw new DestinationEmailError('Creazione bozza non confermata. Verifica in Gmail prima di riprovare.', 503)
    }
  }

  let result: Awaited<ReturnType<typeof sendPlainEmail>>
  try {
    result = await deps.send(supabase, userId, { to, subject, text: signedText, html: signedHtml })
  } catch (sendError) {
    await supabase.from('trade_fair_exhibitors').update({
      outreach: { ...claim.data.outreach, destination_email: { ...sending, status: 'unknown', error: errorMessage(sendError, 'Invio non confermato') } },
      updated_at: new Date().toISOString(),
    }).eq('user_id', userId).eq('id', row.id).eq('outreach->destination_email->>token', token)
    throw new DestinationEmailError('Invio non confermato. Verifica in Gmail se l’email è partita prima di riprovare.', 503)
  }

  const latest = await supabase.from('trade_fair_exhibitors').select('*').eq('user_id', userId).eq('id', row.id).maybeSingle()
  const current: FairExhibitor = latest.data || claim.data
  const at = new Date().toISOString()
  const note = newNote(`Email fiera inviata (${audience}): ${subject}`)
  const updated = {
    ...current,
    status: current.status === 'new' ? 'contacted' : current.status,
    contacted_at: current.contacted_at || at,
    notes: note ? [note, ...(current.notes || [])].slice(0, 200) : current.notes,
    outreach: { ...current.outreach, destination_email: { ...sending, status: 'sent' as const, sent_at: at, message_id: result.message_id } },
    updated_at: at,
  }
  const saved = await supabase.from('trade_fair_exhibitors').update({
    status: updated.status, contacted_at: updated.contacted_at, notes: updated.notes, outreach: updated.outreach, updated_at: at,
  }).eq('user_id', userId).eq('id', row.id).eq('outreach->destination_email->>token', token).select('*').maybeSingle()
  return {
    sent: true, to, exhibitor: saved.data || updated,
    warning: saved.error || !saved.data ? 'Email inviata, ma lo stato CRM non è stato aggiornato. Verifica l’invio in Gmail.' : null,
  }
}

export async function reconcileDestinationDraft(supabase: any, userId: string, id: string, inspect = inspectPreparedGmailDraft) {
  const current = await supabase.from('trade_fair_exhibitors').select('*').eq('user_id', userId).eq('id', id).maybeSingle()
  if (current.error) throw current.error
  if (!current.data) throw new DestinationEmailError('Espositore non trovato.', 404)
  const row: FairExhibitor = current.data
  const draft = row.outreach?.destination_email
  if (draft?.status !== 'draft') return row
  const outcome = await inspect(supabase, userId, draft)
  if (outcome.state !== 'sent') return row
  const at = outcome.sentAt || new Date().toISOString()
  const note = newNote(`Email inviata da Gmail: ${outcome.subject || draft.subject}`)
  const patch = {
    status: row.status === 'new' ? 'contacted' : row.status,
    contacted_at: row.contacted_at || at,
    notes: note ? [note, ...(row.notes || [])].slice(0, 200) : row.notes,
    outreach: { ...row.outreach, destination_email: { ...draft, status: 'sent' as const, sent_at: at, message_id: outcome.id,
      subject: outcome.subject || draft.subject, body: outcome.text || draft.body } },
    updated_at: new Date().toISOString(),
  }
  const saved = await supabase.from('trade_fair_exhibitors').update(patch)
    .eq('user_id', userId).eq('id', row.id).eq('updated_at', row.updated_at)
    .eq('outreach->destination_email->>status', 'draft')
    .eq('outreach->destination_email->>token', draft.token).select('*').maybeSingle()
  if (saved.error) throw saved.error
  return saved.data || row
}
