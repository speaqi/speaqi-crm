export function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message || fallback)
  }
  return fallback
}

export function parseLimit(value: string | null, fallback = 50, max = 200) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(1, Math.min(max, Math.round(parsed)))
}

/** Divide un array in blocchi di dimensione fissa, l'ultimo eventualmente più corto. */
export function chunk<T>(items: T[], size: number) {
  const out: T[][] = []
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size))
  return out
}

/**
 * Legge righe per un elenco di id, un blocco alla volta.
 *
 * Un `.in('col', ids)` con centinaia o migliaia di id mette tutti gli UUID
 * nella query string della richiesta: il gateway davanti a Supabase ha un
 * limite di lunghezza URL, e oltre quel limite risponde con un generico
 * `400 {"message":"Bad Request"}` prima ancora che PostgREST veda la
 * richiesta — così è successo il 18 settembre 2026 su
 * `/api/automation/followups`, con 1.285 contatti nella pipeline attiva
 * dentro un solo `.in()`: la rotta falliva a ogni esecuzione, in silenzio,
 * finché il log dell'errore non l'ha reso visibile. A pagine il costo di
 * lettura resta lo stesso, solo distribuito su più richieste piccole.
 */
export async function selectByIdChunks<T>(
  ids: string[],
  size: number,
  run: (group: string[]) => PromiseLike<{ data: T[] | null; error: unknown }>
) {
  const rows: T[] = []
  for (const group of chunk(ids, size)) {
    const { data, error } = await run(group)
    if (error) throw error
    rows.push(...((data || []) as T[]))
  }
  return rows
}
