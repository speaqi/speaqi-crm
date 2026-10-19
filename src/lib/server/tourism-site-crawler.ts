import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { Agent, ProxyAgent, request, type Dispatcher } from 'undici'
import { load } from 'cheerio'
import { safePublicUrl } from '../tourism'
import type { PoiCandidate, SiteReport } from '../tourism-research'
import {
  siteRoleSignals,
  qualifyTourismSite
} from '../tourism-site-qualification'

export const CRAWLER_AGENT = 'SpeaqiTourismResearch/1.0 (+https://speaqi.com)'
const MAX_BYTES = 3_000_000
const POI_TYPES =
  /^(TouristAttraction|Museum|LandmarksOrHistoricalBuildings|Park|Church|PlaceOfWorship|ArtGallery|Restaurant|CafeOrCoffeeShop|Winery|Zoo|Beach|HistoricalPlace|CivicStructure|Place)$/i
const RESTAURANT =
  /ristoran|restaurant|restaurantes|ristorazione|gastronom|where.to.eat|dove.mangiare|essen.trinken|food.drink|caf[eé]s?|(?:^|[\s/\-_])bars?(?:$|[\s/\-_])/i
const PLACES =
  /attrazion|attraction|luoghi|places|points.of.interest|punti.di.interesse|sightseeing|sights|sehensw|muse[ou]|monument|cosa.vedere|things.to.do|visitare|patrimon|poi\//i
const SKIP =
  /\.(?:pdf|jpe?g|png|webp|svg|zip|mp[34]|css|js|woff2?)(?:$|\?)|\/login|\/cart|\/account|\/privacy|\/cookie|\/search(?:\/|\?)/i

export function publicAddress(address: string) {
  const ip = address.toLowerCase()
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number)
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0)) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19))
    )
  }
  // Global unicast only; mapped IPv4, loopback, link-local and ULA are excluded.
  return isIP(ip) === 6 && /^[23]/.test(ip) && !ip.startsWith('2001:db8:')
}
function researchUrl(input: string, base?: string) {
  try {
    const u = new URL(input, base)
    if (!safePublicUrl(u.href) || (u.port && !['80', '443'].includes(u.port)))
      return null
    u.hash = ''
    for (const k of [...u.searchParams.keys()])
      if (/^(utm_|fbclid|gclid|ref$)/i.test(k)) u.searchParams.delete(k)
    return u.href
  } catch {
    return null
  }
}
const sameSite = (a: string, b: string) =>
  new URL(a).hostname.replace(/^www\./, '') ===
  new URL(b).hostname.replace(/^www\./, '')

export type RobotsPolicy = {
  allowed: (url: string) => boolean
  delayMs: number
  sitemaps: string[]
}
export function robotsPolicy(text: string, base: string): RobotsPolicy {
  const groups: {
    agents: string[]
    rules: { allow: boolean; value: string }[]
    delay: number
  }[] = []
  const sitemaps: string[] = []
  let group: (typeof groups)[number] | null = null,
    inRules = false
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim(),
      i = line.indexOf(':')
    if (i < 0) continue
    const field = line.slice(0, i).toLowerCase(),
      value = line.slice(i + 1).trim()
    if (field === 'sitemap') {
      const url = researchUrl(value, base)
      if (url && sameSite(url, base)) sitemaps.push(url)
      continue
    }
    if (field === 'user-agent') {
      if (!group || inRules) {
        group = { agents: [], rules: [], delay: 1 }
        groups.push(group)
        inRules = false
      }
      group.agents.push(value.toLowerCase())
      continue
    }
    if (!group) continue
    if (field === 'allow' || field === 'disallow') {
      inRules = true
      if (value) group.rules.push({ allow: field === 'allow', value })
    }
    if (field === 'crawl-delay') {
      inRules = true
      const delay = Number(value)
      if (Number.isFinite(delay) && delay >= 0) group.delay = Math.max(1, delay)
    }
  }
  const specific = groups.filter((g) =>
    g.agents.some((a) => a !== '*' && 'speaqitourismresearch'.includes(a))
  )
  const matched = specific.length
    ? specific
    : groups.filter((g) => g.agents.includes('*'))
  const rules = matched.flatMap((g) => g.rules)
  return {
    sitemaps: [...new Set(sitemaps)],
    delayMs: Math.max(1000, ...matched.map((g) => g.delay * 1000)),
    allowed(url) {
      const u = new URL(url),
        path = u.pathname + u.search
      let best = -1,
        allow = true
      for (const rule of rules) {
        const escaped = rule.value
          .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '.*')
          .replace(/\\\$$/, '$')
        if (new RegExp('^' + escaped).test(path)) {
          const length = rule.value.replace(/[*$]/g, '').length
          if (length > best || (length === best && rule.allow)) {
            best = length
            allow = rule.allow
          }
        }
      }
      return allow
    }
  }
}

