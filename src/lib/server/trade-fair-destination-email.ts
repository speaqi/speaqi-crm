import { randomUUID } from 'node:crypto'
import { isItalianDestination, newNote, normalizeEmail, type FairExhibitor } from '@/lib/trade-fair'
import { DESTINATION_EMAIL_FOOTER } from '@/lib/trade-fair-destination-email'
import { appendEmailSignature, getConnectedGmailAddress, loadGmailSignature, sendPlainEmail, signatureFromPlainText, simpleTextToHtml, type EmailSignature } from './gmail'
import { loadUserSettings } from './user-settings'
import { errorMessage } from './http'

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
}

/** Invio manuale singolo. La prenotazione atomica impedisce due invii da un doppio clic. */
export async function sendDestinationEmail(
  supabase: any, userId: string, input: { id: string; subject: string; text: string },
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
  if (!isItalianDestination(row)) throw new DestinationEmailError('Questa destinazione non è nella lista italiana.')
  if (row.status === 'not_interested') throw new DestinationEmailError('Questa destinazione è segnata come non interessata.', 409)
  const to = normalizeEmail(row.email)
  if (!to) throw new DestinationEmailError('Aggiungi un indirizzo email valido alla destinazione.')
  if (row.outreach?.destination_email) {
    const message = row.outreach.destination_email.status === 'sent'
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

  const signature = await deps.signature(supabase, userId)
  if (!await deps.sender(supabase, userId)) throw new DestinationEmailError('Gmail non collegato: collegalo dalla pagina Gmail.', 409)
  const signed = appendEmailSignature({ text, html: simpleTextToHtml(text) }, signature)
  const signedText = `${signed.text}\n\n${DESTINATION_EMAIL_FOOTER}`
  const signedHtml = `${signed.html}<br>${simpleTextToHtml(DESTINATION_EMAIL_FOOTER)}`
  const token = randomUUID()
  const sending = { status: 'sending' as const, token, to, subject, body: signedText }
  const claim = await supabase.from('trade_fair_exhibitors')
    .update({ outreach: { ...row.outreach, destination_email: sending }, updated_at: new Date().toISOString() })
    .eq('user_id', userId).eq('id', row.id).eq('updated_at', row.updated_at)
    .is('outreach->destination_email', null).select('*').maybeSingle()
  if (claim.error) throw claim.error
  if (!claim.data) throw new DestinationEmailError('La scheda è stata aggiornata. Ricarica l’elenco prima di inviare.', 409)

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
  const note = newNote(`Email inviata alla destinazione italiana: ${subject}`)
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
