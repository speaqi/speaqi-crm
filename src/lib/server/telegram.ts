import { timingSafeEqual } from 'crypto'
import { errorMessage } from '@/lib/server/http'

/**
 * Bot Telegram in ingresso: il canale da cui un vocale diventa un'attività del
 * To Do.
 *
 * È l'opposto del gateway WhatsApp (`whatsapp.ts`), che è di sola uscita e
 * parla a un numero solo. Qui si riceve, quindi valgono due regole che lì non
 * servivano:
 *
 * 1. **Chi scrive conta.** Un bot Telegram risponde a chiunque ne conosca il
 *    nome. Senza un elenco di chat autorizzate, uno sconosciuto potrebbe
 *    scrivere dentro il CRM. L'elenco è in `TELEGRAM_ALLOWED_CHAT_IDS` e non ha
 *    un valore di riserva: senza, il bot non accetta niente da nessuno.
 * 2. **Telegram riconsegna.** Finché non riceve `200` ripropone lo stesso
 *    update, quindi la rotta risponde sempre 200 e l'unicità la garantisce
 *    `telegram_inbox.update_id`. Un errore si racconta in chat, non con un 500.
 */

const API_BASE = 'https://api.telegram.org'
const REQUEST_TIMEOUT_MS = 15_000

export type TelegramConfig = {
  token: string
  allowedChatIds: string[]
  webhookSecret: string
}

export function telegramConfig(): TelegramConfig | null {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim()
  const webhookSecret = String(process.env.TELEGRAM_WEBHOOK_SECRET || '').trim()
  const allowedChatIds = String(process.env.TELEGRAM_ALLOWED_CHAT_IDS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)

  if (!token || !webhookSecret || allowedChatIds.length === 0) return null
  return { token, allowedChatIds, webhookSecret }
}

export function telegramStatus() {
  const missing: string[] = []
  if (!String(process.env.TELEGRAM_BOT_TOKEN || '').trim()) missing.push('TELEGRAM_BOT_TOKEN')
  if (!String(process.env.TELEGRAM_WEBHOOK_SECRET || '').trim()) missing.push('TELEGRAM_WEBHOOK_SECRET')
  if (!String(process.env.TELEGRAM_ALLOWED_CHAT_IDS || '').trim()) missing.push('TELEGRAM_ALLOWED_CHAT_IDS')
  return { configured: missing.length === 0, missing }
}

/** Confronto a tempo costante: il segreto del webhook viaggia in un header. */
export function matchesWebhookSecret(received: string, expected: string) {
  const a = Buffer.from(String(received || ''))
  const b = Buffer.from(String(expected || ''))
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b)
}

export function isAllowedChat(config: TelegramConfig, chatId: string | number | null | undefined) {
  const value = String(chatId ?? '').trim()
  return value.length > 0 && config.allowedChatIds.includes(value)
}

async function telegramFetch(config: TelegramConfig, method: string, body: unknown) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(`${API_BASE}/bot${config.token}/${method}`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok || payload?.ok === false) {
      throw new Error(payload?.description || `HTTP ${response.status}`)
    }
    return payload?.result
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Mandare la risposta non deve poter far fallire il giro: l'attività è già
 * scritta, e un errore qui significherebbe riscriverla al prossimo tentativo.
 */
export async function sendTelegramMessage(
  config: TelegramConfig,
  chatId: string | number,
  text: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    await telegramFetch(config, 'sendMessage', {
      chat_id: chatId,
      text: text.slice(0, 4000),
      disable_web_page_preview: true,
    })
    return { ok: true }
  } catch (error) {
    console.error('[telegram] sendMessage failed:', error)
    return { ok: false, error: errorMessage(error, 'Invio Telegram non riuscito') }
  }
}

export type TelegramAudio = {
  fileId: string
  fileName: string
  mimeType: string
  size: number
}

/** Il vocale di WhatsApp/Telegram, l'audio allegato e il messaggio video-nota. */
export function extractAudio(message: Record<string, any>): TelegramAudio | null {
  const voice = message?.voice
  if (voice?.file_id) {
    return {
      fileId: String(voice.file_id),
      fileName: 'vocale.ogg',
      mimeType: String(voice.mime_type || 'audio/ogg'),
      size: Number(voice.file_size || 0),
    }
  }

  const audio = message?.audio
  if (audio?.file_id) {
    return {
      fileId: String(audio.file_id),
      fileName: String(audio.file_name || 'audio.mp3'),
      mimeType: String(audio.mime_type || 'audio/mpeg'),
      size: Number(audio.file_size || 0),
    }
  }

  const note = message?.video_note
  if (note?.file_id) {
    return {
      fileId: String(note.file_id),
      fileName: 'videonota.mp4',
      mimeType: 'video/mp4',
      size: Number(note.file_size || 0),
    }
  }

  const document = message?.document
  if (document?.file_id && String(document.mime_type || '').startsWith('audio/')) {
    return {
      fileId: String(document.file_id),
      fileName: String(document.file_name || 'audio'),
      mimeType: String(document.mime_type),
      size: Number(document.file_size || 0),
    }
  }

  return null
}

export async function downloadTelegramFile(config: TelegramConfig, fileId: string): Promise<Blob> {
  const file = await telegramFetch(config, 'getFile', { file_id: fileId })
  const path = String(file?.file_path || '')
  if (!path) throw new Error('Telegram non ha restituito il percorso del file')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(`${API_BASE}/file/bot${config.token}/${path}`, { signal: controller.signal })
    if (!response.ok) throw new Error(`Download del vocale non riuscito (HTTP ${response.status})`)
    return await response.blob()
  } finally {
    clearTimeout(timer)
  }
}

export async function setTelegramWebhook(config: TelegramConfig, url: string) {
  return telegramFetch(config, 'setWebhook', {
    url,
    secret_token: config.webhookSecret,
    // Solo i messaggi: reazioni, modifiche di post e sondaggi non hanno niente
    // da dire al To Do e sarebbero solo update da scartare.
    allowed_updates: ['message'],
    drop_pending_updates: false,
  })
}

export async function getTelegramWebhookInfo(config: TelegramConfig) {
  return telegramFetch(config, 'getWebhookInfo', {})
}
