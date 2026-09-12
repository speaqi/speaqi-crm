/**
 * Chi ha fatto cosa nel Wine Project, contato davvero.
 *
 * Le stesse liste servono alla pagina ("Chi ha reagito") e ai riquadri in cima:
 * se i due numeri si calcolano in due modi diversi, prima o poi raccontano due
 * storie diverse. PostgREST tronca a 1000 righe, quindi qui si pagina sempre.
 */

/** Il tetto oltre il quale smettiamo di raccogliere id per i gruppi calcolati. */
export const ID_SCAN_LIMIT = 5000

const PAGE_SIZE = 1000

async function collectDistinct(
  query: (from: number) => any,
  column: string,
) {
  const ids: string[] = []
  const seen = new Set<string>()
  let from = 0
  for (;;) {
    const { data, error } = await query(from)
    if (error) throw error
    for (const row of data || []) {
      const id = String(row[column] || '')
      if (!id || seen.has(id)) continue
      seen.add(id)
      ids.push(id)
    }
    if (!data || data.length < PAGE_SIZE || ids.length >= ID_SCAN_LIMIT) break
    from += PAGE_SIZE
  }
  return ids
}

/**
 * Gli id distinti dei contatti wine-project che hanno almeno un'attività di
 * quel tipo, dal più recente. Form, demo e risposte interessate sono decine,
 * non migliaia: si raccolgono per intero e si contano davvero, così il numero
 * mostrato in pagina è quello vero e non «le prime N».
 */
export async function contactIdsWithActivity(supabase: any, userId: string, type: string) {
  return collectDistinct((from: number) => supabase
    .from('activities')
    .select('contact_id, created_at, contacts!inner(event_tag)')
    .eq('user_id', userId)
    .eq('type', type)
    .eq('contacts.event_tag', 'wine-project')
    .order('created_at', { ascending: false })
    .range(from, from + PAGE_SIZE - 1), 'contact_id')
}

/** Gli id dei contatti wine-project che hanno almeno una risposta in casella. */
export async function contactIdsWithReply(supabase: any, userId: string) {
  return collectDistinct((from: number) => supabase
    .from('gmail_messages')
    .select('contact_id, sent_at, contacts!inner(event_tag)')
    .eq('user_id', userId)
    .eq('direction', 'inbound')
    .eq('contacts.event_tag', 'wine-project')
    .order('sent_at', { ascending: false, nullsFirst: false })
    .range(from, from + PAGE_SIZE - 1), 'contact_id')
}
