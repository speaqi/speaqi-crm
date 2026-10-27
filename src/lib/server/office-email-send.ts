import { getGmailAccount, refreshAccessToken, sendContactEmail, simpleTextToHtml } from './gmail'
import { errorMessage } from './http'
import { nextFollowupAfterEmail } from '../sla'
import { officeSendDailyCap, romeDayStart, sendErrorIsBeforeSend } from '../office/autonomy'
import type { CRMContact } from '@/types'

type Admin = any

export type OfficeSendResult =
  | { ok: true; text: string; gmail_message_id: string | null }
  | { ok: false; text: string; status: number; /** La bozza è forse partita: non si riprova alla cieca. */ uncertain?: boolean }

const escapeLike = (email: string) => email.trim().replace(/[\\%_]/g, (v) => `\\${v}`)

/**
 * «Approva e invia» su una bozza email preparata da un agente dell'Ufficio.
 *
 * Una bozza parte una volta sola: la si prende passando da `pending` a `sending` con un
 * UPDATE condizionato, quindi un doppio tocco o la pagina e Telegram insieme trovano la
 * bozza già presa. Prima di partire si ricontrolla quello che può essere cambiato dalla
 * notte in cui è nata: disiscrizione, una risposta del cliente, il tetto del giorno.
 * Un errore prima dell'invio rimette la bozza in attesa; uno dopo (Gmail ha forse
 * accettato) la lascia `unknown`, da controllare in Gmail → Inviati prima di riprovare.
 */
export type OfficeSendDeps = {
  getAccount: typeof getGmailAccount
  refresh: typeof refreshAccessToken
  send: typeof sendContactEmail
}
const REAL_DEPS: OfficeSendDeps = { getAccount: getGmailAccount, refresh: refreshAccessToken, send: sendContactEmail }

