/**
 * Agente 05 — Pulizia del database. Logica pura: dai gruppi di chiavi uguali
 * (email, telefono, azienda + città) ai gruppi di doppioni, con il contatto da
 * tenere e il motivo. Le chiavi le calcola il database (`office_cleaner_*`),
 * così i 60 mila contatti non passano mai dalla memoria del server.
 */

export type DuplicateKeyRow = { kind: 'email' | 'phone' | 'company'; key: string; ids: string[] }

export type CleanerContact = {
  id: string; name: string | null; email: string | null; phone: string | null; company: string | null
  billing_city: string | null; status: string | null; contact_scope: string | null; created_at: string
  activities: number; tasks: number; deals: number; open_deals: number; quotes: number; drafts: number; emails: number
  in_sequence: boolean
}

export type DuplicateGroup = {
  keep: string
  drop: string[]
  /** Su cosa coincidono: email e telefono sono prove forti, azienda + città no. */
  matched: Array<DuplicateKeyRow['kind']>
  /** Basta un contatto in pipeline per chiedere uno sguardo umano gruppo per gruppo. */
  risk: 'safe' | 'review'
  blocked: string | null
  reason: string
  contacts: CleanerContact[]
}

const CLOSED = new Set(['closed', 'paid', 'lost', 'not_interested'])

/** Union-find: due contatti che condividono anche una sola chiave stanno nello stesso gruppo. */
export function connectDuplicates(rows: DuplicateKeyRow[]) {
  const parent = new Map<string, string>()
  const find = (x: string): string => {
    let root = x
    while (parent.get(root) !== root) root = parent.get(root)!
    let cur = x
    while (parent.get(cur) !== root) { const next = parent.get(cur)!; parent.set(cur, root); cur = next }
    return root
  }
  const kinds = new Map<string, Set<DuplicateKeyRow['kind']>>()
  for (const row of rows) {
    const ids = [...new Set(row.ids)]
    if (ids.length < 2) continue
    for (const id of ids) if (!parent.has(id)) parent.set(id, id)
    for (const id of ids.slice(1)) {
      const a = find(ids[0]); const b = find(id)
      if (a !== b) parent.set(b, a)
    }
    for (const id of ids) {
      const set = kinds.get(id) || new Set()
      set.add(row.kind); kinds.set(id, set)
    }
  }
  const groups = new Map<string, string[]>()
  for (const id of parent.keys()) {
    const root = find(id)
    groups.set(root, [...(groups.get(root) || []), id])
  }
  return [...groups.values()].filter((ids) => ids.length > 1).map((ids) => {
    const matched = new Set<DuplicateKeyRow['kind']>()
    for (const row of rows) if (row.ids.filter((id) => ids.includes(id)).length > 1) matched.add(row.kind)
    return { ids: ids.sort(), matched: [...matched].sort() as Array<DuplicateKeyRow['kind']> }
  })
}

/** Quanta storia porta un contatto: si tiene quello che perderebbe di più. */
export function contactWeight(c: CleanerContact) {
  return c.deals * 50 + c.quotes * 50 + c.emails * 5 + c.activities * 3 + c.drafts * 2 + c.tasks
    + (c.contact_scope === 'crm' ? 20 : 0) + (c.status && c.status.toLowerCase() !== 'new' ? 10 : 0)
}

export function chooseKeeper(contacts: CleanerContact[]) {
  return [...contacts].sort((a, b) => contactWeight(b) - contactWeight(a)
    || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))[0]
}

export function planDuplicateGroup(ids: string[], matched: Array<DuplicateKeyRow['kind']>, byId: Map<string, CleanerContact>): DuplicateGroup | null {
  const contacts = ids.map((id) => byId.get(id)).filter((c): c is CleanerContact => Boolean(c))
  if (contacts.length < 2) return null
  const keeper = chooseKeeper(contacts)
  const drop = contacts.filter((c) => c.id !== keeper.id).map((c) => c.id).sort()
  const openDeals = contacts.reduce((sum, c) => sum + c.open_deals, 0)
  const blocked = contacts.some((c) => c.in_sequence)
    ? 'Uno dei contatti è dentro una sequenza email in corso: si unisce a mano quando la sequenza finisce.'
    : openDeals > 1 ? `Ci sono ${openDeals} trattative aperte: va chiusa a mano quella in più prima di unire.`
    : contacts.length > 20 ? 'Gruppo troppo grande per un\'unione automatica.' : null
  const strong = matched.includes('email') || matched.includes('phone')
  const inPipeline = contacts.some((c) => c.contact_scope === 'crm' || (c.status && !['new', ...CLOSED].includes(c.status.toLowerCase())))
  const risk: DuplicateGroup['risk'] = strong && !inPipeline && contacts.every((c) => c.deals + c.quotes === 0) ? 'safe' : 'review'
  const reason = [
    matched.includes('email') ? 'stessa email' : null,
    matched.includes('phone') ? 'stesso telefono' : null,
    matched.includes('company') ? 'stessa azienda e città' : null,
  ].filter(Boolean).join(', ')
  return {
    keep: keeper.id, drop, matched, risk, blocked,
    reason: `${reason}. Si tiene «${keeper.company || keeper.name || keeper.id}» perché ha più storia (${keeper.activities} attività, ${keeper.deals} trattative, ${keeper.quotes} preventivi)${strong ? '' : '; email e telefono non coincidono: controllare che sia davvero la stessa persona'}.`,
    contacts,
  }
}

/** Lotti da proporre: i gruppi sicuri a venti per volta, gli altri uno per uno. */
export function batchGroups(groups: DuplicateGroup[], options: { safeBatch?: number; maxSafeBatches?: number; maxReview?: number } = {}) {
  const safeBatch = options.safeBatch ?? 20
  const usable = groups.filter((g) => !g.blocked)
  const safe = usable.filter((g) => g.risk === 'safe')
  const review = usable.filter((g) => g.risk === 'review').slice(0, options.maxReview ?? 20)
  const batches: DuplicateGroup[][] = []
  for (let i = 0; i < safe.length && batches.length < (options.maxSafeBatches ?? 10); i += safeBatch) batches.push(safe.slice(i, i + safeBatch))
  return { batches, review, blocked: groups.filter((g) => g.blocked) }
}

/** Chiave stabile di un gruppo: stessa composizione, stessa proposta, anche fra corse. */
export function groupKey(group: Pick<DuplicateGroup, 'keep' | 'drop'>) {
  return [group.keep, ...group.drop].sort().join('+')
}
