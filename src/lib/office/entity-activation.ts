/**
 * Attivare un ente quando il titolare chiede la sua presentazione. Logica pura:
 * da dove prendere il sito, quale risultato della ricerca è il sito ufficiale,
 * quale città racconta l'ente. Il modello cerca, il codice decide.
 */
import { nameKey } from './entity-enricher'

/** Siti che parlano di tutti e non sono di nessuno: mai il sito ufficiale di un ente. */
const NOT_OFFICIAL = /(^|\.)(facebook|instagram|linkedin|youtube|twitter|x|tiktok|wikipedia|wikidata|tripadvisor|booking|expedia|google|bing|yelp|pinterest|trustpilot|paginegialle|paginebianche|virgilio|lonelyplanet|getyourguide|viator|airbnb|amazon|medium|wordpress|blogspot)\.[a-z.]+$/i

function originOf(raw: string): string | null {
  const text = raw.trim().replace(/[),.;:!?»"']+$/, '')
  if (!text || /@/.test(text)) return null
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`)
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(url.hostname) || NOT_OFFICIAL.test(url.hostname)) return null
    return `https://${url.hostname.toLowerCase()}`
  } catch { return null }
}

/** Il sito scritto nell'ordine («…, sito visitbergamo.net»), se c'è. Le email non sono siti. */
export function websiteFromText(text: string): string | null {
  const clean = text.replace(/\S+@\S+/g, ' ')
  for (const match of clean.matchAll(/\b(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:\/[^\s]*)?/gi)) {
    const origin = originOf(match[0])
    if (origin) return origin
  }
  return null
}

/** I siti da provare, in ordine: quello scritto dal modello, poi le pagine che ha citato. Massimo tre. */
export function siteCandidates(answer: string, citations: string[]): string[] {
  const out: string[] = []
  for (const raw of [...(answer.match(/https?:\/\/[^\s)\]>"']+/gi) || []), websiteFromText(answer) || '', ...citations]) {
    const origin = raw ? originOf(raw) : null
    if (origin && !out.includes(origin)) out.push(origin)
    if (out.length >= 3) break
  }
  return out
}

const GENERIC = new Set(['visit', 'turismo', 'tourism', 'tourisme', 'turisme', 'ente', 'del', 'della', 'di', 'de', 'du', 'la', 'le', 'il', 'the', 'of',
  'office', 'ufficio', 'comune', 'citta', 'city', 'apt', 'agenzia', 'agency', 'convention', 'bureau', 'cvb', 'dmo', 'promozione', 'turistica', 'turistico',
  'consorzio', 'fondazione', 'foundation', 'board', 'and', 'e', 'y', 'et', 'per'])

/** Le parole che distinguono l'ente («VISIT BERGAMO» → bergamo). */
export function distinctiveWords(name: string): string[] {
  return nameKey(name).split(' ').filter((w) => w.length >= 3 && !GENERIC.has(w))
}

/** Il sito è dell'ente se nomina tutte le sue parole distintive (nel testo o nell'indirizzo). */
export function siteMatchesEntity(site: string, text: string, entityName: string): boolean {
  const words = distinctiveWords(entityName)
  if (!words.length) return false
  const haystack = ` ${nameKey(text)} ${nameKey(new URL(site).hostname.replace(/\./g, ' '))} `
  const host = new URL(site).hostname.toLowerCase()
  return words.every((w) => haystack.includes(` ${w} `) || host.includes(w))
}

const PREFIX = /^(visit|turismo|tourism|ente del turismo di|ente turismo|comune di|citta di|apt|ufficio turistico di|ufficio del turismo di|office de tourisme de|office de tourisme d|turismo de|turisme de|consorzio turistico)\s+/

/**
 * La città della presentazione: quella detta dal titolare o letta dal modello, se
 * la si ritrova nel nome dell'ente o nell'ordine; altrimenti il nome dell'ente senza
 * «Visit», «Comune di»… Niente città indovinata: senza, la si chiede.
 */
export function cityForEntity(input: { proposed: string | null; entityName: string; aliases?: string[] | null; orderText: string }): string | null {
  const proposed = input.proposed?.trim()
  if (proposed && proposed.length <= 80) {
    const key = nameKey(proposed)
    const pool = ` ${[input.entityName, ...(input.aliases || []), input.orderText].map(nameKey).join(' ')} `
    if (key.length >= 3 && pool.includes(` ${key} `)) return proposed
  }
  for (const name of [input.entityName, ...(input.aliases || [])]) {
    const key = nameKey(name)
    const rest = key.replace(PREFIX, '')
    if (rest !== key && rest.split(' ').length <= 3 && rest.length >= 3) {
      return rest.split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    }
  }
  return null
}

const CRM_ERRORS: Array<[RegExp, string]> = [
  [/Ambiguous CRM match/i, 'nel CRM ci sono più contatti con lo stesso nome: collegalo tu dalla scheda dell’ente'],
  [/Possible CRM matches require review/i, 'c’è un possibile doppione nel CRM: confermalo dalla scheda dell’ente'],
  [/country mismatch/i, 'nel CRM c’è un contatto con lo stesso nome ma un altro paese: controllalo dalla scheda'],
  [/Email already used/i, 'l’email è già di un altro contatto del CRM'],
  [/already linked to another CRM contact/i, 'l’ente è già collegato a un altro contatto del CRM: controllalo dalla scheda'],
]

/** Il motivo per cui l'ente non è entrato nei contatti, in italiano. */
export function crmErrorText(error: string | null | undefined): string | null {
  if (!error) return null
  return CRM_ERRORS.find(([pattern]) => pattern.test(error))?.[1] || `il CRM ha risposto: ${error}`
}

/** Il nome senza spazi né segni: «Visit Bergamo» e «VisitBergamo» sono lo stesso ente. */
export const compactName = (name: string) =>
  name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '')

/** Ricerca nel catalogo con le parole in ordine e qualunque cosa in mezzo: trova anche il nome scritto attaccato. */
export function entitySearchPattern(name: string): string | null {
  const words = name.replace(/[%_,()*\\]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 8)
  return words.join(' ').length >= 2 ? `%${words.join('%')}%` : null
}

type CandidateEntity = { name: string; aliases?: string[] | null; status: string; disabled?: boolean | null }

/**
 * L'ente nominato in un ordine, fra quelli trovati nel catalogo. Archiviati e doppioni non
 * contano. Vale il nome (o un alias) uguale a quello scritto, spazi a parte; fra più enti con
 * quel nome vince l'unico verificato. Se resta un dubbio, nessuno: meglio chiedere che sbagliare ente.
 */
export function pickOrderEntity<T extends CandidateEntity>(rows: T[], name: string): T | null {
  const live = rows.filter((row) => !row.disabled && row.status !== 'INACTIVE' && row.status !== 'DUPLICATE')
  const wanted = compactName(name)
  const exact = live.filter((row) => [row.name, ...(row.aliases || [])].some((n) => compactName(n) === wanted))
  const pool = exact.length ? exact : live
  if (pool.length === 1) return pool[0]
  const verified = pool.filter((row) => row.status === 'VERIFIED')
  return exact.length && verified.length === 1 ? verified[0] : null
}
