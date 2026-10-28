/**
 * Cosa scrivere dopo aver riletto aperture e click di una campagna Acumbamail.
 *
 * Il giro rilegge ogni mezz'ora gli stessi apritori: scrivere comunque ogni
 * riga voleva dire ~150 mila UPDATE su `contacts` senza che cambiasse niente,
 * ognuno da riscrivere su una trentina di indici. Qui si decide se c'e'
 * davvero qualcosa di nuovo; quando non c'e', non si scrive.
 */

export type EngagementEvent = { count?: number | null; lastAt?: string | null; name?: string | null }

export type EngagementRow = {
  email: string
  name: string | null
  open_count: number
  click_count: number
  last_open_at: string | null
}

export type ContactEngagement = {
  email_open_count?: number | null
  email_click_count?: number | null
  last_email_open_at?: string | null
  last_email_click_at?: string | null
}

const count = (value: unknown) => Math.max(0, Number(value || 0) || 0)
const sameTime = (a: string | null | undefined, b: string | null | undefined) => {
  if (!a || !b) return (a || null) === (b || null)
  const ta = Date.parse(a)
  const tb = Date.parse(b)
  return Number.isFinite(ta) && Number.isFinite(tb) ? ta === tb : a === b
}

export function engagementRow(email: string, open?: EngagementEvent, click?: EngagementEvent): EngagementRow {
  return {
    email,
    name: open?.name || click?.name || null,
    open_count: count(open?.count),
    click_count: count(click?.count),
    last_open_at: open?.lastAt || null,
  }
}

/** La riga della campagna va riscritta solo se e' nuova o se un valore e' cambiato. */
export function engagementRowChanged(existing: Partial<EngagementRow> | undefined, next: EngagementRow) {
  if (!existing) return true
  return count(existing.open_count) !== next.open_count
    || count(existing.click_count) !== next.click_count
    || (existing.name || null) !== next.name
    || !sameTime(existing.last_open_at, next.last_open_at)
}

/**
 * I contatori del contatto non scendono mai (il webhook della lista puo' averli
 * gia' portati piu' in alto) e una data gia' scritta non si cancella perche'
 * questa campagna non la riporta. `null` = niente da scrivere.
 */
export function contactEngagementPatch(contact: ContactEngagement, open?: EngagementEvent, click?: EngagementEvent) {
  const previousOpens = count(contact.email_open_count)
  const previousClicks = count(contact.email_click_count)
  const nextOpens = Math.max(previousOpens, count(open?.count))
  const nextClicks = Math.max(previousClicks, count(click?.count))
  const lastOpen = open?.lastAt || contact.last_email_open_at || null
  const lastClick = click?.lastAt || contact.last_email_click_at || null
  const changed = nextOpens !== previousOpens
    || nextClicks !== previousClicks
    || !sameTime(lastOpen, contact.last_email_open_at)
    || !sameTime(lastClick, contact.last_email_click_at)
  return {
    newOpens: nextOpens - previousOpens,
    newClicks: nextClicks - previousClicks,
    patch: changed
      ? { email_open_count: nextOpens, email_click_count: nextClicks, last_email_open_at: lastOpen, last_email_click_at: lastClick }
      : null,
  }
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}
