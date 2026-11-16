import { NextRequest } from 'next/server'
import { requireRouteUser } from '@/lib/server/supabase'
import industries from '@/lib/leadocean-industries.json'

export const dynamic = 'force-dynamic'

// The API key is server-only. Restrict access because searches spend account records.
async function authorize(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if (auth.error) return { error: auth.error }
  if (!auth.isAdmin || auth.user.id !== '212e3b5a-f099-4b40-9ace-b6c25f1db562') return { error: Response.json({ error: 'Accesso riservato agli amministratori.' }, { status: 403 }) }
  return { auth }
}

export async function GET(request: NextRequest) {
  const { error } = await authorize(request)
  if (error) return error
  return Response.json({ configured: Boolean(process.env.LEADOCEAN_API_KEY) }, { headers: { 'Cache-Control': 'no-store' } })
}

type SearchRequest = { kind?: unknown; action?: unknown; query?: unknown; country?: unknown; industry?: unknown; title?: unknown; domain?: unknown; cursor?: unknown }
const str = (value: unknown, max = 160) => typeof value === 'string' ? value.trim().slice(0, max) : ''

export async function POST(request: NextRequest) {
  const { error } = await authorize(request)
  if (error) return error
  const key = process.env.LEADOCEAN_API_KEY
  if (!key) return Response.json({ error: 'La chiave API LeadOcean non è configurata sul server del CRM.' }, { status: 503 })
  let body: SearchRequest
  try { body = await request.json() } catch { return Response.json({ error: 'Richiesta non valida.' }, { status: 400 }) }
  if (!body || !['companies', 'people'].includes(String(body.kind)) || !['count', 'search'].includes(String(body.action))) {
    return Response.json({ error: 'Tipo di ricerca non valido.' }, { status: 400 })
  }
  const kind = body.kind === 'people' ? 'people' : 'companies'
  const countOnly = body.action === 'count'
  const query = str(body.query)
  const country = str(body.country, 2).toUpperCase()
  const industry = str(body.industry)
  const title = str(body.title)
  const domain = str(body.domain)
  const cursor = countOnly ? '' : str(body.cursor, 4096)
  if (industry && !industries.includes(industry)) return Response.json({ error: 'Seleziona un settore tra quelli suggeriti.' }, { status: 400 })
  if (country && !/^[A-Z]{2}$/.test(country)) return Response.json({ error: 'Usa un codice paese di due lettere, per esempio IT.' }, { status: 400 })
  if (domain && !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) return Response.json({ error: 'Inserisci un dominio valido, per esempio azienda.com.' }, { status: 400 })
  const filters: Record<string, unknown> = {}
  if (query) filters[kind === 'companies' ? 'keywords' : 'q'] = kind === 'companies' ? [query] : query
  if (country) filters[kind === 'companies' ? 'hqCountry' : 'country'] = [country]
  if (industry) filters.industry = [industry]
  if (kind === 'people' && title) filters.title = [title]
  if (domain) filters.domain = [domain]
  if (cursor) filters.cursor = cursor
  if (kind === 'people' && countOnly) { filters.count = true; filters.limit = 1 }
  else if (!countOnly) { filters.limit = 25; filters.slim = true }
  const path = kind === 'companies' && countOnly ? '/v1/companies/count' : `/v1/${kind}/search`
  let upstream: Response
  try {
    upstream = await fetch(`https://api.leadocean.io${path}`, { method: 'POST', headers: { 'x-api-key': key, 'content-type': 'application/json' }, body: JSON.stringify(filters), cache: 'no-store', signal: AbortSignal.timeout(30000) })
  } catch { return Response.json({ error: 'LeadOcean non è raggiungibile. Riprova tra poco.' }, { status: 502 }) }
  const json = await upstream.json().catch(() => null)
  if (!upstream.ok || !json || json.success === false) {
    const message = upstream.status === 401 || upstream.status === 403 ? 'La chiave LeadOcean non è valida o non consente la ricerca.' : upstream.status === 429 ? 'Limite temporaneo di LeadOcean raggiunto. Riprova più tardi.' : upstream.status === 402 ? 'Le unità disponibili su LeadOcean sono esaurite.' : 'LeadOcean non ha potuto completare la ricerca. Controlla i filtri e riprova.'
    return Response.json({ error: message }, { status: upstream.status >= 400 && upstream.status < 500 ? upstream.status : 502 })
  }
  const data = json.data ?? json
  const meta = json.meta ?? data.meta ?? {}
  if (countOnly) return Response.json({ total: data.total ?? meta.total ?? null, unsupportedFilters: meta.unsupportedFilters ?? data.unsupportedFilters ?? [] })
  const rows = Array.isArray(data) ? data : Array.isArray(data.items) ? data.items : Array.isArray(data.results) ? data.results : Array.isArray(json.items) ? json.items : []
  // Only return the thin fields needed by the interface; never expose contact enrichment.
  const items = rows.map((row: any) => {
    if (kind === 'companies') {
      const c = row.company_data || {}
      return { name: c.company_name || '', domain: c.company_domain || '', description: c.company_description || '', industry: c.company_industries?.[0]?.name3 || '', city: c.company_primary_address?.city || '', country: c.company_primary_address?.country_code || '', employees: c.company_employees?.number_of_employees ?? null, linkedin: c.company_social_links?.linkedin?.url || '' }
    }
    const p = row.profile_data || {}, contact = row.contact_data || {}, job = contact.contact_current_experiences?.[0] || {}
    return { name: p.profile_full_name || '', headline: p.profile_headline || '', city: p.profile_address?.city || '', country: p.profile_address?.country_code || '', linkedin: p.profile_url || '', company: job.company_name || '', domain: job.company_domain || '', title: job.job_title || '', industry: job.company_industry || '', hasEmail: Boolean(contact.has_email), emailStatus: contact.email_status || '' }
  })
  return Response.json({ items, total: meta.total ?? null, nextCursor: meta.nextCursor ?? null, depthCapped: Boolean(meta.depthCapped), unsupportedFilters: meta.unsupportedFilters ?? [], notice: meta.notice ?? null }, { headers: { 'Cache-Control': 'no-store' } })
}
