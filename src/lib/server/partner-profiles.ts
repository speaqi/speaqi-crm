// Profili dei partner (agente Distribuzione): calcolo dai dati del catalogo, lettura del sito
// solo dove serve, righe pronte per la selezione dei contatti.

import { BudgetExceeded, callModel, type AgentContext } from './office-agents'
import { errorMessage } from './http'
import { fetchResearchPage, type ResearchFetch } from './tourism-site-crawler'
import { readEntitySite } from './office-agents/entity-enricher'
import { isCompanyMailbox } from '../office/entity-enricher'
import {
  SITE_SCHEMA, guidesOf, profilePartner, sitePrompt, tierOfValue, validateSiteReading,
  type ModelSiteReading, type PartnerProfile,
} from '../office/partner-profile'
import type { DistributionRow } from '../office/distribution-outreach'

type Admin = any
const PAGE = 1000
/** I profili si ricalcolano una volta al giorno: i dati del catalogo cambiano con gli import. */
export const PROFILE_REFRESH_HOURS = 20
export const DEFAULT_SITE_READS = 20
export const MAX_SITE_READS = 60

function checked<T>(result: { data: T; error: unknown }): T {
  if (result.error) throw result.error
  return result.data
}

type EntityRow = { id: string; name: string; type_code: string | null; country_code: string | null; email: string | null; website: string | null; details: Record<string, any> | null; disabled: boolean | null }
type StoredProfile = PartnerProfile & { entity_id: string; guide_slugs: string[]; site_read_at: string | null; site_quotes: Array<{ quote: string; url: string }> | null; site_email: string | null }

/** Gli enti italiani da profilare: tutti tranne le strutture ricettive (per ora fuori, decisione del titolare). */
async function loadEntities(admin: Admin, userId: string) {
  const rows: EntityRow[] = []
  for (let from = 0; from < 50_000; from += PAGE) {
    const page = checked(await admin.from('tourism_entities').select('id,name,type_code,country_code,email,website,details,disabled')
      .eq('user_id', userId).eq('country_code', 'IT').or('type_code.is.null,type_code.neq.accommodation')
      .order('id').range(from, from + PAGE - 1)) as EntityRow[]
    rows.push(...(page || []).filter((r) => !r.disabled))
    if (!page || page.length < PAGE) break
  }
  return rows
}

async function loadStored(admin: Admin, userId: string) {
  const map = new Map<string, StoredProfile>()
  for (let from = 0; from < 50_000; from += PAGE) {
    const page = checked(await admin.from('partner_profiles').select('*').eq('user_id', userId).order('entity_id').range(from, from + PAGE - 1)) as StoredProfile[]
    for (const row of page || []) map.set(row.entity_id, row)
    if (!page || page.length < PAGE) break
  }
  return map
}

function profileOf(entity: EntityRow, stored?: StoredProfile | null, site?: { text: string; email: string | null } | null) {
  const d = entity.details || {}
  const siteText = site?.text ?? (stored?.site_quotes || []).map((q) => q.quote).join('\n')
  const email = entity.email || site?.email || stored?.site_email || null
  return profilePartner({ name: entity.name, type_code: entity.type_code, description: typeof d.description === 'string' ? d.description : null,
    industries: d.industries, employees: typeof d.employees === 'string' ? d.employees : null, hq_city: typeof d.hq_city === 'string' ? d.hq_city : null,
    email, website: entity.website, site_text: siteText || null, site_read: Boolean(site || stored?.site_read_at) })
}

const rowOf = (userId: string, entityId: string, p: PartnerProfile, now: string) => ({
  user_id: userId, entity_id: entityId, activities: p.activities, audience: p.audience, places: p.places, guide_slugs: guidesOf(p),
  national: p.national, offers: p.offers, value: p.value, next: p.next, why: p.why, thin: p.thin, computed_at: now,
})

/** Ricalcola tutti i profili (gratis: niente rete, niente modello). Salta se è già stato fatto di recente. */
export async function refreshPartnerProfiles(admin: Admin, userId: string, options: { now?: Date; force?: boolean } = {}) {
  const now = options.now || new Date()
  if (!options.force) {
    const latest = checked(await admin.from('partner_profiles').select('computed_at').eq('user_id', userId).order('computed_at', { ascending: false }).limit(1)) as Array<{ computed_at: string }>
    if (latest?.[0] && now.getTime() - Date.parse(latest[0].computed_at) < PROFILE_REFRESH_HOURS * 3600_000) return { refreshed: false, profiles: 0 }
  }
  const [entities, stored] = await Promise.all([loadEntities(admin, userId), loadStored(admin, userId)])
  const at = now.toISOString()
  const rows = entities.map((e) => rowOf(userId, e.id, profileOf(e, stored.get(e.id)), at))
  for (let i = 0; i < rows.length; i += 500) {
    checked(await admin.from('partner_profiles').upsert(rows.slice(i, i + 500), { onConflict: 'user_id,entity_id' }))
  }
  return { refreshed: true, profiles: rows.length }
}

/**
 * Legge il sito solo dove serve: prima chi ha la guida online ma non l'email, poi chi ha dati
 * troppo scarni, dal valore più alto. Una volta per ente; quello che si trova resta nel profilo.
 */
