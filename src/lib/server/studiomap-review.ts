import { officeStudioRequest } from '@/lib/server/office-agents/maps-bridge'
import { answerTelegramCallback, sendTelegramCard, sendTelegramMessage, setTelegramButtons, type TelegramConfig } from '@/lib/server/telegram'
import { errorMessage } from '@/lib/server/http'
import {
  REVIEW_DONE_DATA,
  REVIEW_PAGE_SIZE,
  reviewCardMessage,
  reviewFooter,
  reviewIntro,
  reviewMapsList,
  reviewOutcome,
  type ReviewAction,
  type ReviewPage,
} from '@/lib/office/studiomap-review'

/**
 * La coda «Da decidere» di StudioMap su Telegram (vedi `lib/office/studiomap-review.ts`).
 * Legge e decide con il bridge dell'ufficio (`/api/office/review/*`, OFFICE_BRIDGE_SECRET):
 * le regole della coda restano in StudioMap, qui si mandano messaggi e pulsanti.
 */

async function sendPage(config: TelegramConfig, chatId: string | number, page: ReviewPage, offset: number) {
  await sendTelegramMessage(config, chatId, reviewIntro(page, offset))
  for (const card of page.cards) {
    const message = reviewCardMessage(card, page.map)
    await sendTelegramCard(config, chatId, message.text, message.keyboard, card.image_url)
  }
  const footer = reviewFooter(page)
  if (footer && page.cards.length) await sendTelegramCard(config, chatId, footer.text, footer.keyboard)
}

/** «dubbi» / «dubbi Marsiglia»: l'elenco delle mappe o il primo giro di schede. */
export async function handleReviewCommand(config: TelegramConfig, chatId: string | number, city: string | null) {
  try {
    if (!city) {
      const res = await officeStudioRequest('/api/office/review/read', {}, 60_000) as { maps: Array<{ city: string; total: number }> }
      await sendTelegramMessage(config, chatId, reviewMapsList(res.maps || []))
      return
    }
    const page = await officeStudioRequest('/api/office/review/read', { city, limit: REVIEW_PAGE_SIZE }, 60_000) as ReviewPage
    await sendPage(config, chatId, page, 0)
  } catch (error) {
    await sendTelegramMessage(config, chatId, `Coda «Da decidere» non disponibile: ${errorMessage(error, 'StudioMap non risponde')}`)
  }
}

/** Un tocco su Tieni/Togli/Le prossime. Risponde sempre al tocco, così la rotellina si ferma. */
export async function handleReviewAction(
  config: TelegramConfig,
  chatId: string | number,
  messageId: number | undefined,
  callbackId: string,
  action: ReviewAction,
) {
  if (action.kind === 'review_done') {
    await answerTelegramCallback(config, callbackId, 'Già decisa.')
    return { done: false }
  }
  if (action.kind === 'review_more') {
    await answerTelegramCallback(config, callbackId, 'Arrivano…')
    if (messageId) await setTelegramButtons(config, chatId, messageId, [])
    try {
      const page = await officeStudioRequest('/api/office/review/read', { map: action.map, offset: action.offset, limit: REVIEW_PAGE_SIZE }, 60_000) as ReviewPage
      await sendPage(config, chatId, page, action.offset)
    } catch (error) {
      await sendTelegramMessage(config, chatId, `Coda «Da decidere» non disponibile: ${errorMessage(error, 'StudioMap non risponde')}`)
    }
    return { done: true }
  }
  try {
    const result = await officeStudioRequest('/api/office/review/decide', { map: action.map, item: action.item, decision: action.decision }, 60_000) as {
      status: string; decision?: string; name?: string; remaining?: number
    }
    const outcome = reviewOutcome(result)
    await answerTelegramCallback(config, callbackId, outcome.toast)
    if (messageId) await setTelegramButtons(config, chatId, messageId, [[{ text: outcome.label, callback_data: REVIEW_DONE_DATA }]])
    return { done: outcome.done }
  } catch (error) {
    // Esito incerto: i pulsanti restano, un secondo tocco trova la scheda già decisa se era passata.
    await answerTelegramCallback(config, callbackId, `Non riuscito: ${errorMessage(error, 'StudioMap non risponde')}`.slice(0, 190))
    return { done: false }
  }
}
