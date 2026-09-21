import { NextRequest } from 'next/server'
import { requireAutomation } from '@/lib/server/automation-auth'
import { errorMessage } from '@/lib/server/http'
import {
  getTelegramWebhookInfo,
  setTelegramWebhook,
  telegramConfig,
  telegramStatus,
} from '@/lib/server/telegram'

/**
 * Registrazione del webhook presso Telegram, una volta sola per deploy.
 *
 * Si potrebbe fare con una curl a mano, ma quella curl porta dentro il token
 * del bot: farla da qui significa che il token resta nelle env del servizio e
 * non passa per la cronologia di un terminale. Protetta da `AUTOMATION_SECRET`
 * come le altre rotte macchina-a-macchina.
 */

export async function GET(request: NextRequest) {
  const auth = requireAutomation(request)
  if ('response' in auth) return auth.response

  const config = telegramConfig()
  if (!config) return Response.json({ ok: false, ...telegramStatus() }, { status: 503 })

  try {
    return Response.json({ ok: true, webhook: await getTelegramWebhookInfo(config) })
  } catch (error) {
    return Response.json(
      { ok: false, error: errorMessage(error, 'Telegram non risponde') },
      { status: 502 }
    )
  }
}

export async function POST(request: NextRequest) {
  const auth = requireAutomation(request)
  if ('response' in auth) return auth.response

  const config = telegramConfig()
  if (!config) return Response.json({ ok: false, ...telegramStatus() }, { status: 503 })

  try {
    const body = await request.json().catch(() => ({}))
    const base = String(body?.base_url || process.env.APP_BASE_URL || '').trim().replace(/\/+$/, '')
    if (!base) {
      return Response.json({ error: 'APP_BASE_URL non configurata' }, { status: 400 })
    }

    const url = `${base}/api/integrations/telegram/webhook`
    await setTelegramWebhook(config, url)
    return Response.json({ ok: true, url, webhook: await getTelegramWebhookInfo(config) })
  } catch (error) {
    return Response.json(
      { ok: false, error: errorMessage(error, 'Registrazione del webhook non riuscita') },
      { status: 502 }
    )
  }
}