export async function readPartnerSites(admin: Admin, ctx: AgentContext, options: { limit?: number; fetchPage?: ResearchFetch; model?: typeof callModel; now?: Date } = {}) {
  const userId = ctx.agent.user_id
  const limit = Math.max(0, Math.min(MAX_SITE_READS, Math.floor(options.limit ?? DEFAULT_SITE_READS)))
  if (!limit) return { read: 0, found: 0, emails: 0, errors: 0 }
  const model = typeof ctx.agent.settings?.model === 'string' ? String(ctx.agent.settings.model) : ctx.agent.model
  const queue: Array<{ entity_id: string; next: string }> = []
  for (const next of ['find_email', 'read_site']) {
    if (queue.length >= limit) break
    const rows = checked(await admin.from('partner_profiles').select('entity_id,next').eq('user_id', userId).eq('next', next)
      .is('site_read_at', null).order('value', { ascending: false }).limit(limit - queue.length)) as Array<{ entity_id: string; next: string }>
    queue.push(...(rows || []))
  }
  let read = 0, found = 0, emails = 0, errors = 0
  for (const item of queue) {
    const entity = checked(await admin.from('tourism_entities').select('id,name,type_code,country_code,email,website,details,disabled')
      .eq('id', item.entity_id).eq('user_id', userId).maybeSingle()) as EntityRow | null
    const at = (options.now || new Date()).toISOString()
    if (!entity?.website) {
      await admin.from('partner_profiles').update({ site_read_at: at, site_error: 'Nessun sito' }).eq('user_id', userId).eq('entity_id', item.entity_id)
      continue
    }
    let site: { text: string; email: string | null; quotes: Array<{ quote: string; url: string }> } | null = null
    let error: string | null = null
    try {
      const pages = await readEntitySite(entity.website, options.fetchPage || fetchResearchPage)
      const response = await (options.model || callModel)(ctx, { model, input: sitePrompt(entity.name, pages), maxOutputTokens: 900, jsonSchema: SITE_SCHEMA })
      const reading = validateSiteReading({ pages, model: JSON.parse(response.text) as ModelSiteReading, isMailbox: (e) => isCompanyMailbox(e, entity.website || '') })
      site = { text: reading.text, email: reading.email, quotes: reading.quotes }
    } catch (e) {
      if (e instanceof BudgetExceeded) throw e
      error = errorMessage(e, 'errore').slice(0, 500)
      errors++
    }
    read++
    const stored = { site_read_at: at, site_quotes: site?.quotes || [], site_email: site?.email || null, site_error: error }
    const profile = profileOf(entity, null, site ? { text: site.text, email: site.email } : { text: '', email: null })
    if (site?.quotes.length) found++
    if (site?.email && !entity.email) emails++
    checked(await admin.from('partner_profiles').update({ ...stored, ...rowOf(userId, entity.id, profile, at) }).eq('user_id', userId).eq('entity_id', entity.id))
  }
  return { read, found, emails, errors }
}

/**
 * Le righe per la selezione dell'agente: solo i profili `write` (guida online e una casella),
 * con le guide dei posti in cui lavorano. La fascia viene dal valore del profilo.
 */
export async function loadProfileRows(admin: Admin, userId: string): Promise<Array<DistributionRow & { description: string | null; guides: string[]; national: boolean; activities: string[] }>> {
  const out: Array<DistributionRow & { description: string | null; guides: string[]; national: boolean; activities: string[] }> = []
  const status = new Map<string, { status: string; quick_win: boolean }>()
  for (let from = 0; from < 50_000; from += PAGE) {
    const page = checked(await admin.from('tourism_distribution').select('entity_id,commercial_status,quick_win').eq('user_id', userId)
      .order('entity_id').range(from, from + PAGE - 1)) as Array<{ entity_id: string; commercial_status: string; quick_win: boolean }>
    for (const r of page || []) status.set(r.entity_id, { status: r.commercial_status, quick_win: Boolean(r.quick_win) })
    if (!page || page.length < PAGE) break
  }
  for (let from = 0; from < 50_000; from += PAGE) {
    const page = checked(await admin.from('partner_profiles')
      .select('entity_id,value,guide_slugs,national,activities,site_email,site_quotes,entity:tourism_entities!inner(name,type_code,country_code,website,email,disabled,details)')
      .eq('user_id', userId).eq('next', 'write').order('entity_id').range(from, from + PAGE - 1)) as any[]
    for (const row of page || []) {
      const e = row.entity
      if (!e || e.disabled) continue
      const s = status.get(row.entity_id)
      const description = [typeof e.details?.description === 'string' ? e.details.description : '', ...(row.site_quotes || []).map((q: any) => q.quote)].join('\n').trim().slice(0, 700)
      out.push({ entity_id: row.entity_id, name: e.name, type_code: e.type_code, country_code: e.country_code, website: e.website,
        email: e.email || row.site_email, score: Number(row.value) || 0, tier: tierOfValue(Number(row.value) || 0), quick_win: Boolean(s?.quick_win),
        guide_slugs: row.guide_slugs || [], commercial_status: s?.status || 'new', description: description || null,
        guides: row.guide_slugs || [], national: Boolean(row.national), activities: row.activities || [] })
    }
    if (!page || page.length < PAGE) break
  }
  return out
}

/** Quante aziende chiedono ogni destinazione che non è online (dai profili salvati). */
export async function loadDestinationDemand(admin: Admin, userId: string) {
  const { destinationDemand } = await import('../office/partner-profile')
  const rows: Array<{ places: any[]; next: string; email: string | null }> = []
  for (let from = 0; from < 50_000; from += PAGE) {
    const page = checked(await admin.from('partner_profiles').select('places,next,site_email,entity:tourism_entities!inner(email)')
      .eq('user_id', userId).in('next', ['write', 'find_email', 'read_site', 'guide_needed', 'no_contact']).order('entity_id').range(from, from + PAGE - 1)) as any[]
    for (const r of page || []) rows.push({ places: r.places || [], next: r.next, email: r.entity?.email || r.site_email || null })
    if (!page || page.length < PAGE) break
  }
  return destinationDemand(rows as any)
}
