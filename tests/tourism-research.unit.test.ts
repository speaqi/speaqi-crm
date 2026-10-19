import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  analyseTourismHtml,
  crawlTourismSite,
  publicAddress,
  robotsPolicy,
  type ResearchFetch
} from '../src/lib/server/tourism-site-crawler'
import {
  estimateCrawlCost,
  inventoryChanges,
  type SiteReport
} from '../src/lib/tourism-research'
import { poiGeoJson } from '../src/lib/server/tourism-research'
import { runTourismResearchTick } from '../src/lib/server/tourism-research-scheduler'

const html =
  '<html lang="it"><title>Official tourism guide</title><body><a href="/pois/tutti">Punti di interesse</a><a href="/restaurants">Ristoranti</a></body></html>'
const fake =
  (
    pages: Record<
      string,
      string | { status: number; location?: string; text?: string }
    >,
    calls: string[]
  ): ResearchFetch =>
  async (url) => {
    calls.push(url)
    const p = pages[url]
    if (typeof p === 'string')
      return { status: 200, text: p, bytes: p.length, headers: {} }
    return {
      status: p?.status || 404,
      text: p?.text || '',
      bytes: p?.text?.length || 0,
      headers: { location: p?.location }
    }
  }

test('robots uses the most specific agent and longest rule, including wildcard and terminal match', () => {
  const p = robotsPolicy(
    'User-agent: *\nDisallow: /\nUser-agent: SpeaqiTourismResearch\nDisallow: /private*\nAllow: /private/public$\nCrawl-delay: 3\nSitemap: https://example.com/sitemap.xml\nSitemap: https://other.com/map.xml',
    'https://example.com/'
  )
  assert.equal(p.allowed('https://example.com/home'), true)
  assert.equal(p.allowed('https://example.com/private/a'), false)
  assert.equal(p.allowed('https://example.com/private/public'), true)
  assert.equal(p.allowed('https://example.com/private/public/more'), false)
  assert.equal(p.delayMs, 3000)
  assert.deepEqual(p.sitemaps, ['https://example.com/sitemap.xml'])
})
test('crawler stops before HTML when robots forbids access or is unavailable', async () => {
  for (const robots of ['User-agent: *\nDisallow: /', { status: 503 }]) {
    const calls: string[] = []
    const r = await crawlTourismSite('https://example.com/', {
      fetch: fake({ 'https://example.com/robots.txt': robots }, calls),
      pause: async () => {}
    })
    assert.equal(r.state, 'blocked')
    assert.deepEqual(calls, ['https://example.com/robots.txt'])
    assert.equal(r.candidates.length, 0)
  }
})
test('bounded crawl follows newly discovered detail links without escaping the site or claiming completeness', async () => {
  const calls: string[] = []
  const detail =
    '<title>Museum</title><script type="application/ld+json">' +
    JSON.stringify({
      '@type': 'Museum',
      name: 'Museo centrale',
      geo: { latitude: 40.8, longitude: 14.2 }
    }) +
    '</script>'
  const pages = {
    'https://example.com/robots.txt': 'User-agent: *\nDisallow: /private',
    'https://example.com/': html + 'friendlycaptcha.eu',
    'https://example.com/sitemap.xml': { status: 404 },
    'https://example.com/pois/tutti':
      '<a href="/poi/museum">Museum</a><a href="https://other.com/poi/x">Outside</a><a href="/private/museum">Museum private</a>',
    'https://example.com/restaurants': '<title>Restaurants</title>',
    'https://example.com/poi/museum': detail
  }
  const r = await crawlTourismSite('https://example.com/', {
    maxRequests: 8,
    fetch: fake(pages, calls),
    pause: async () => {}
  })
  assert.equal(r.candidates.length, 1)
  assert.equal(r.geocoded_candidates, 1)
  assert.equal(r.sample_limited, true)
  assert.ok(
    !calls.some((u) => u.includes('other.com') || u.includes('/private/'))
  )
  assert.ok(r.errors.some((e) => e.message === 'HTTP 404'))
  assert.ok(r.requests <= 8)
})
test('public-only URLs and DNS exclude local, reserved and mapped private addresses', async () => {
  for (const address of [
    '127.0.0.1',
    '10.1.2.3',
    '169.254.169.254',
    '172.16.0.1',
    '192.168.1.1',
    '100.64.0.1',
    '198.18.0.1',
    '::1',
    '::ffff:127.0.0.1',
    'fc00::1',
    'fe80::1',
    '2001:db8::1'
  ])
    assert.equal(publicAddress(address), false, address)
  assert.equal(publicAddress('8.8.8.8'), true)
  assert.equal(publicAddress('2606:4700:4700::1111'), true)
  for (const url of [
    'http://127.0.0.1/',
    'file:///etc/passwd',
    'https://example.com:22/'
  ])
    await assert.rejects(() => crawlTourismSite(url), /Public URL/)
})
test('structured places preserve valid zero coordinates and ignore people, organizations and invalid geo', () => {
  const page = analyseTourismHtml(
    '<script type="application/ld+json">' +
      JSON.stringify({
        '@graph': [
          { '@type': 'Person', name: 'Private person' },
          { '@type': 'Organization', name: 'Board' },
          {
            '@type': 'Restaurant',
            name: 'Equator',
            geo: { latitude: 0, longitude: 0 }
          },
          {
            '@type': 'Museum',
            name: 'Bad geo',
            geo: { latitude: 1000, longitude: 14 }
          },
          { '@type': 'ItemList', name: 'Current list', numberOfItems: 123 }
        ]
      }) +
      '</script>',
    'https://example.com/poi/one'
  )
  assert.equal(page.candidates.length, 2)
  assert.equal(page.candidates[0].latitude, 0)
  assert.equal(page.candidates[1].latitude, null)
  assert.equal(page.declared[0].count, 123)
})
test('Napoli adapter extracts only literal coordinates on identified municipal POI pages', () => {
  const content =
    '<title>Galleria Umberto I - NapoliForMe</title><div id="map"></div><script>var lat = 40.8384537; var lon = 14.2494956;</script>'
  const p = analyseTourismHtml(
    content,
    'https://napoliforme.comune.napoli.it/pois/-/poi/Galleria-Umberto-I'
  )
  assert.equal(p.candidates[0].name, 'Galleria Umberto I')
  assert.equal(p.candidates[0].evidence_kind, 'html')
  assert.equal(
    analyseTourismHtml(
      content,
      'https://example.com/pois/-/poi/Galleria-Umberto-I'
    ).candidates.length,
    0
  )
})
test('sample changes never report unobserved places as deleted and exports require approved reuse', () => {
  const a = {
    sample_limited: true,
    candidates: [{ name: 'Museum', source_url: 'https://example.com/poi/1' }]
  } as SiteReport
  const b = { sample_limited: true, candidates: [] } as unknown as SiteReport
  assert.deepEqual(inventoryChanges(a, b), {
    baseline: false,
    added: 0,
    not_observed_again: 1,
    removed: null,
    comparable: false
  })
  const p = {
    name: 'Museum',
    source_url: 'https://example.com/poi/1',
    latitude: 40,
    longitude: 14,
    category: 'place',
    reuse_url: 'https://example.com/license'
  }
  const output = poiGeoJson([
    { ...p, state: 'candidate', reuse_status: 'open' },
    { ...p, state: 'approved', reuse_status: 'unknown' },
    { ...p, state: 'approved', reuse_status: 'authorized' }
  ])
  assert.equal(output.features.length, 1)
})
test('cost scenarios expose assumptions and apply changes, browser and AI independently', () => {
  const base = estimateCrawlCost(100, 1000),
    delta = estimateCrawlCost(100, 1000, 0, 0, 0.1),
    browser = estimateCrawlCost(100, 1000, 1),
    ai = estimateCrawlCost(100, 1000, 0, 1)
  assert.equal(base.requests, 100000)
  assert.equal(delta.requests, 10000)
  assert.equal(delta.low_eur, base.low_eur / 10)
  assert.ok(browser.high_eur > base.high_eur)
  assert.ok(ai.high_eur > base.high_eur)
  assert.equal(
    base.assumptions.kind,
    'planning_assumptions_not_supplier_quotes'
  )
  assert.throws(() => estimateCrawlCost(1, 1, 2), /Quota/)
})

