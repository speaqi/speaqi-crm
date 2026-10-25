import { countTodo } from '../tourism-deck'
import { deckCaption, deckKeyboard, proposalLines, proposalMessage } from '../office/telegram-actions'
import { getOrCreateDeckPdf, pdfFileName } from './tourism-deck-pdf'
import { sendTelegramButtons, sendTelegramDocument, telegramDeliveryConfig } from './whatsapp'
import { errorMessage } from './http'
import type { DeckRow } from './tourism-decks'

type Admin = any

const baseUrl = () => (process.env.APP_BASE_URL || 'https://crm.speaqi.com').replace(/\/$/, '')
export const deckEditorLink = (id: string) => `${baseUrl()}/tourism/presentazioni/${id}`

/**
 * La presentazione arriva su Telegram come PDF, anche in bozza: si guarda dal telefono
 * e, se non resta niente da completare, si approva col pulsante. Il PDF è lo stesso di
 * «Scarica il PDF» nell'editor. Non lancia mai: se Chromium o Telegram non rispondono
 * parte almeno il link, e il motivo resta nel registro.
 */
export async function sendDeckToTelegram(admin: Admin, deck: DeckRow, note: string | null = null): Promise<{ ok: boolean; pdf: boolean; error?: string }> {
  if (!telegramDeliveryConfig()) return { ok: false, pdf: false, error: 'Telegram non configurato' }
  const link = deckEditorLink(deck.id)
  const todo = countTodo(deck.slides || [])
  const caption = deckCaption({ title: deck.title, status: deck.status, todo, link, note })
  const keyboard = deckKeyboard({ id: deck.id, status: deck.status, todo, link })
  try {
    const pdf = await getOrCreateDeckPdf(admin, deck)
    const sent = await sendTelegramDocument({ file: pdf, fileName: pdfFileName(deck.destination || deck.title), caption, keyboard })
    if (sent.ok) return { ok: true, pdf: true }
    console.error('[telegram] PDF della presentazione non inviato:', sent.error)
  } catch (error) {
    console.error('[telegram] PDF della presentazione non pronto:', errorMessage(error, ''))
  }
  // Ripiego: senza PDF almeno il messaggio con il link e i pulsanti.
  const sent = await sendTelegramButtons(`${caption}\n(Il PDF non è partito: aprila dal link.)`, keyboard)
  return { ok: sent.ok, pdf: false, error: sent.ok ? undefined : sent.error }
}

/**
 * Le proposte nate da un ordine arrivano su Telegram una per una, con «Approva» e
 * «Rifiuta». Il tocco passa dalla stessa decisione dell'Ufficio, con le stesse regole.
 */
export async function sendProposalsToTelegram(admin: Admin, userId: string, outputIds: string[]) {
  if (!outputIds.length || !telegramDeliveryConfig()) return 0
  const { data } = await admin.from('office_agent_outputs').select('id,title,body,status').eq('user_id', userId)
    .in('id', outputIds.slice(0, 10)).eq('status', 'pending')
  let sent = 0
  for (const output of (data || []) as Array<{ id: string; title: string; body: any }>) {
    const message = proposalMessage({ id: output.id, title: output.title, lines: proposalLines(output.body), link: `${baseUrl()}/ufficio?uscita=${output.id}` })
    const result = await sendTelegramButtons(message.text, message.keyboard)
    if (result.ok) sent++
    else console.error('[telegram] proposta non inviata:', result.error)
  }
  return sent
}
