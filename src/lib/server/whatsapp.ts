import { errorMessage } from '@/lib/server/http'

/**
 * Uscita delle notifiche del CRM: Telegram se configurato, altrimenti il
 * gateway WhatsApp OpenWA.
 *
 * Telegram e la strada preferita: e un'API ufficiale e gratuita, quindi una
 * notifica e una chiamata HTTPS e basta. OpenWA invece tiene acceso un Chromium
 * da ~1 GB solo per restare agganciato a WhatsApp Web, e quando la sessione
 * cade (succede da solo) le notifiche tacciono finche qualcuno non riscansiona
 * il QR. Con `TELEGRAM_BOT_TOKEN` e `TELEGRAM_NOTIFY_CHAT_ID` impostati vince
 * Telegram e OpenWA puo restare spento.
 *
 * Client del gateway WhatsApp OpenWA (self-hosted, https://github.com/rmyndharis/OpenWA).
 *
 * Non e l'API ufficiale Meta: il gateway tiene agganciato un numero vero via QR
 * e lo pilota via REST. Da qui esce solo traffico interno (notifiche a noi), mai
 * outreach verso i contatti: un numero che scrive a sconosciuti viene bloccato.
 *
 * Nelle env restano solo le credenziali del gateway, che sono infrastruttura.
 * Il destinatario e l'interruttore vivono nel CRM
 * (`whatsapp_notification_settings`, pagina /impostazioni/whatsapp): cambiare
 * numero non deve voler dire aprire Railway e riavviare il servizio.
 *
 * Regola non negoziabile: nessuna funzione di questo file puo far fallire il
 * flusso che la chiama. Il gateway e un servizio esterno che puo essere spento,
 * disconnesso o in reload — un invio email non deve dipendere da lui.
 */

const REQUEST_TIMEOUT_MS = 10_000
const MAX_TEXT_LENGTH = 4096
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g
const DEFAULT_COUNTRY_PREFIX = '39'
const TELEGRAM_API_BASE = 'https://api.telegram.org'

export type NotificationChannel = 'telegram' | 'whatsapp'

export type WhatsappConfig = {
  baseUrl: string
  apiKey: string
  sessionId: string
}

export type WhatsappSendResult = {
  ok: boolean
  providerMessageId?: string
  error?: string
}

/**
 * Da "389 686 8162" o "+39 389 6868162" a "393896868162@c.us". OpenWA vuole il
 * WID completo. Un numero italiano scritto senza prefisso internazionale — come
 * lo si scrive di solito — prenderebbe altrimenti un destinatario inesistente,
 * quindi il 39 lo mettiamo noi.
 */
export function normalizeChatId(raw?: string | null): string | null {
  const value = String(raw || '').trim()
  if (!value) return null
  if (/@(c|g|lid)\.us$/i.test(value)) return value

  let digits = value.replace(/\D+/g, '')
  if (digits.startsWith('00')) digits = digits.slice(2)
  if (digits.length < 8) return null
  // Un cellulare italiano senza prefisso: 3xx xxx xxxx, 9 o 10 cifre.
  if (!value.trim().startsWith('+') && digits.length <= 10 && digits.startsWith('3')) {
    digits = `${DEFAULT_COUNTRY_PREFIX}${digits}`
  }
  return `${digits}@c.us`
}

/**
 * Freno di emergenza globale: `WHATSAPP_NOTIFY_ENABLED=false` spegne tutto
 * anche se nell'interfaccia l'interruttore e acceso. Non impostata, decide il
 * CRM.
 */
export function isWhatsappHardDisabled() {
  return String(process.env.WHATSAPP_NOTIFY_ENABLED || '').trim().toLowerCase() === 'false'
}

export function whatsappConfig(): WhatsappConfig | null {
  const baseUrl = String(process.env.OPENWA_BASE_URL || '').trim().replace(/\/+$/, '')
  const apiKey = String(process.env.OPENWA_API_KEY || '').trim()
  const sessionId = String(process.env.OPENWA_SESSION_ID || '').trim()
  if (!baseUrl || !apiKey || !sessionId) return null
  return { baseUrl, apiKey, sessionId }
}

/**
 * Il bot e lo stesso del To Do vocale (`TELEGRAM_BOT_TOKEN`), ma la chat a cui
 * scrivere e una sola e sta in `TELEGRAM_NOTIFY_CHAT_ID`: le chat autorizzate a
 * scrivere nel CRM (`TELEGRAM_ALLOWED_CHAT_IDS`) sono un'altra cosa.
 */
export function telegramNotifyConfig(): { token: string; chatId: string } | null {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim()
  const chatId = String(process.env.TELEGRAM_NOTIFY_CHAT_ID || '').trim()
  if (!token || !/^-?\d+$/.test(chatId)) return null
  return { token, chatId }
}

export function notificationChannel(): NotificationChannel | null {
  if (telegramNotifyConfig()) return 'telegram'
  if (whatsappConfig()) return 'whatsapp'
  return null
}

/**
 * A chi arriva il messaggio. Su Telegram la chat sta nelle env, perche un chat
 * id non e un numero che si scrive a mano; su WhatsApp e il numero salvato nel
 * CRM (`notify_to`).
 */
export function notificationRecipient(notifyTo?: string | null): string | null {
  const telegram = telegramNotifyConfig()
  if (telegram) return telegram.chatId
  return normalizeChatId(notifyTo)
}

