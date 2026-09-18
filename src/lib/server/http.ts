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
 * Legge righe per un elenco di id, un blocco alla volta e paginando ogni
 * blocco.
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
 *
 * Un blocco di soli 200 id non basta da solo: PostgREST tronca ogni singola
 * risposta a `db-max-rows` righe (1000 di default) senza segnalarlo, quindi
 * un blocco di contatti con più di mille task storici (idempotency key
 * comprese) restituiva solo le prime mille, silenziosamente. La riga
 * mancante è proprio quella che serve per non reinserire un task già
 * esistente: `existingIdempotencyKeys` risultava incompleto, il duplicato
 * passava il filtro e l'insert falliva con `23505` — un round di debug in
 * produzione il 18 settembre 2026 ha confermato che l'insieme, letto più
 * tardi nella stessa richiesta, conteneva sì la chiave (perché nel frattempo
 * il codice l'aveva aggiunta lui stesso), rendendo la diagnosi contraddittoria
 * finché non si è vista la funzione paginare un solo blocco. Ogni blocco ora
 * si legge pagina per pagina finché una pagina torna più corta di
 * `pageSize`.
 */
export async function selectByIdChunks<T>(
  ids: string[],
  size: number,
  run: (group: string[], range: { from: number; to: number }) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize = 1000
) {
  const rows: T[] = []
  for (const group of chunk(ids, size)) {
    let from = 0
    for (;;) {
      const { data, error } = await run(group, { from, to: from + pageSize - 1 })
      if (error) throw error
      const page = (data || []) as T[]
      rows.push(...page)
      if (page.length < pageSize) break
      from += pageSize
    }
  }
  return rows
}
