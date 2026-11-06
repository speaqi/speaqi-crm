/**
 * Scansione di UN sito per trovarne le email d'ufficio.
 *
 * Educata per costruzione: user agent dichiarato (quello della ricerca Tourism), `robots.txt` letto
 * e rispettato, una richiesta alla volta per sito con almeno la pausa che il sito chiede, redirect
 * seguiti a mano e ricontrollati, solo indirizzi pubblici. Un 401/403/429 è un no: non si riprova e
 * non si passa da un'altra strada. Il giudizio sulle email sta in `tourism-contact-emails.ts`.
 */
import { safePublicUrl } from '@/lib/tourism'
import {
  GUESSED_CONTACT_PATHS, contactPageCandidates, extractEmails, pageLinks, pickBestEmail, registrableDomain,
  type FoundEmail, type Rejected
} from '@/lib/tourism-contact-emails'
import { fetchResearchPage, robotsPolicy, type ResearchFetch, type RobotsPolicy } from './tourism-site-crawler'

export type ScanStatus = 'found' | 'review_only' | 'none' | 'blocked' | 'error'

export type ScanResult = {
  status: ScanStatus
  best: FoundEmail | null
  alternatives: FoundEmail[]
  pages: string[]
  requests: number
  rejected: Record<Rejected, number>
  finalUrl?: string
  error?: string
}

export type HostGate = (host: string, delayMs: number) => Promise<void>

export type ScanOptions = {
  fetchPage?: ResearchFetch
  gate?: HostGate
  /** Pagine di contatti da leggere oltre alla home. */
  maxContactPages?: number
  minDelayMs?: number
}

const REDIRECT_HOPS = 4
const MAX_ROBOTS_DELAY_MS = 20_000

/** Una pausa per sito, anche con molti siti in parallelo: la coda è per host, non globale. */
export function createHostGate(sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)), now: () => number = Date.now): HostGate {
  const chains = new Map<string, Promise<void>>()
  const last = new Map<string, number>()
  return (host, delayMs) => {
    const run = (chains.get(host) || Promise.resolve()).then(async () => {
      // La prima richiesta a un sito parte subito: la pausa serve fra una richiesta e la successiva.
      const previous = last.get(host)
      const wait = previous === undefined ? 0 : previous + delayMs - now()
      if (wait > 0) await sleep(wait)
      last.set(host, now())
    })
    chains.set(host, run.catch(() => undefined))
    return run
  }
}

/** Un rifiuto da rispettare (robots, 401/403/429): non si riprova. */
class Refused extends Error {
  constructor(message: string, readonly hard = true) { super(message) }
}

const emptyRejected = (): Record<Rejected, number> => ({ junk: 0, pec: 0, foreign: 0, personal: 0 })
const allowAll: RobotsPolicy = { allowed: () => true, delayMs: 1000, sitemaps: [] }

