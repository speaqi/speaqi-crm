import { officeIsNaples } from './director'

export type OfficeMapQueue = { key: string; slug: string; city: string; source?: string }
export function officeMapQueue(value: unknown): OfficeMapQueue[] {
  if (!Array.isArray(value)) throw new Error('La coda mappe deve essere una lista')
  const seen = new Set<string>()
  return value.map((item): OfficeMapQueue => {
    const row = typeof item === 'string' ? { slug:item,city:item } : item
    if (!row || typeof row !== 'object') throw new Error('Voce mappa non valida')
    const slug = row.slug || row.map_slug || (typeof row.city === 'string' ? row.city.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') : '')
    const city = row.city || slug
    if (typeof slug !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,99}$/.test(slug) || typeof city !== 'string' || !city.trim()) {
      throw new Error('Indicare slug della mappa e città nella coda approvata')
    }
    if (officeIsNaples(slug,city)) throw new Error('Napoli non modificabile')
    if (row.source !== undefined && (typeof row.source !== 'string' || row.source.length > 2000)) throw new Error('Fonte My Maps non valida')
    return { key:typeof row.key === 'string' ? row.key : slug,slug,city:city.trim(),...(row.source ? {source:row.source} : {}) }
  }).filter((row) => { if (seen.has(row.slug)) return false; seen.add(row.slug); return true })
}

/** Parità dei giorni reali: il cambio di mese non accorcia la cadenza a un giorno. */
export function officeMapSlot(date: Date) {
  const day = new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit'}).format(date)
  return Math.floor(Date.parse(`${day}T00:00:00Z`) / 86400_000 / 2)
}