function category(text: string) {
  return RESTAURANT.test(text)
    ? 'restaurant'
    : PLACES.test(text)
      ? 'place'
      : null
}
export function analyseTourismHtml(html: string, pageUrl: string) {
  const $ = load(html),
    candidates: PoiCandidate[] = [],
    declared: SiteReport['declared_lists'] = []
  const links: SiteReport['catalogue_pages'] = []
  const title = $('title').first().text().trim().slice(0, 300)
  const roleText = [
    title,
    $('meta[name="description"]').attr('content') || '',
    $('h1').first().text(),
    $('main p,article p').slice(0, 5).text()
  ]
    .join(' ')
    .replace(/\s+/g, ' ')
    .slice(0, 6000)
  const role = siteRoleSignals(roleText)
  const languages = new Set<string>()
  const lang = $('html').attr('lang')
  if (lang) languages.add(lang.slice(0, 20))
  $('link[hreflang],a[hreflang]').each((_, el) => {
    const l = $(el).attr('hreflang')
    if (l && l !== 'x-default') languages.add(l.slice(0, 20))
  })
  $('a[href]').each((_, el) => {
    const label = $(el).text().replace(/\s+/g, ' ').trim().slice(0, 150),
      url = researchUrl($(el).attr('href') || '', pageUrl)
    if (!url || !sameSite(url, pageUrl) || SKIP.test(url)) return
    const c = category(url + ' ' + label)
    if (c) links.push({ url, label, category: c })
  })
  let visited = 0
  const walk = (value: unknown) => {
    if (++visited > 15000 || !value || typeof value !== 'object') return
    if (Array.isArray(value)) {
      for (const v of value.slice(0, 3000)) walk(v)
      return
    }
    const row = value as Record<string, any>
    const types = (
      Array.isArray(row['@type']) ? row['@type'] : [row['@type']]
    ).map(String)
    if (
      types.includes('ItemList') &&
      Number.isInteger(Number(row.numberOfItems)) &&
      Number(row.numberOfItems) >= 0
    )
      declared.push({
        url: pageUrl,
        count: Number(row.numberOfItems),
        label: String(row.name || title).slice(0, 200)
      })
    if (types.some((t) => POI_TYPES.test(t)) && typeof row.name === 'string') {
      const geo = row.geo || row.location?.geo || {},
        lat = Number(geo.latitude),
        lon = Number(geo.longitude)
      const validGeo =
        geo.latitude !== undefined &&
        geo.longitude !== undefined &&
        Number.isFinite(lat) &&
        Number.isFinite(lon) &&
        Math.abs(lat) <= 90 &&
        Math.abs(lon) <= 180
      const address =
        typeof row.address === 'string'
          ? row.address
          : row.address && typeof row.address === 'object'
            ? [
                'streetAddress',
                'postalCode',
                'addressLocality',
                'addressCountry'
              ]
                .map((k) =>
                  typeof row.address[k] === 'string' ? row.address[k] : ''
                )
                .filter(Boolean)
                .join(', ')
            : null
      const ownUrl = researchUrl(
        typeof row.url === 'string' ? row.url : '',
        pageUrl
      )
      candidates.push({
        name: row.name.trim().slice(0, 200),
        source_url: ownUrl && sameSite(ownUrl, pageUrl) ? ownUrl : pageUrl,
        category: types.some((t) => /Restaurant|Cafe|Winery/.test(t))
          ? 'restaurant'
          : 'place',
        latitude: validGeo ? lat : null,
        longitude: validGeo ? lon : null,
        address: address?.slice(0, 500) || null,
        evidence_kind: 'jsonld'
      })
    }
    for (const v of Object.values(row)) if (typeof v === 'object') walk(v)
  }
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      walk(JSON.parse($(el).html() || ''))
    } catch {}
  })
  $('[itemscope][itemtype]').each((_, el) => {
    const node = $(el),
      type = (node.attr('itemtype') || '').split('/').pop() || ''
    if (!POI_TYPES.test(type)) return
    const value = (key: string) => {
      const field = node.find(`[itemprop="${key}"]`).first()
      return field.attr('content') || field.text().trim()
    }
    const name = value('name'),
      latitude = value('latitude'),
      longitude = value('longitude')
    if (!name) return
    const valid =
      latitude !== '' &&
      longitude !== '' &&
      Number.isFinite(Number(latitude)) &&
      Number.isFinite(Number(longitude)) &&
      Math.abs(Number(latitude)) <= 90 &&
      Math.abs(Number(longitude)) <= 180
    candidates.push({
      source_url: pageUrl,
      name: name.slice(0, 200),
      category: /Restaurant|Cafe|Winery/.test(type) ? 'restaurant' : 'place',
      latitude: valid ? Number(latitude) : null,
      longitude: valid ? Number(longitude) : null,
      address: value('address').slice(0, 500) || null,
      evidence_kind: 'html'
    })
  })
  // Vienna publishes its map records directly as JSON attributes in the public HTML.
  if (new URL(pageUrl).hostname.replace(/^www\./, '') === 'wien.info')
    $('[data-location]').each((_, el) => {
      try {
        const data = JSON.parse($(el).attr('data-location') || '{}'),
          locations = Array.isArray(data.locations)
            ? data.locations
            : [data.location]
        for (const location of locations) {
          if (
            !location ||
            location.contentType !== 'WTVLocation' ||
            typeof location.title !== 'string'
          )
            continue
          const lat = Number(location.lat),
            lon = Number(location.long)
          if (
            location.lat == null ||
            location.long == null ||
            !Number.isFinite(lat) ||
            !Number.isFinite(lon) ||
            Math.abs(lat) > 90 ||
            Math.abs(lon) > 180
          )
            continue
          const canonical =
            typeof location.myviennalink === 'string'
              ? researchUrl(location.myviennalink, pageUrl)
              : null
          candidates.push({
            source_url:
              canonical && sameSite(canonical, pageUrl) ? canonical : pageUrl,
            name: location.title.trim().slice(0, 200),
            category: RESTAURANT.test(
              String(location.category) + ' ' + String(location.class)
            )
              ? 'restaurant'
              : 'place',
            latitude: lat,
            longitude: lon,
            address:
              typeof location.address === 'string'
                ? location.address.slice(0, 500)
                : null,
            evidence_kind: 'html'
          })
        }
      } catch {}
    })
  // Explicit adapter for the municipality's public POI pages. Never evaluate site JavaScript.
  if (
    new URL(pageUrl).hostname === 'napoliforme.comune.napoli.it' &&
    new URL(pageUrl).pathname.includes('/pois/-/poi/') &&
    $('#map').length
  ) {
    const scripts = $('script')
      .map((_, el) => $(el).html() || '')
      .get()
      .join('\n')
    const lat = scripts.match(/\bvar\s+lat\s*=\s*(-?\d+(?:\.\d+)?)\s*;/),
      lon = scripts.match(/\bvar\s+lon\s*=\s*(-?\d+(?:\.\d+)?)\s*;/)
    const name = title.replace(/\s*-\s*NapoliForMe\s*$/i, '').trim()
    if (
      name &&
      name !== title &&
      lat &&
      lon &&
      Math.abs(Number(lat[1])) <= 90 &&
      Math.abs(Number(lon[1])) <= 180
    )
      candidates.push({
        source_url: pageUrl,
        name,
        category: 'place',
        latitude: Number(lat[1]),
        longitude: Number(lon[1]),
        address: null,
        evidence_kind: 'html'
      })
  }
  $('script,style,noscript').remove()
  const text = $('body').text().replace(/\s+/g, ' ').slice(0, 120000)
  const signals: string[] = []
  if (
    /official.{0,50}(touris|travel|destination)|sito.{0,30}ufficiale|portale.{0,40}turis|offiziell.{0,40}touris|site.{0,30}officiel/i.test(
      text + ' ' + title
    )
  )
    signals.push(
      'Il sito dichiara un ruolo turistico ufficiale; identità da confermare'
    )
  if (links.some((l) => l.category === 'place'))
    signals.push('Sezione dedicata a luoghi o attrazioni')
  if (links.some((l) => l.category === 'restaurant'))
    signals.push('Sezione dedicata a ristorazione o gastronomia')
  if (candidates.length) signals.push('Schede di luoghi con dati strutturati')
  return {
    role,
    title,
    languages: [...languages].sort(),
    links: [...new Map(links.map((l) => [l.url, l])).values()],
    candidates,
    declared,
    signals,
    map: /maps\.google|google\.com\/maps|openstreetmap|mapbox|leaflet|data-latitude|geoCoordinates/i.test(
      html
    )
  }
}