export function whatsappGatewayStatus() {
  const channel = notificationChannel()
  const missing: string[] = []
  if (!channel) {
    if (!String(process.env.TELEGRAM_BOT_TOKEN || '').trim()) missing.push('TELEGRAM_BOT_TOKEN')
    if (!String(process.env.TELEGRAM_NOTIFY_CHAT_ID || '').trim()) missing.push('TELEGRAM_NOTIFY_CHAT_ID')
  }
  return {
    channel,
    configured: channel !== null,
    missing,
    hard_disabled: isWhatsappHardDisabled(),
  }
}

async function openwaFetch(config: WhatsappConfig, path: string, init?: RequestInit) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(`${config.baseUrl}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        'X-API-Key': config.apiKey,
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
      },
    })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * WhatsApp taglia a 4096 caratteri: meglio troncare noi con un segnalino che
 * far rifiutare il messaggio dal gateway e perdere tutto il riepilogo.
 */
export function clampWhatsappText(value: string) {
  const text = String(value || '').replace(CONTROL_CHARS, '').trim()
  if (text.length <= MAX_TEXT_LENGTH) return text
  return `${text.slice(0, MAX_TEXT_LENGTH - 2)} …`
}

/**
 * I messaggi sono scritti con il grassetto di WhatsApp (`*testo*`). Telegram lo
 * capisce in HTML: si scappano i caratteri riservati e il grassetto diventa
 * `<b>`. Il Markdown di Telegram sarebbe piu corto ma rifiuta l'intero messaggio
 * per un solo `_` o `*` spaiato nel nome di una cantina.
 */
export function toTelegramHtml(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*([^*\n]+)\*/g, '<b>$1</b>')
}

async function telegramSendMessage(token: string, payload: Record<string, unknown>) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(`${TELEGRAM_API_BASE}/bot${token}/sendMessage`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ link_preview_options: { is_disabled: true }, ...payload }),
    })
    const data = await response.json().catch(() => null)
    return { status: response.status, data }
  } finally {
    clearTimeout(timer)
  }
}

async function sendTelegramText(body: string, config: { token: string; chatId: string }): Promise<WhatsappSendResult> {
  try {
    let sent = await telegramSendMessage(config.token, {
      chat_id: config.chatId,
      text: toTelegramHtml(body),
      parse_mode: 'HTML',
    })
    // Un 400 qui e quasi sempre la formattazione (o i tag che allungano oltre
    // 4096): meglio il testo nudo che un riepilogo perso.
    if (sent.status === 400) {
      sent = await telegramSendMessage(config.token, { chat_id: config.chatId, text: body })
    }
    if (!sent.data?.ok) {
      return { ok: false, error: String(sent.data?.description || `HTTP ${sent.status}`) }
    }
    return { ok: true, providerMessageId: String(sent.data.result?.message_id || '') || undefined }
  } catch (error) {
    return { ok: false, error: errorMessage(error, 'Telegram irraggiungibile') }
  }
}

/**
 * Manda una notifica sul canale configurato. `notifyTo` e il numero WhatsApp
 * del CRM; su Telegram si ignora e vale `TELEGRAM_NOTIFY_CHAT_ID`.
 */
export async function sendNotificationText(
  text: string,
  options: { notifyTo?: string | null }
): Promise<WhatsappSendResult> {
  if (isWhatsappHardDisabled()) return { ok: false, error: 'Notifiche disattivate da WHATSAPP_NOTIFY_ENABLED' }

  const body = clampWhatsappText(text)
  if (!body) return { ok: false, error: 'Messaggio vuoto' }

  const telegram = telegramNotifyConfig()
  if (telegram) return sendTelegramText(body, telegram)

  const config = whatsappConfig()
  if (!config) return { ok: false, error: 'Nessun canale di notifica configurato (Telegram o WhatsApp)' }

  const chatId = normalizeChatId(options.notifyTo)
  if (!chatId) return { ok: false, error: 'Numero destinatario mancante o non valido' }

  try {
    const response = await openwaFetch(config, `/api/sessions/${config.sessionId}/messages/send-text`, {
      method: 'POST',
      body: JSON.stringify({ chatId, text: body, linkPreview: false }),
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      const detail = payload?.message || payload?.error || `HTTP ${response.status}`
      return { ok: false, error: typeof detail === 'string' ? detail : JSON.stringify(detail) }
    }
    return { ok: true, providerMessageId: String(payload?.id || payload?.messageId || '') || undefined }
  } catch (error) {
    return { ok: false, error: errorMessage(error, 'Gateway WhatsApp irraggiungibile') }
  }
}

/**
 * Stato della sessione WhatsApp: `ready` e l'unico stato che invia davvero.
 * `qr_ready` significa che il numero e stato sganciato e va riscansionato.
 */
export async function fetchWhatsappSessionStatus() {
  const config = whatsappConfig()
  if (!config) return { ok: false as const, error: 'Gateway WhatsApp non configurato' }
  try {
    const response = await openwaFetch(config, `/api/sessions/${config.sessionId}`, { method: 'GET' })
    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      return { ok: false as const, error: payload?.message || `HTTP ${response.status}` }
    }
    return {
      ok: true as const,
      status: String(payload?.status || 'unknown'),
      phone: payload?.phone || null,
      push_name: payload?.pushName || null,
      connected_at: payload?.connectedAt || null,
      last_error: payload?.lastError || null,
    }
  } catch (error) {
    return { ok: false as const, error: errorMessage(error, 'Gateway WhatsApp irraggiungibile') }
  }
}
