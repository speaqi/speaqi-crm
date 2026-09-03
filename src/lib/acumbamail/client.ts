/**
 * Trasporto per l'API Acumbamail v1.
 *
 * Nessuna dipendenza: solo `fetch`. Il modulo è pensato per essere copiato
 * intero in un altro progetto senza portarsi dietro CRM, Supabase o Next.
 */

export const ACUMBAMAIL_API_URL = 'https://acumbamail.com/api/1'

export type AcumbamailResponse = Record<string, unknown> | unknown[] | string | number

export class AcumbamailError extends Error {
  readonly functionName: string
  readonly status: number | null
  readonly payload: unknown

  constructor(functionName: string, message: string, status: number | null = null, payload: unknown = null) {
    super(message)
    this.name = 'AcumbamailError'
    this.functionName = functionName
    this.status = status
    this.payload = payload
  }
}

/**
 * Estrae l'identificativo restituito da una chiamata di creazione.
 *
 * Acumbamail non è coerente: `createList` risponde `{"list_id": "1468018"}`,
 * altre funzioni rispondono con un numero nudo, con `{"id": ...}`, con un
 * oggetto annidato sotto `data`/`result`/`response`, o con un oggetto la cui
 * unica chiave È l'id. Vanno coperte tutte, altrimenti una creazione riuscita
 * lato server viene letta come fallimento e la catena si interrompe a metà.
 */
export function acumbamailResponseId(functionName: string, payload: AcumbamailResponse): string {
  if (typeof payload === 'string' || typeof payload === 'number') {
    const value = String(payload).trim()
    if (value) return value
  }
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>
    const value = record.id || record.campaign_id || record.list_id
    if (value !== undefined && value !== null && String(value).trim()) return String(value)
    for (const key of ['data', 'result', 'response']) {
      const nested = record[key]
      if (nested && (typeof nested === 'object' || typeof nested === 'string' || typeof nested === 'number')) {
        try {
          return acumbamailResponseId(functionName, nested as AcumbamailResponse)
        } catch {
          // forma non riconosciuta: prova la prossima chiave
        }
      }
    }
    const keys = Object.keys(record)
    if (keys.length === 1 && /^\d+$/.test(keys[0])) return keys[0]
  }
  if (Array.isArray(payload) && payload.length === 1) {
    try {
      return acumbamailResponseId(functionName, payload[0] as AcumbamailResponse)
    } catch {
      // idem
    }
  }
  throw new AcumbamailError(functionName, 'Acumbamail non ha restituito l’identificativo dell’operazione.', null, payload)
}

/**
 * Invia una chiamata all'API. I valori non scalari vengono serializzati in
 * JSON dentro il form: è così che l'API si aspetta `subscribers_data` e
 * `lists`.
 *
 * Una risposta non 2xx è sempre fatale. Vale la pena insistere: le funzioni
 * che non controllano lo stato falliscono in silenzio e il guasto si scopre
 * più avanti, sotto forma di lista vuota o campagna mai creata.
 */
export async function callAcumbamail(
  functionName: string,
  authToken: string,
  data: Record<string, unknown> = {}
): Promise<AcumbamailResponse> {
  const form = new URLSearchParams()
  const inputPayload = { ...data, auth_token: authToken, response_type: 'json' }
  for (const [key, value] of Object.entries(inputPayload)) {
    form.set(key, value && typeof value === 'object' ? JSON.stringify(value) : String(value ?? ''))
  }

  const response = await fetch(`${ACUMBAMAIL_API_URL}/${functionName}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
    cache: 'no-store',
  })

  const raw = await response.text()
  let payload: AcumbamailResponse = {}
  try {
    payload = raw ? JSON.parse(raw) : {}
  } catch {
    payload = { raw }
  }

  if (!response.ok) {
    const message = typeof payload === 'object' ? JSON.stringify(payload).slice(0, 500) : raw.slice(0, 500)
    throw new AcumbamailError(functionName, `Acumbamail ${functionName} (${response.status}): ${message}`, response.status, payload)
  }

  return payload
}
