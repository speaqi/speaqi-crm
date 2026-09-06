import { errorMessage } from '@/lib/server/http'

/**
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

export function whatsappGatewayStatus() {
  const missing: string[] = []
  if (!String(process.env.OPENWA_BASE_URL || '').trim()) missing.push('OPENWA_BASE_URL')
  if (!String(process.env.OPENWA_API_KEY || '').trim()) missing.push('OPENWA_API_KEY')
  if (!String(process.env.OPENWA_SESSION_ID || '').trim()) missing.push('OPENWA_SESSION_ID')
  return {
    configured: missing.length === 0,
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

export async function sendWhatsappText(
  text: string,
  options: { chatId?: string | null }
): Promise<WhatsappSendResult> {
  const config = whatsappConfig()
  if (!config) return { ok: false, error: 'Gateway WhatsApp non configurato' }
  if (isWhatsappHardDisabled()) return { ok: false, error: 'Notifiche WhatsApp disattivate da WHATSAPP_NOTIFY_ENABLED' }

  const chatId = normalizeChatId(options.chatId)
  if (!chatId) return { ok: false, error: 'Numero destinatario mancante o non valido' }

  const body = clampWhatsappText(text)
  if (!body) return { ok: false, error: 'Messaggio vuoto' }

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
