import { QUOTE_TERMS_LAST_UPDATED_IT } from '@/lib/quote-defaults'

const PNG_PREFIX = 'data:image/png;base64,'
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** Un tratto vero pesa qualche KB; sotto i 500 byte il riquadro e' vuoto. */
export const SIGNATURE_MIN_BYTES = 500
export const SIGNATURE_MAX_BYTES = 200 * 1024

export const SIGNATURE_ACCEPTED_TEXT =
  'Dichiaro di aver letto e accettato le condizioni contrattuali e i Termini di servizio Speaqi per questa offerta.'
export const SIGNATURE_RENEWAL_TEXT =
  'Approvo specificamente, ai sensi degli artt. 1341 e 1342 c.c., il rinnovo automatico annuale e le clausole su durata, disdetta e limitazione di responsabilità.'

export type SignatureCheck = { ok: true } | { ok: false; error: string }

export function validateSignatureDataUrl(value: unknown): SignatureCheck {
  if (typeof value !== 'string' || !value.startsWith(PNG_PREFIX)) {
    return { ok: false, error: 'Firma non valida: serve un’immagine PNG' }
  }
  const base64 = value.slice(PNG_PREFIX.length)
  if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    return { ok: false, error: 'Firma non valida' }
  }
  const bytes = Buffer.from(base64, 'base64')
  if (bytes.length < SIGNATURE_MIN_BYTES) return { ok: false, error: 'La firma è vuota: firma nel riquadro' }
  if (bytes.length > SIGNATURE_MAX_BYTES) return { ok: false, error: 'Firma troppo pesante' }
  if (!PNG_MAGIC.every((byte, index) => bytes[index] === byte)) {
    return { ok: false, error: 'Firma non valida: serve un’immagine PNG' }
  }
  return { ok: true }
}

export type SignPayload = {
  token: string
  acceptanceToken: string
  signerName: string
  signaturePng: string
  renewalAccepted: boolean
}

export function parseSignPayload(
  body: unknown,
  options: { requireRenewalClause?: boolean } = {}
): { ok: true; value: SignPayload } | { ok: false; error: string } {
  const row = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  const token = String(row.token || '').trim()
  const acceptanceToken = String(row.acceptance_token || '').trim()
  const signerName = String(row.signer_name || '').replace(/\s+/g, ' ').trim()

  if (!token) return { ok: false, error: 'Token mancante' }
  if (!acceptanceToken) return { ok: false, error: 'Apri il link di firma completo' }
  if (signerName.length < 3 || signerName.length > 200) {
    return { ok: false, error: 'Scrivi nome e cognome di chi firma' }
  }
  if (row.accepted !== true) return { ok: false, error: 'Devi accettare le condizioni contrattuali' }
  if (options.requireRenewalClause && row.renewal_accepted !== true) {
    return { ok: false, error: 'Devi approvare il rinnovo automatico e le clausole specifiche' }
  }

  const signature = validateSignatureDataUrl(row.signature_png)
  if (!signature.ok) return signature

  return {
    ok: true,
    value: {
      token,
      acceptanceToken,
      signerName,
      signaturePng: String(row.signature_png),
      renewalAccepted: row.renewal_accepted === true,
    },
  }
}

/** Railway mette il client in testa a x-forwarded-for. */
export function clientIp(headers: Headers) {
  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }
  return headers.get('x-real-ip')?.trim() || null
}

export function signatureTermsMeta(renewalAccepted: boolean) {
  return {
    terms_url: '/termini-speaqi',
    terms_last_updated: QUOTE_TERMS_LAST_UPDATED_IT,
    accepted_text: SIGNATURE_ACCEPTED_TEXT,
    ...(renewalAccepted ? { renewal_clause_text: SIGNATURE_RENEWAL_TEXT } : {}),
  }
}