test('the queue worker does not scan when no enabled source is due or another replica reserved the minute', async () => {
  for (const due of [false, true]) {
    let inserts = 0
    const chain: any = {}
    for (const method of ['select', 'eq', 'lte', 'or', 'neq', 'order', 'limit'])
      chain[method] = () => chain
    chain.maybeSingle = async () => ({
      data: due ? { id: 'source', user_id: 'owner' } : null,
      error: null
    })
    const sb: any = {
      from: (name: string) => {
        if (name === 'tourism_site_work_queue') return chain
        assert.equal(name, 'automation_job_runs')
        return {
          insert: async () => {
            inserts++
            return { error: { code: '23505' } }
          }
        }
      },
      rpc: () => {
        throw new Error('No crawl may be claimed')
      }
    }
    assert.deepEqual(
      await runTourismResearchTick(sb, new Date('2026-10-18T10:30:00Z')),
      { skipped: true }
    )
    assert.equal(inserts, due ? 1 : 0)
  }
})

test('Vienna map attributes produce sourced candidates without evaluating scripts', () => {
  const attribute = JSON.stringify({
    location: {
      contentType: 'WTVLocation',
      title: 'Albertina',
      lat: '48.20459',
      long: '16.36837',
      category: 'Museums',
      address: 'Albertinaplatz 1',
      myviennalink: '/en/albertina-131590'
    }
  })
  const p = analyseTourismHtml(
    `<span data-location='${attribute}'></span>`,
    'https://www.wien.info/en/article'
  )
  assert.equal(p.candidates.length, 1)
  assert.equal(
    p.candidates[0].source_url,
    'https://www.wien.info/en/albertina-131590'
  )
  assert.equal(p.candidates[0].latitude, 48.20459)
})