/** Private-address validation also runs in the connection's lookup callback, preventing DNS rebinding. */
const directAgent = new Agent({
  connect: {
    lookup(hostname, options, callback) {
      lookup(hostname, { all: true })
        .then((addresses) => {
          if (
            !addresses.length ||
            addresses.some((a) => !publicAddress(a.address))
          )
            return callback(new Error('Private network denied'), '', 4)
          if (options.all) (callback as any)(null, addresses)
          else callback(null, addresses[0].address, addresses[0].family)
        })
        .catch((error) => callback(error, '', 4))
    }
  }
})
let proxyAgent: Dispatcher | undefined
export type ResearchFetch = (url: string) => Promise<{
  status: number
  text: string
  bytes: number
  headers: Record<string, string | string[] | undefined>
}>
export const fetchResearchPage: ResearchFetch = async (url) => {
  if (!researchUrl(url)) throw new Error('Public URL required')
  const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY
  // The managed sidecar resolves and authorizes remote hosts; its executor has no public DNS.
  // Outside that runtime, pin public DNS in directAgent as well as checking it here.
  if (!proxy || new URL(proxy).hostname !== 'proxy') {
    const addresses = await lookup(new URL(url).hostname, { all: true })
    if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
      throw new Error('Private network denied')
  }
  if (proxy && !proxyAgent) proxyAgent = new ProxyAgent(proxy)
  const response = await request(url, {
    dispatcher: proxy ? proxyAgent : directAgent,
    method: 'GET',
    maxRedirections: 0,
    headersTimeout: 8000,
    bodyTimeout: 8000,
    signal: AbortSignal.timeout(10000),
    headers: {
      'user-agent': CRAWLER_AGENT,
      accept:
        'text/html,application/xhtml+xml,application/xml,text/xml,text/plain;q=0.8',
      'accept-encoding': 'identity'
    }
  })
  let bytes = 0
  const chunks: Buffer[] = []
  try {
    for await (const chunk of response.body) {
      bytes += chunk.length
      if (bytes > MAX_BYTES) throw new Error('Page exceeds 3 MB limit')
      chunks.push(Buffer.from(chunk))
    }
  } catch (error) {
    response.body.destroy()
    throw error
  }
  const encoding = String(
    response.headers['content-encoding'] || ''
  ).toLowerCase()
  const raw = Buffer.concat(chunks)
  if (encoding && !['identity', 'gzip'].includes(encoding))
    throw new Error('Unsupported compressed response')
  const content =
    encoding === 'gzip' || (raw[0] === 0x1f && raw[1] === 0x8b)
      ? gunzipSync(raw, { maxOutputLength: MAX_BYTES })
      : raw
  return {
    status: response.statusCode,
    text: content.toString('utf8'),
    bytes,
    headers: response.headers
  }
}