export async function scanSiteForEmails(website: string, options: ScanOptions = {}): Promise<ScanResult> {
  const fetchPage = options.fetchPage || fetchResearchPage
  const gate = options.gate || createHostGate()
  const minDelay = options.minDelayMs ?? 1500
  const maxContactPages = options.maxContactPages ?? 3
  const robots = new Map<string, RobotsPolicy>()
  const state = { requests: 0 }
  const pages: string[] = []
  const rejected = emptyRejected()
  const candidates: FoundEmail[] = []

  const fetchFollowing = async (input: string, skipRobots = false) => {
    let current = input
    for (let hop = 0; hop <= REDIRECT_HOPS; hop++) {
      const url = safePublicUrl(current)
      if (!url) throw new Error('Indirizzo non valido')
      const origin = new URL(url).origin
      let policy = allowAll
      if (!skipRobots) {
        policy = await robotsFor(origin)
        if (!policy.allowed(url)) throw new Refused('Escluso da robots.txt', false)
      }
      await gate(new URL(url).hostname, Math.min(Math.max(policy.delayMs, minDelay), MAX_ROBOTS_DELAY_MS))
      state.requests++
      const page = await fetchPage(url)
      if (page.status >= 300 && page.status < 400) {
        const location = String(page.headers.location || '')
        if (!location) throw new Error(`Redirect senza destinazione (${page.status})`)
        current = new URL(location, url).href
        continue
      }
      if ([401, 403, 429].includes(page.status)) throw new Refused(`Il sito rifiuta i robot (HTTP ${page.status})`)
      return { url, status: page.status, text: page.text, type: String(page.headers['content-type'] || '') }
    }
    throw new Error('Troppi redirect')
  }

  const robotsFor = async (origin: string) => {
    const known = robots.get(origin)
    if (known) return known
    const response = await fetchFollowing(`${origin}/robots.txt`, true).catch((error) => {
      if (error instanceof Refused) throw new Refused(`robots.txt non consente di verificare l'accesso: ${error.message}`)
      throw error
    })
    if (response.status >= 500) throw new Refused(`robots.txt non consente di verificare l'accesso (HTTP ${response.status})`)
    const policy = response.status === 200 ? robotsPolicy(response.text, origin) : allowAll
    robots.set(origin, policy)
    return policy
  }

  const readPage = (page: { url: string; status: number; text: string; type: string }, siteDomains: string[]) => {
    if (page.status !== 200 || (page.type && !/text\/|xml|json/i.test(page.type))) return null
    pages.push(page.url)
    const { found, rejected: r } = extractEmails(page.text, page.url, siteDomains)
    candidates.push(...found)
    for (const key of Object.keys(r) as Rejected[]) rejected[key] += r[key]
    return page
  }

  const finish = (status: ScanStatus, extra: Partial<ScanResult> = {}): ScanResult => {
    const { best, alternatives } = pickBestEmail(candidates)
    const resolved: ScanStatus = status === 'found' || status === 'review_only' || status === 'none'
      ? (best ? (best.class === 'role' ? 'found' : 'review_only') : 'none') : status
    return { status: resolved, best, alternatives, pages, requests: state.requests, rejected, ...extra }
  }

  const start = safePublicUrl(/^https?:\/\//i.test(website.trim()) ? website.trim() : `https://${website.trim()}`)
  if (!start) return finish('error', { error: 'Sito non valido' })

  let home
  try {
    home = await fetchFollowing(start).catch(async (error) => {
      // Molti siti piccoli hanno solo http o un certificato scaduto: un secondo tentativo, senza forzare altro.
      if (error instanceof Refused || !start.startsWith('https://')) throw error
      return fetchFollowing(start.replace(/^https:/, 'http:'))
    })
  } catch (error) {
    return finish(error instanceof Refused ? 'blocked' : 'error', { error: (error as Error).message })
  }
  if (home.status >= 400) return finish('error', { error: `Il sito risponde ${home.status}`, finalUrl: home.url })

  const siteDomains = [...new Set([registrableDomain(new URL(start).hostname), registrableDomain(new URL(home.url).hostname)])]
  readPage(home, siteDomains)
  const enough = () => pickBestEmail(candidates).best?.class === 'role' && pickBestEmail(candidates).best?.domainMatch

  if (!enough() && home.status === 200) {
    const tried = new Set([home.url])
    const queue = contactPageCandidates(home.url, pageLinks(home.text), maxContactPages)
    let read = 0
    for (const url of queue) {
      if (enough() || read >= maxContactPages) break
      tried.add(url)
      try { if (readPage(await fetchFollowing(url), siteDomains)) read++ } catch (error) { if (error instanceof Refused && error.hard) break }
    }
    // Nessun collegamento trovato (menu in JavaScript, per esempio): si provano i percorsi di sempre.
    if (!read && !enough()) {
      for (const path of GUESSED_CONTACT_PATHS) {
        if (enough() || read >= 2) break
        const url = new URL(path, home.url).href
        if (tried.has(url)) continue
        tried.add(url)
        try { if (readPage(await fetchFollowing(url), siteDomains)) read++ } catch (error) { if (error instanceof Refused && error.hard) break }
      }
    }
  }
  return finish('none', { finalUrl: home.url })
}