test('sitemap indexes and observed venue pages qualify a destination without asserting full site coverage', async () => {
  const calls: string[] = []
  const pages = {
    'https://example.com/robots.txt':
      'User-agent: *\nSitemap: https://example.com/sitemap.xml',
    'https://example.com/':
      '<title>Official tourism board</title><a href="/restaurants">Restaurants</a>',
    'https://example.com/sitemap.xml':
      '<sitemapindex><sitemap><loc>https://example.com/places.xml</loc></sitemap></sitemapindex>',
    'https://example.com/places.xml':
      '<sm:urlset xmlns:sm="https://www.sitemaps.org/schemas/sitemap/0.9"><sm:url><sm:loc>https://example.com/restaurants</sm:loc></sm:url></sm:urlset>',
    'https://example.com/restaurants':
      '<script type="application/ld+json">{"@type":"Restaurant","name":"Public cafe","geo":{"latitude":40,"longitude":14}}</script>'
  }
  const report = await crawlTourismSite('https://example.com/', {
    maxRequests: 10,
    fetch: fake(pages, calls),
    pause: async () => {}
  })
  assert.equal(report.sitemap?.status, 'found')
  assert.equal(report.sitemap?.documents.length, 2)
  assert.equal(report.sitemap?.enumeration_complete, true)
  assert.equal(report.sitemap?.all_site_pages_confirmed, false)
  assert.equal(report.target_check?.classification, 'destination_likely')
})

test('a commercial incoming agency is not promoted to destination because restaurant pages exist', async () => {
  const calls: string[] = []
  const pages = {
    'https://example.com/robots.txt': 'User-agent: *',
    'https://example.com/':
      '<title>Incoming tour operator</title><a href="/restaurants/food-tour">Restaurants tour</a>',
    'https://example.com/sitemap.xml':
      '<urlset><url><loc>https://example.com/restaurants/food-tour</loc></url></urlset>',
    'https://example.com/restaurants/food-tour':
      '<h1>Food tour booking</h1><p>Discover bars and restaurants on our tour.</p>'
  }
  const report = await crawlTourismSite('https://example.com/', {
    maxRequests: 10,
    fetch: fake(pages, calls),
    pause: async () => {}
  })
  assert.equal(report.target_check?.classification, 'incoming_likely')
  assert.equal(report.candidates.length, 0)
})

test('budget-limited XML enumeration remains partial and blocked access is never treated as no sitemap', async () => {
  const calls: string[] = []
  const pages = {
    'https://example.com/robots.txt': 'User-agent: *',
    'https://example.com/': '<title>Tourism</title>',
    'https://example.com/sitemap.xml':
      '<sitemapindex><sitemap><loc>https://example.com/a.xml</loc></sitemap><sitemap><loc>https://example.com/b.xml</loc></sitemap></sitemapindex>'
  }
  const report = await crawlTourismSite('https://example.com/', {
    maxRequests: 3,
    fetch: fake(pages, calls),
    pause: async () => {}
  })
  assert.equal(report.sitemap?.enumeration_complete, false)
  assert.equal(report.sitemap?.pending_documents, 2)
  const blocked = await crawlTourismSite('https://blocked.example/', {
    fetch: fake({}, []),
    pause: async () => {}
  })
  assert.equal(blocked.sitemap?.status, 'unavailable')
})