export async function crawlTourismSite(
  input: string,
  options: {
    maxRequests?: number
    fetch?: ResearchFetch
    pause?: (ms: number) => Promise<void>
    deadlineMs?: number
  } = {}
): Promise<SiteReport> {
  const start = Date.now(),
    site = researchUrl(input)
  if (!site) throw new Error('Public URL required')
  const max = Math.max(3, Math.min(40, options.maxRequests || 15)),
    deadline = Math.min(240000, options.deadlineMs || 90000)
  const fetcher = options.fetch || fetchResearchPage,
    pause =
      options.pause ||
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  const report: SiteReport = {
    schema_version: 1,
    site_url: site,
    fetched_at: new Date().toISOString(),
    state: 'partial',
    title: '',
    destination_signals: [],
    languages: [],
    map_detected: false,
    catalogue_pages: [],
    sitemap_urls_seen: 0,
    place_url_candidates: 0,
    restaurant_url_candidates: 0,
    declared_lists: [],
    candidates: [],
    geocoded_candidates: 0,
    requests: 0,
    bytes: 0,
    duration_ms: 0,
    sample_limited: true,
    count_note:
      'Censimento a campione. URL candidati e schede osservate non sono il totale dei luoghi della destinazione. Lingue e categorie possono produrre URL duplicati.',
    errors: [],
    receipts: []
  }
  const incomingEvidence: { url: string; signal: string }[] = [],
    territorialEvidence: { url: string; signal: string }[] = [],
    venueEvidence: { url: string; signal: string }[] = []
  const observedVenueLinks = new Set<string>()
  let checkedPages = 0,
    sitemapTruncated = false,
    sitemapReadError = false,
    pendingMaps = 0
  const sitemapDocuments: NonNullable<SiteReport['sitemap']>['documents'] = []
  const seen = new Set<string>(),
    placeUrls = new Set<string>(),
    restaurantUrls = new Set<string>(),
    sitemapUrls = new Set<string>()
  let policy: RobotsPolicy | null = null,
    stopped = false
  const get = async (
    url: string,
    isRobots = false,
    redirects = 0
  ): Promise<{ text: string; url: string } | null> => {
    if (
      stopped ||
      report.requests >= max ||
      Date.now() - start >= deadline ||
      seen.has(url)
    )
      return null
    if (
      !sameSite(url, site) ||
      !researchUrl(url) ||
      (!isRobots && !policy?.allowed(url))
    )
      return null
    seen.add(url)
    if (report.requests && !isRobots) await pause(policy?.delayMs || 1000)
    if (Date.now() - start >= deadline) return null
    report.requests++
    try {
      const page = await fetcher(url)
      report.bytes += page.bytes
      report.receipts.push({
        url,
        status: page.status,
        bytes: page.bytes,
        hash: createHash('sha256').update(page.text).digest('hex')
      })
      if (page.status === 429 || page.status === 503) {
        stopped = true
        throw new Error(`HTTP ${page.status}: host backoff`)
      }
      if ([301, 302, 303, 307, 308].includes(page.status)) {
        const location = String(page.headers.location || ''),
          next = researchUrl(location, url)
        if (!next || !sameSite(next, site) || redirects >= 3)
          throw new Error('Redirect outside site or redirect limit')
        // Read the redirected authority's robots before any HTML (www and HTTPS may differ).
        if (!isRobots && new URL(next).origin !== new URL(url).origin)
          throw new Error('Authority changed: register canonical site URL')
        return get(next, isRobots, redirects + 1)
      }
      if (isRobots && page.status === 404) return { text: '', url }
      if (page.status < 200 || page.status >= 300)
        throw new Error(`HTTP ${page.status}`)
      if (
        !isRobots &&
        /<title[^>]*>\s*(?:just a moment|attention required)|id=["']challenge-form|cf-chl-(?:opt|widget)/i.test(
          page.text.slice(0, 30000)
        )
      )
        throw new Error('Access challenge; no bypass attempted')
      return { text: page.text, url }
    } catch (e) {
      report.errors.push({
        url,
        message: (e instanceof Error ? e.message : 'Fetch failed').slice(0, 200)
      })
      return null
    }
  }
  const finish = () => {
    report.duration_ms = Date.now() - start
    report.place_url_candidates = placeUrls.size
    report.restaurant_url_candidates = restaurantUrls.size
    report.sitemap_urls_seen = sitemapUrls.size
    report.candidates = [
      ...new Map(
        report.candidates
          .filter((p) => p.name)
          .map((p) => [p.source_url + '|' + p.name.toLowerCase(), p])
      ).values()
    ].slice(0, 1000)
    report.geocoded_candidates = report.candidates.filter(
      (p) => p.latitude !== null && p.longitude !== null
    ).length
    report.sitemap = {
      status: sitemapDocuments.length
        ? 'found'
        : report.state === 'blocked' ||
            report.errors.some((e) => e.message !== 'HTTP 404')
          ? 'unavailable'
          : 'not_found',
      documents: sitemapDocuments,
      enumeration_complete:
        sitemapDocuments.length > 0 &&
        !sitemapTruncated &&
        pendingMaps === 0 &&
        !sitemapReadError,
      all_site_pages_confirmed: false,
      pending_documents: pendingMaps,
      sampled_catalogue_links_missing: sitemapDocuments.length
        ? report.catalogue_pages.filter((l) => !sitemapUrls.has(l.url)).length
        : null
    }
    report.target_check = qualifyTourismSite({
      incoming: incomingEvidence,
      territorial: territorialEvidence,
      venues: venueEvidence,
      catalogueUrls: placeUrls.size + restaurantUrls.size,
      distinctVenues: Math.max(
        observedVenueLinks.size,
        new Set(
          report.candidates.map(
            (p) => p.name.toLowerCase() + '|' + p.latitude + '|' + p.longitude
          )
        ).size
      ),
      checkedPages
    })
    return report
  }
  const robotsUrl = new URL('/robots.txt', site).href
  const robots = await get(robotsUrl, true)
  if (!robots) {
    report.state = 'blocked'
    return finish()
  }
  policy = robotsPolicy(robots.text, site)
  if (policy.delayMs > 10000 || !policy.allowed(site)) {
    report.errors.push({
      url: robotsUrl,
      message:
        policy.delayMs > 10000
          ? 'Crawl-delay requires a slower adapter'
          : 'robots.txt disallows site'
    })
    report.state = 'blocked'
    return finish()
  }
  const home = await get(site)
  if (!home) report.state = 'blocked'
  const absorb = (text: string, url: string) => {
    const page = analyseTourismHtml(text, url)
    checkedPages++
    if (
      url === site ||
      /about|chi-siamo|company|azienda|quienes/i.test(new URL(url).pathname)
    ) {
      if (page.role.incoming)
        incomingEvidence.push({
          url,
          signal: 'Il sito si presenta come operatore o agenzia incoming / DMC'
        })
      if (page.role.territorial)
        territorialEvidence.push({
          url,
          signal:
            'Il sito si presenta come portale o ente turistico territoriale'
        })
    }
    if (page.candidates.length)
      venueEvidence.push({
        url,
        signal: `${page.candidates.length} schede di luoghi o locali osservate nella pagina`
      })
    const detailLinks = page.links.filter((l) =>
      /\/(?:pois?\/(?:-\/poi\/)?|restaurants?\/|ristoranti\/|bars?\/|cafes?\/)[^/?#]+/i.test(
        new URL(l.url).pathname
      )
    )
    if (detailLinks.length >= 3) {
      for (const l of detailLinks) observedVenueLinks.add(l.url)
      venueEvidence.push({
        url,
        signal: `Catalogo con ${detailLinks.length} collegamenti a schede di luoghi o locali`
      })
    }
    if (!report.title) report.title = page.title
    report.destination_signals = [
      ...new Set([...report.destination_signals, ...page.signals])
    ]
    report.languages = [
      ...new Set([...report.languages, ...page.languages])
    ].sort()
    report.map_detected ||= page.map
    report.catalogue_pages = [
      ...new Map(
        [...report.catalogue_pages, ...page.links].map((l) => [l.url, l])
      ).values()
    ].slice(0, 500)
    report.declared_lists.push(...page.declared)
    report.candidates.push(...page.candidates)
    for (const l of page.links)
      (l.category === 'restaurant' ? restaurantUrls : placeUrls).add(l.url)
  }
  if (home) absorb(home.text, home.url)
  const sitemapQueue = [
    ...new Set([...policy.sitemaps, new URL('/sitemap.xml', site).href])
  ]
  const requiredMaps = new Set(policy.sitemaps)
  const fallbackMaps = [
    new URL('/sitemap_index.xml', site).href,
    new URL('/wp-sitemap.xml', site).href
  ]
  let maps = 0
  const maxMaps = Math.max(1, Math.min(20, max - 6))
  while (
    (sitemapQueue.length ||
      (!sitemapDocuments.length && fallbackMaps.length)) &&
    maps < maxMaps &&
    report.requests < max &&
    !stopped
  ) {
    if (Date.now() - start >= deadline) break
    const url = sitemapQueue.shift() || fallbackMaps.shift()!
    if (seen.has(url)) continue
    maps++
    const page = await get(url)
    if (!page) {
      if (requiredMaps.has(url)) sitemapReadError = true
      continue
    }
    if (
      !/<(?:[A-Za-z_][\w.-]*:)?(?:urlset|sitemapindex)\b/i.test(page.text) ||
      /<!DOCTYPE/i.test(page.text)
    ) {
      if (requiredMaps.has(url)) sitemapReadError = true
      continue
    }
    const $ = load(page.text, { xml: true })
    const elements = $('*').toArray()
    const localName = (el: unknown) =>
      String((el as { name?: string }).name || '')
        .split(':')
        .pop()
    const index = elements.some((el) => localName(el) === 'sitemapindex')
    const locs = elements.filter((el) => localName(el) === 'loc')
    sitemapDocuments.push({
      url,
      kind: index ? 'index' : 'urlset',
      urls: locs.length
    })
    if (locs.length > 50000) sitemapTruncated = true
    for (const el of locs.slice(0, 50000)) {
      const loc = researchUrl($(el).text().trim(), url)
      if (!loc) continue
      if (!sameSite(loc, site)) {
        if (index) sitemapTruncated = true
        continue
      }
      if (index) {
        if (!seen.has(loc) && !sitemapQueue.includes(loc)) {
          if (sitemapQueue.length < 200) {
            sitemapQueue.push(loc)
            requiredMaps.add(loc)
          } else sitemapTruncated = true
        }
        continue
      }
      if (sitemapUrls.size >= 100000) {
        sitemapTruncated = true
        break
      }
      sitemapUrls.add(loc)
      if (SKIP.test(loc)) continue
      const c = category(loc)
      if (c === 'restaurant') restaurantUrls.add(loc)
      if (c === 'place') placeUrls.add(loc)
    }
  }
  pendingMaps = sitemapQueue.filter((u) => !seen.has(u)).length
  const homeDom = load(home?.text || '')
  const about = homeDom('a[href]')
    .toArray()
    .map((el) => researchUrl(homeDom(el).attr('href') || '', site))
    .find(
      (u) =>
        u &&
        sameSite(u, site) &&
        /about-us|chi-siamo|about\/?$|company|quienes-somos/i.test(
          new URL(u).pathname
        )
    )
  const queue = [
    ...new Set([
      ...(about ? [about] : []),
      ...[...restaurantUrls].slice(0, 2),
      ...report.catalogue_pages.map((p) => p.url),
      ...restaurantUrls,
      ...placeUrls
    ])
  ]
  for (let i = 0; i < queue.length && report.requests < max && !stopped; i++) {
    if (Date.now() - start >= deadline) break
    const page = await get(queue[i])
    if (page) {
      absorb(page.text, page.url)
      for (const link of report.catalogue_pages)
        if (!queue.includes(link.url) && queue.length < 1500)
          queue.push(link.url)
    }
  }
  report.state =
    !home && !sitemapDocuments.length
      ? 'blocked'
      : report.errors.length || pendingMaps || sitemapTruncated
        ? 'partial'
        : 'completed'
  // Even a completed technical run is a bounded inventory, not a certified complete catalogue.
  return finish()
}
