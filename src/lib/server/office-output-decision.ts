import { approveDirectorContact, startAfterApproval } from './office-director-orders'
import { loadDeck, setApproval } from './tourism-decks'
import { getOrCreateDeckPdf } from './tourism-deck-pdf'
import { sendDeckToTelegram } from './office-deck-telegram'
import { errorMessage } from './http'
import { deckApprovable, type TelegramAction } from '../office/telegram-actions'
import { countTodo } from '../tourism-deck'

type Admin = any
export type OutputDecision = { ok: true; output: unknown; notice?: string; contact_id?: string } | { ok: false; error: string; status: number; extra?: Record<string, unknown> }

/**
 * Approvare o rifiutare un'uscita dell'Ufficio. Una sola strada per il pulsante della
 * pagina e per quello di Telegram: stesse regole, stessa transazione, stessi messaggi.
 */
export async function decideOfficeOutput(admin: Admin, userId: string, id: string, status: 'approved' | 'rejected'): Promise<OutputDecision> {
  if (status === 'approved') {
    // Nuovo contatto dal Direttore: lo inserisce il codice del CRM, con le sue regole.
    const contact = await approveDirectorContact(admin, userId, id)
    if (contact && 'error' in contact) return { ok: false, error: String(contact.error), status: Number(contact.status) || 409 }
    if (contact) return { ok: true, output: contact.output, notice: contact.notice, contact_id: contact.contact_id }
  }
  // Decisione e coda interna nella stessa transazione; nessuna azione esterna.
  const { data, error } = await admin.rpc('decide_office_output', { p_output_id: id, p_user_id: userId, p_status: status })
  if (error) throw error
  if (!data?.output) {
    if (data?.reason === 'merge_failed') {
      // Nessuna unione e' partita: la proposta resta da decidere, con il motivo di ogni gruppo.
      const first = (data.skipped as Array<{ error?: string }> | undefined)?.[0]?.error
      return { ok: false, status: 409, error: `Nessun gruppo unito${first ? `: ${first}` : ''}. La proposta resta in attesa.`, extra: { skipped: data.skipped } }
    }
    if (data?.reason === 'enrich_failed') {
      // Nessuna scrittura: verifiche, CRM e coda tornano indietro insieme, la proposta resta da decidere.
      return { ok: false, status: 409, error: `Ente non portato nel CRM: ${data.error || 'errore'}. La proposta resta in attesa.` }
    }
    if (data?.reason === 'deadline_passed') {
      // La scadenza dell'evento è passata fra la proposta e il clic: approvarla non serve più.
      return { ok: false, status: 409, error: 'La scadenza di questo evento è già passata: non c’è più niente da decidere. Rifiuta la proposta per toglierla dalla coda.' }
    }
    return { ok: false, status: 409, error: data?.reason === 'agent_missing' ? 'Il destinatario non è ancora installato. Installa gli agenti successivi prima di accodare.' : 'Uscita non trovata o già decisa. Aggiorna la pagina.' }
  }
  await startAfterApproval(admin, userId, data.output).catch(() => undefined)
  return { ok: true, output: data.output }
}

/**
 * Il tocco su un pulsante di Telegram, già verificato (segreto del webhook e chat del
 * titolare). Restituisce la frase da mostrare; non lancia mai.
 */
export async function handleTelegramAction(admin: Admin, userId: string, action: TelegramAction): Promise<{ text: string; done: boolean }> {
  try {
    if (action.kind === 'output') {
      const result = await decideOfficeOutput(admin, userId, action.id, action.status)
      if (!result.ok) return { text: result.error, done: result.status === 409 && /già (stata )?decisa/.test(result.error) }
      return { text: result.notice || (action.status === 'approved' ? 'Approvata.' : 'Rifiutata.'), done: true }
    }
    const deck = await loadDeck(admin, userId, action.id)
    if (action.kind === 'deck_pdf') {
      const sent = await sendDeckToTelegram(admin, deck)
      return { text: sent.ok ? 'Te la rimando.' : `Non riesco a mandarla: ${sent.error || 'errore'}`, done: false }
    }
    if (deck.status === 'approved') return { text: 'Era già approvata.', done: true }
    // Un messaggio vecchio può avere ancora il pulsante: si ricontrolla sulla presentazione di adesso.
    if (!deckApprovable({ status: deck.status, todo: countTodo(deck.slides || []) })) {
      return { text: deck.status === 'failed'
        ? 'L’ultima generazione non è riuscita: controllala e approvala dall’editor.'
        : 'Non si approva da qui: restano parti da completare nell’editor.', done: false }
    }
    const approved = await setApproval(admin, deck, true)
    // Come dall'editor: il PDF dell'approvata si prepara subito (il catch non è cosmetico).
    void getOrCreateDeckPdf(admin, approved).catch((e) => console.error('PDF non preparato', { deck: approved.id, message: String(e?.message || e).slice(0, 300) }))
    return { text: `Approvata: «${approved.title}». Il link pubblico è attivo.`, done: true }
  } catch (error) {
    return { text: errorMessage(error, 'Non ci sono riuscito'), done: false }
  }
}
