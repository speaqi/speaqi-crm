/**
 * Lettura del sito di TTG Travel Experience (ttgexpo.it): elenco espositori e
 * pagina di dettaglio. Solo parsing puro, usato da `scripts/fetch_ttg_exhibitors.ts`.
 * Se il sito cambia struttura, si rompe qui e il test lo dice.
 */

export type TtgListItem = { name: string; position: string; profileId: string; detailPath: string }

export type TtgDetail = {
  address: string | null
  city: string | null
  country: string | null
  phone: string | null
  website: string | null
  email: string | null
  categories: string
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', egrave: 'è', eacute: 'é', agrave: 'à', ograve: 'ò', ugrave: 'ù', igrave: 'ì' }

export function decodeEntities(value: string) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (match, name) => ENTITIES[name.toLowerCase()] ?? match)
}

function text(html: string) {
  return decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}

/** Una voce di `items[].content` dell'API filterDataObjects. */
export function parseListCard(content: string): TtgListItem | null {
  const name = /card-digitalprofile-name">([^<]*)</.exec(content)?.[1]
  const link = /href="(\/[^"]*dettaglio-profilo[^"]*digitalProfileId=(\d+))"/.exec(content)
  if (!name || !link) return null
  const position = /card-digitalprofile-position">[\s\S]*?<p class="[^"]*">([^<]*)<\/p>\s*<\/div>/.exec(content)?.[1] || ''
  return { name: text(name), position: text(position), profileId: link[2], detailPath: decodeEntities(link[1]) }
}

export function splitPosition(position: string) {
  const [hall, ...rest] = position.split('/')
  return rest.length ? { hall: hall.trim(), stand: rest.join('/').trim() } : { hall: '', stand: position.trim() }
}

/** "75028 TURSI , MT - Italia" → città e paese. */
export function parseCityLine(line: string) {
  const dash = line.lastIndexOf(' - ')
  const country = dash >= 0 ? line.slice(dash + 3).trim() : ''
  const head = dash >= 0 ? line.slice(0, dash) : line
  const city = head.replace(/^\s*[\w-]*\d[\w-]*\s+/, '').split(',')[0].trim()
  return { city: city || null, country: country || null }
}

export function parseDetail(html: string): TtgDetail {
  const refs = /Riferimenti<\/p>([\s\S]*?)<\/div>/.exec(html)?.[1] || ''
  const lines = [...refs.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((m) => text(m[1])).filter(Boolean)
  const phoneLine = lines.find((line) => /^tel\.?:/i.test(line))
  const cityLine = lines.find((line) => / - [^-]+$/.test(line) && /\d/.test(line.split(' - ')[0]))
  const addressLines = lines.filter((line) => line !== phoneLine && line !== cityLine && !/^fax/i.test(line))
  const { city, country } = cityLine ? parseCityLine(cityLine) : { city: null, country: null }

  const website = /website<\/p>[\s\S]*?href="([^"]+)"/.exec(html)?.[1] || null
  const email = /mailto:([^"]+)"/.exec(html)?.[1] || null

  const block = /section-title">Categorie<\/p>([\s\S]*?)(?:<\/main>|<footer|class="section-title")/.exec(html)?.[1] || ''
  const groups = [...block.matchAll(/<p class="text-xs font-bold[^"]*">([^<]*)<\/p>([\s\S]*?)(?=<p class="text-xs font-bold|$)/g)]
  const categories = groups
    .map((group) => {
      const chips = [...group[2].matchAll(/<span class="chip[^"]*">([^<]*)<\/span>/g)].map((m) => text(m[1]))
      const title = text(group[1])
      const rest = chips.filter((chip) => chip && chip !== title)
      return rest.length ? `${title}: ${rest.join(', ')}` : title
    })
    .filter(Boolean)
    .join(' | ')

  return {
    address: addressLines.join(', ') || null,
    city,
    country,
    phone: phoneLine ? phoneLine.replace(/^tel\.?:\s*/i, '').trim() || null : null,
    website: website ? decodeEntities(website).trim() : null,
    email: email ? decodeEntities(email).trim() : null,
    categories,
  }
}