export async function sendOfficeDraft(admin: Admin, userId: string, draftId: string, now = new Date(), deps: OfficeSendDeps = REAL_DEPS): Promise<OfficeSendResult> {
  const claimed = await admin.from('email_drafts')
    .update({ status: 'sending', sending_at: now.toISOString(), last_send_error: null })
    .eq('id', draftId).eq('user_id', userId).eq('status', 'pending').eq('source', 'office')
    .select('*').maybeSingle()
  if (claimed.error) throw claimed.error
  const draft = claimed.data
  if (!draft) {
    const { data: current } = await admin.from('email_drafts').select('status').eq('id', draftId).eq('user_id', userId).maybeSingle()
    if (current?.status === 'sent') return { ok: false, status: 409, text: 'Questa email è già partita.' }
    if (current?.status === 'sending' || current?.status === 'unknown') return { ok: false, status: 409, uncertain: true, text: 'Invio già in corso o da verificare: controlla in Gmail → Inviati.' }
    return { ok: false, status: 409, text: 'Bozza non trovata o già gestita.' }
  }

  const release = async (reason: string, status: 'pending' | 'unknown' = 'pending') => {
    await admin.from('email_drafts').update({ status, last_send_error: reason.slice(0, 1000), sending_at: status === 'pending' ? null : draft.sending_at })
      .eq('id', draftId).eq('user_id', userId).eq('status', 'sending')
  }

  try {
    const { data: contact, error: contactError } = await admin.from('contacts').select('*').eq('id', draft.contact_id).eq('user_id', userId).maybeSingle()
    if (contactError) throw contactError
    if (!contact?.email) { await release('Contatto senza email'); return { ok: false, status: 400, text: 'Il contatto non ha un’email: la bozza resta da correggere.' } }
    if (contact.email_unsubscribed_at) { await release('Contatto disiscritto'); return { ok: false, status: 409, text: `${contact.email} si è disiscritto: non la mando.` } }

    // Il cliente ha risposto dopo che la bozza è nata: la bozza non tiene conto della risposta.
    const reply = await admin.from('gmail_messages').select('id').eq('user_id', userId).eq('direction', 'inbound')
      .ilike('from_email', escapeLike(contact.email)).gt('sent_at', draft.created_at).limit(1)
    if (reply.error) throw reply.error
    if (reply.data?.length) {
      await release('Il cliente ha risposto dopo la bozza')
      return { ok: false, status: 409, text: 'Il cliente ha risposto dopo che ho scritto la bozza: leggila prima, non la mando.' }
    }

    // Tetto del giorno sulle email dell'Ufficio (questa compresa, già in «sending»).
    const cap = officeSendDailyCap()
    const { count, error: countError } = await admin.from('email_drafts').select('id', { count: 'exact', head: true })
      .eq('user_id', userId).eq('source', 'office').eq('sent_via', 'crm').eq('status', 'sent').gte('sent_at', romeDayStart(now))
    if (countError) throw countError
    if ((count || 0) >= cap) {
      await release(`Tetto giornaliero di ${cap} email raggiunto`)
      return { ok: false, status: 429, text: `Oggi sono già partite ${count} email dell’Ufficio (tetto ${cap}). La bozza resta pronta per domani.` }
    }

    // Gmail collegato e token valido prima di comporre: un errore qui è sicuramente «prima».
    const account = await deps.getAccount(admin, userId)
    if (!account) { await release('Gmail non collegato'); return { ok: false, status: 400, text: 'Gmail non è collegato al CRM: collegalo da Impostazioni e riprova.' } }
    await deps.refresh(account)

    const text = String(draft.body_text || '').trim()
    if (!text) { await release('Bozza vuota'); return { ok: false, status: 400, text: 'La bozza è vuota: correggila nel CRM.' } }
    const subject = String(draft.subject || '').trim() || '(nessun oggetto)'

    let result
    try {
      result = await deps.send(admin, userId, contact as CRMContact, {
        subject,
        html: draft.body_html || simpleTextToHtml(text),
        text,
        followupAt: nextFollowupAfterEmail(contact.status, now).toISOString(),
        appendSignature: true,
      })
    } catch (error) {
      const message = errorMessage(error, 'Invio non riuscito')
      if (sendErrorIsBeforeSend(message)) {
        await release(message)
        return { ok: false, status: 502, text: `Non è partita: ${message}. La bozza resta pronta.` }
      }
      await release(message, 'unknown')
      return { ok: false, status: 502, uncertain: true, text: `Esito incerto (${message}). Controlla in Gmail → Inviati prima di riprovare: non la rimando da solo.` }
    }

    const gmailId = result?.message?.gmail_message_id || null
    const { error: markError } = await admin.from('email_drafts').update({
      status: 'sent', sent_at: new Date().toISOString(), sent_via: 'crm', provider_message_id: gmailId,
      gmail_draft_id: null, gmail_draft_message_id: null, last_send_error: null,
    }).eq('id', draftId).eq('user_id', userId)
    if (markError) console.error('[office-send] bozza inviata ma non segnata', { draftId, message: markError.message })
    return { ok: true, gmail_message_id: gmailId, text: `📨 Inviata a ${contact.email}: «${subject}».` }
  } catch (error) {
    const message = errorMessage(error, 'Invio non riuscito')
    await release(message)
    return { ok: false, status: 500, text: `Non è partita: ${message}. La bozza resta pronta.` }
  }
}

/**
 * L'uscita «bozza email» di un agente, approvata e mandata insieme. Prima parte l'email,
 * poi si registra la decisione: un invio fallito lascia la proposta da decidere.
 */
export async function approveAndSendOutput(admin: Admin, userId: string, outputId: string, decide: (id: string) => Promise<unknown>, deps: OfficeSendDeps = REAL_DEPS): Promise<OfficeSendResult> {
  const { data: output, error } = await admin.from('office_agent_outputs').select('id,kind,status,body,target_table,target_id')
    .eq('id', outputId).eq('user_id', userId).maybeSingle()
  if (error) throw error
  if (!output || output.kind !== 'draft_email') return { ok: false, status: 404, text: 'Bozza non trovata.' }
  if (output.status !== 'pending') return { ok: false, status: 409, text: 'Questa bozza è già stata decisa.' }
  const draftId = typeof output.body?.email_draft_id === 'string' ? output.body.email_draft_id
    : output.target_table === 'email_drafts' ? output.target_id : null
  if (!draftId) return { ok: false, status: 400, text: 'La proposta non porta una bozza email da mandare.' }
  const sent = await sendOfficeDraft(admin, userId, draftId, new Date(), deps)
  if (sent.ok) await decide(outputId).catch((e) => console.error('[office-send] decisione non registrata', { outputId, message: errorMessage(e, '') }))
  return sent
}
