/**
 * Cache in memoria per i contatori dei contatti (`contact_workspace_summary`).
 *
 * - Una sola richiesta per chiave alla volta: barra laterale e pagina Contatti
 *   chiedono gli stessi numeri a pochi millisecondi l'una dall'altra.
 * - Fresca per `FRESH_MS`; poi fino a `STALE_MS` si risponde subito coi numeri
 *   di prima e il ricalcolo parte dietro. Dopo, si aspetta il ricalcolo.
 * - Un ricalcolo fallito non toglie i numeri buoni: si riprova alla prossima.
 */
const FRESH_MS = 15_000
const STALE_MS = 10 * 60_000

type Entry = { value: unknown; at: number }
const entries = new Map<string, Entry>()
const inFlight = new Map<string, Promise<unknown>>()

function refresh<T>(key: string, load: () => Promise<T>, now: () => number): Promise<T> {
  const running = inFlight.get(key)
  if (running) return running as Promise<T>
  const promise = load()
    .then((value) => {
      entries.set(key, { value, at: now() })
      return value
    })
    .finally(() => inFlight.delete(key))
  inFlight.set(key, promise)
  return promise
}

export async function cachedSummary<T>(key: string, load: () => Promise<T>, now: () => number = Date.now): Promise<T> {
  const entry = entries.get(key)
  const age = entry ? now() - entry.at : Infinity
  if (entry && age < FRESH_MS) return entry.value as T
  if (entry && age < STALE_MS) {
    // Dietro: un errore qui non deve diventare un rifiuto non gestito.
    void refresh(key, load, now).catch((error) => console.error('[summary-cache] ricalcolo non riuscito', error))
    return entry.value as T
  }
  return refresh(key, load, now)
}

/** Solo per i test. */
export function clearSummaryCache() {
  entries.clear()
  inFlight.clear()
}
