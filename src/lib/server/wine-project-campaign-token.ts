import { createHmac, timingSafeEqual } from 'crypto'

const VERSION = 'v1'
const SCOPE = 'wine-project-campaign'

export type WineProjectCampaignTokenPayload = {
  scope: typeof SCOPE
  user_id: string
  contact_id: string
  event_id: string
  exp: number
}

function secret() {
  return process.env.WINE_PROJECT_LINK_SECRET || process.env.SPEAQI_WEBHOOK_SECRET || ''
}

function signature(value: string, tokenSecret: string) {
  return createHmac('sha256', tokenSecret).update(value).digest('base64url')
}

export function createWineProjectCampaignToken(input: Omit<WineProjectCampaignTokenPayload, 'scope' | 'exp'>, expiresAt = Date.now() + 90 * 24 * 60 * 60 * 1000) {
  const tokenSecret = secret()
  if (!tokenSecret) throw new Error('WINE_PROJECT_LINK_SECRET non configurato')
  const encoded = Buffer.from(JSON.stringify({ ...input, scope: SCOPE, exp: expiresAt } satisfies WineProjectCampaignTokenPayload)).toString('base64url')
  const unsigned = `${VERSION}.${encoded}`
  return `${unsigned}.${signature(unsigned, tokenSecret)}`
}

export function verifyWineProjectCampaignToken(token?: string | null): WineProjectCampaignTokenPayload | null {
  const tokenSecret = secret()
  const [version, encoded, suppliedSignature] = String(token || '').split('.')
  if (!tokenSecret || version !== VERSION || !encoded || !suppliedSignature) return null

  const unsigned = `${version}.${encoded}`
  const expected = signature(unsigned, tokenSecret)
  if (expected.length !== suppliedSignature.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(suppliedSignature))) return null

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Partial<WineProjectCampaignTokenPayload>
    if (payload.scope !== SCOPE || typeof payload.user_id !== 'string' || typeof payload.contact_id !== 'string' || typeof payload.event_id !== 'string' || typeof payload.exp !== 'number' || payload.exp <= Date.now()) return null
    return payload as WineProjectCampaignTokenPayload
  } catch {
    return null
  }
}
