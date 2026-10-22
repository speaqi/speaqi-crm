/**
 * Client delle API di Fatturazione Elettronica Aruba.
 *
 * Tre chiamate: accesso (token di 30 minuti), caricamento dell'XML non
 * firmato (lo firma Aruba e lo consegna allo SDI) e lettura dello stato di una
 * fattura inviata. Le credenziali sono quelle del pannello Fatturazione
 * Elettronica Aruba, con le API abilitate sull'account.
 *
 * L'ambiente di partenza e' la DEMO di Aruba: nulla arriva allo SDI finche'
 * `ARUBA_FE_ENV=production` non lo dice esplicitamente. Una fattura ricorda
 * in quale ambiente e' partita (`invoices.aruba_env`).
 */

export type ArubaEnv = 'demo' | 'production'

const HOSTS: Record<ArubaEnv, { auth: string; ws: string }> = {
  demo: { auth: 'https://demoauth.fatturazioneelettronica.aruba.it', ws: 'https://demows.fatturazioneelettronica.aruba.it' },
  production: { auth: 'https://auth.fatturazioneelettronica.aruba.it', ws: 'https://ws.fatturazioneelettronica.aruba.it' },
}

const TIMEOUT_MS = 30_000

export function arubaEnv(): ArubaEnv {
  return process.env.ARUBA_FE_ENV === 'production' ? 'production' : 'demo'
}

export function arubaConfigured(): boolean {
  return Boolean(process.env.ARUBA_FE_USERNAME && process.env.ARUBA_FE_PASSWORD)
}

export class ArubaError extends Error {
  /** true quando non si sa se Aruba ha ricevuto la fattura (rete, timeout, 5xx). */
  uncertain: boolean
  /** Quota superata (429): si smette di chiamare, ogni richiesta rifiutata allunga il blocco. */
  rateLimited: boolean
  constructor(message: string, uncertain = false, rateLimited = false) {
    super(message)
    this.name = 'ArubaError'
    this.uncertain = uncertain
    this.rateLimited = rateLimited
  }
}

/**
 * Limiti documentati da Aruba: un accesso al minuto per IP, 12 ricerche al
 * minuto, e quote per account (livello base: 60 richieste l'ora, 10.000
 * l'anno). Una richiesta rifiutata con 429 fa ripartire da capo l'attesa,
 * quindi chi la riceve si ferma invece di riprovare.
 */
function throwIfRateLimited(response: Response) {
  if (response.status === 429) throw new ArubaError('Aruba: troppe richieste, quota superata. Si riprova al prossimo giro.', false, true)
}

let cachedToken: { env: ArubaEnv; token: string; expiresAt: number } | null = null

async function request(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), cache: 'no-store' })
  } catch (error) {
    throw new ArubaError(`Aruba non risponde: ${error instanceof Error ? error.message : String(error)}`, true)
  }
}

async function signIn(env: ArubaEnv): Promise<string> {
  if (cachedToken && cachedToken.env === env && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token
  const username = process.env.ARUBA_FE_USERNAME
  const password = process.env.ARUBA_FE_PASSWORD
  if (!username || !password) throw new ArubaError('Credenziali Aruba mancanti: imposta ARUBA_FE_USERNAME e ARUBA_FE_PASSWORD.')

  const response = await request(`${HOSTS[env].auth}/auth/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', Accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'password', username, password }).toString(),
  })
  throwIfRateLimited(response)
  const body = (await response.json().catch(() => null)) as { access_token?: string; expires_in?: number; error_description?: string } | null
  if (!response.ok || !body?.access_token) {
    throw new ArubaError(`Accesso ad Aruba non riuscito (${response.status}): ${body?.error_description || 'controlla utente, password e che le API siano attive sull’account'}.`)
  }
  cachedToken = { env, token: body.access_token, expiresAt: Date.now() + (Number(body.expires_in) || 1800) * 1000 }
  return body.access_token
}

async function authorized(env: ArubaEnv, url: string, init: RequestInit): Promise<Response> {
  const run = async () =>
    request(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${await signIn(env)}`, Accept: 'application/json' } })
  let response = await run()
  if (response.status === 401) {
    cachedToken = null
    response = await run()
  }
  return response
}

/** Carica l'XML (non firmato) e restituisce il nome del file assegnato da Aruba. */
export async function arubaUploadInvoice(xml: string, env: ArubaEnv = arubaEnv()): Promise<{ filename: string }> {
  const response = await authorized(env, `${HOSTS[env].ws}/services/invoice/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json;charset=UTF-8' },
    body: JSON.stringify({ dataFile: Buffer.from(xml, 'utf8').toString('base64'), credential: '', domain: '' }),
  })
  throwIfRateLimited(response)
  const body = (await response.json().catch(() => null)) as { errorCode?: string; errorDescription?: string; uploadFileName?: string } | null
  if (response.status >= 500) throw new ArubaError(`Aruba ha risposto ${response.status} al caricamento.`, true)
  if (!response.ok || !body || (body.errorCode && body.errorCode !== '0000') || !body.uploadFileName) {
    throw new ArubaError(`Aruba ha rifiutato la fattura${body?.errorCode ? ` (${body.errorCode})` : ''}: ${body?.errorDescription || `risposta ${response.status}`}.`)
  }
  return { filename: body.uploadFileName }
}

export type ArubaInvoiceState = { status: string; detail: string | null; sdiId: string | null; raw: unknown }

/** Stato SDI di una fattura inviata, cercata per nome del file. */
export async function arubaInvoiceStatus(filename: string, env: ArubaEnv = arubaEnv()): Promise<ArubaInvoiceState | null> {
  const url = `${HOSTS[env].ws}/services/invoice/out/getByFilename?filename=${encodeURIComponent(filename)}&includePdf=false&includeFile=false`
  const response = await authorized(env, url, { method: 'GET' })
  if (response.status === 404) return null
  throwIfRateLimited(response)
  const body = (await response.json().catch(() => null)) as Record<string, any> | null
  if (!response.ok || !body) throw new ArubaError(`Lettura dello stato non riuscita (${response.status}).`, response.status >= 500)
  const invoice = Array.isArray(body.invoices) ? body.invoices[0] : null
  const status = String(invoice?.status ?? body.status ?? '').trim()
  if (!status) return null
  return {
    status,
    detail: (invoice?.statusDescription ?? body.statusDescription ?? null) || null,
    sdiId: body.idSdi != null ? String(body.idSdi) : null,
    raw: body,
  }
}

export type InvoiceStatus = 'sent' | 'delivered' | 'not_delivered' | 'accepted' | 'refused' | 'rejected' | 'error'

/** Lo stato in parole di Aruba -> lo stato della fattura nel CRM. Sconosciuto = resta inviata. */
export function mapArubaStatus(status: string): InvoiceStatus {
  const s = status.toLowerCase()
  if (s.includes('scartata')) return 'rejected'
  if (s.includes('rifiutata')) return 'refused'
  if (s.includes('non consegnata') || s.includes('recapito impossibile') || s.includes('impossibil')) return 'not_delivered'
  if (s.includes('accettata')) return 'accepted'
  if (s.includes('consegnata') || s.includes('decorrenza')) return 'delivered'
  if (s.includes('errore')) return 'error'
  // "Presa in carico" (Aruba non l'ha ancora trasmessa) e "Inviata" (allo SDI, in attesa di esito).
  return 'sent'
}
