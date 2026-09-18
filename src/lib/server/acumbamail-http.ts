/**
 * L'unico punto da cui il CRM parla con Acumbamail.
 *
 * Acumbamail applica un tetto per endpoint e per cliente (`policy: 10/m` su
 * `addMergeTag`, e limiti analoghi altrove). I due client storici
 * (`acumbamail-api.ts` per le statistiche, `acumbamail-marketing.ts` per liste
 * e campagne) chiamavano `fetch` direttamente e trattavano il 429 come un
 * errore qualsiasi: bastava una raffica per far fallire un invio gia'
 * preparato. Il 13 settembre 2026 sono cosi' rimaste a terra 46 email della
 * sequenza Wine, tutte con lo stesso `addMergeTag (429)`, e senza un secondo
 * tentativo: le cantine non le hanno mai ricevute.
 *
 * Qui il 429 smette di essere un errore e torna a essere quello che e': una
 * richiesta di aspettare. Due meccanismi, entrambi necessari:
 *
 *  - **coda per endpoint**: le chiamate allo stesso metodo vengono serializzate
 *    e distanziate di `MIN_INTERVAL_MS`, cosi' il tetto non viene superato in
 *    partenza. E' per endpoint perche' il tetto e' per endpoint: mettere in
 *    fila anche chiamate a metodi diversi rallenterebbe senza motivo;
 *  - **attesa sul 429**: se il tetto viene comunque colpito (un'altra istanza,
 *    una finestra ancora aperta), si aspetta il `retry_after_seconds` indicato
 *    dalla risposta e si riprova.
 *
 * La coda vive nel processo. Railway tiene un'istanza sola, quindi in pratica
 * copre tutto il traffico del CRM; se un domani le istanze diventassero due,
 * l'attesa sul 429 resta la rete di sicurezza.
 */

const ACUMBAMAIL_API_URL = 'https://acumbamail.com/api/1'

/**
 * 10 richieste al minuto con un margine: 6,5 s fra una e l'altra, e al massimo
 * un tentativo piu' tre ritentativi — oltre, l'errore e' reale e va riportato.
 *
 * Letti a ogni chiamata, non all'import: una costante di modulo congela il
 * valore al primo `require` e rende la soglia non sovrascrivibile dai test.
 */
function minIntervalMs() {
  return Math.max(0, Number(process.env.ACUMBAMAIL_MIN_INTERVAL_MS ?? 6_500))
}

function maxAttempts() {
  return Math.max(1, Number(process.env.ACUMBAMAIL_MAX_ATTEMPTS ?? 4))
}
/** Nessuna attesa singola oltre il minuto: un cron non puo' restare appeso. */
const MAX_WAIT_MS = 60_000
const DEFAULT_WAIT_MS = 15_000

export type AcumbamailResponse = {
  ok: boolean
  status: number
  raw: string
  payload: unknown
}

/** Ultima chiamata effettuata per endpoint, per distanziare la successiva. */
const lastCallAt = new Map<string, number>()
/** Coda per endpoint: ogni chiamata aspetta la precedente sullo stesso metodo. */
const queues = new Map<string, Promise<unknown>>()

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function parseBody(raw: string): unknown {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

/**
 * Quanto aspettare dopo un 429.
 *
 * Acumbamail risponde con `retry_after_seconds`; quando manca, si ricade su
 * `Retry-After` e infine su un'attesa fissa. Il valore viene sempre limitato:
 * un server che chiede dieci minuti non deve poter bloccare il cron.
 */
function retryDelayMs(payload: unknown, headers: Headers) {
  const fromPayload =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? Number((payload as Record<string, unknown>).retry_after_seconds)
      : NaN
  const fromHeader = Number(headers.get('retry-after'))
  // Zero e' un valore, non un'assenza: se il server dice "riprova subito", si
  // riprova subito. Trattarlo come mancante faceva aspettare i quindici
  // secondi del ripiego senza alcun motivo.
  const seconds = Number.isFinite(fromPayload) && fromPayload >= 0
    ? fromPayload
    : Number.isFinite(fromHeader) && fromHeader >= 0
      ? fromHeader
      : null
  if (seconds === null) return DEFAULT_WAIT_MS
  if (seconds <= 0) return 0
  // Un secondo di margine: il contatore dell'API e il nostro orologio non sono
  // lo stesso orologio, e ripartire un istante troppo presto costa un altro 429.
  return Math.min(MAX_WAIT_MS, Math.round(seconds * 1000) + 1_000)
}

async function performRequest(functionName: string, body: URLSearchParams): Promise<AcumbamailResponse> {
  const attempts = maxAttempts()
  const interval = minIntervalMs()
  for (let attempt = 1; ; attempt += 1) {
    const since = Date.now() - (lastCallAt.get(functionName) ?? 0)
    if (since < interval) await sleep(interval - since)

    lastCallAt.set(functionName, Date.now())
    const response = await fetch(`${ACUMBAMAIL_API_URL}/${functionName}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      cache: 'no-store',
    })
    const raw = await response.text()
    const payload = parseBody(raw)

    if (response.status === 429 && attempt < attempts) {
      const wait = retryDelayMs(payload, response.headers)
      console.warn(`Acumbamail ${functionName}: 429, attesa ${Math.round(wait / 1000)}s (tentativo ${attempt}/${attempts})`)
      await sleep(wait)
      continue
    }

    return { ok: response.ok, status: response.status, raw, payload }
  }
}

/**
 * Esegue una chiamata Acumbamail rispettando coda e tetto dell'endpoint.
 *
 * Non lancia sugli status di errore: restituisce `ok: false` e lascia al
 * chiamante la formulazione del messaggio, che nei due client e' diversa.
 */
export function acumbamailRequest(functionName: string, body: URLSearchParams): Promise<AcumbamailResponse> {
  const previous = queues.get(functionName) ?? Promise.resolve()
  // `catch` sul precedente: un fallimento non deve rompere la catena per tutte
  // le chiamate successive allo stesso endpoint.
  const next = previous.catch(() => {}).then(() => performRequest(functionName, body))
  queues.set(functionName, next.catch(() => {}))
  return next
}

/** Corpo di una richiesta Acumbamail: token e formato sono sempre gli stessi. */
export function acumbamailForm(authToken: string, data: Record<string, unknown> = {}) {
  const form = new URLSearchParams()
  for (const [key, value] of Object.entries({ ...data, auth_token: authToken, response_type: 'json' })) {
    form.set(key, value && typeof value === 'object' ? JSON.stringify(value) : String(value ?? ''))
  }
  return form
}
