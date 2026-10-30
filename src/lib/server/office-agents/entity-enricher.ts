import { load } from 'cheerio'
import { safePublicUrl } from '@/lib/tourism'
import { officeRomeDay } from '@/lib/office/finance'
import {
  COMPANY_SCHEMA, COMPANY_TYPES, ENRICHMENT_SCHEMA, ENRICH_ORG_TYPES, MAX_COMPANIES_PER_RUN, MAX_ENTITIES_PER_RUN, RECHECK_DAYS, REJECTED_COOLDOWN_DAYS,
  companyCandidates, companyPrompt, contactLinks, enrichTargets, enrichmentPrompt, matchOrganization, validateCompanyEnrichment, validateEnrichment,
  type EnrichCompany, type EnrichOrg, type EnrichPage, type ModelCompanyEnrichment, type ModelEnrichment,
} from '@/lib/office/entity-enricher'
import { BudgetExceeded, callModel, type AgentHandler } from '../office-agents'
import { createServiceRoleClient } from '../supabase'
import { officeRows } from '../office-read'
import { fetchResearchPage, type ResearchFetch } from '../tourism-site-crawler'
import { addOfficeOutputOnce } from './shared'

const PAGE_TEXT_LIMIT = 9000

/** Il testo di tutta la pagina, piè di pagina compreso: i recapiti di un ente stanno quasi sempre lì. */
export function pageTextFromHtml(html: string) {
  const $ = load(html)
  $('script,style,noscript,svg,iframe,template').remove()
  $('br,p,div,li,tr,h1,h2,h3,h4,h5,h6,address,section,article,footer,header').each((_, el) => { $(el).append('\n') })
  const lines = $('body').text().split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l.length > 1)
  const links = $('a[href]').map((_, a) => ({ href: String($(a).attr('href') || ''), text: $(a).text().replace(/\s+/g, ' ').trim() })).get()
  return { text: [...new Set(lines)].join('\n').slice(0, PAGE_TEXT_LIMIT), links }
}

/** Lettura con il fetch sicuro della ricerca Tourism: solo indirizzi pubblici, redirect ricontrollati a mano. */
async function readPage(input: string, fetcher: ResearchFetch) {
  let url = safePublicUrl(/^https?:\/\//i.test(input) ? input : `https://${input}`)
  if (!url) throw new Error('Sito non valido')
  for (let hop = 0; hop < 4; hop++) {
    const page = await fetcher(url)
    if (page.status >= 300 && page.status < 400) {
      const next = safePublicUrl(new URL(String(page.headers.location || ''), url).href)
      if (!next) throw new Error('Redirect non valido')
      url = next; continue
    }
    if (page.status >= 400) throw new Error(`Il sito risponde ${page.status}`)
    return { url, ...pageTextFromHtml(page.text) }
  }
  throw new Error('Troppi redirect')
}

export async function readEntitySite(website: string, fetcher: ResearchFetch = fetchResearchPage): Promise<EnrichPage[]> {
  const home = await readPage(website, fetcher)
  const pages: EnrichPage[] = [{ url: home.url, text: home.text }]
  for (const link of contactLinks(home.url, home.links)) {
    try { const page = await readPage(link, fetcher); if (!pages.some((p) => p.url === page.url)) pages.push({ url: page.url, text: page.text }) }
    catch { /* Una pagina di contatti che non risponde non ferma l'ente: si lavora con quello che c'è. */ }
  }
  return pages
}

const daysBetween = (a: string, b: Date) => (b.getTime() - new Date(a).getTime()) / 86_400_000

export function entityEnricherHandler(admin: any, options: { now?: () => Date; fetchPage?: ResearchFetch; model?: typeof callModel } = {}): AgentHandler {
  return async (ctx) => {
    const userId = ctx.agent.user_id
    const now = options.now?.() || new Date()
    const day = officeRomeDay(now)
    const hubs = await officeRows<any>(admin, userId, 'tourism_hubs', 'id,name,destination,country,guide_status,guide_priority',
      (q) => q.in('guide_status', ['planned', 'in_progress']).in('guide_priority', [1, 2]))
    const destinationRows = await officeRows<any>(admin, userId, 'tourism_destinations', 'entity_id,guide_status,guide_priority',
      (q) => q.in('guide_status', ['planned', 'in_progress']).in('guide_priority', [1, 2]), 'entity_id')
    const places = await officeRows<any>(admin, userId, 'tourism_entities', 'id,name,country_code,aliases,disabled,status', (q) => q.eq('kind', 'place'))
    const placeById = new Map(places.map((p) => [p.id, p]))
    const destinations = destinationRows.flatMap((d) => { const p = placeById.get(d.entity_id); return p && !p.disabled ? [{ ...d, name: p.name, country_code: p.country_code, aliases: p.aliases }] : [] })
    const targets = enrichTargets({ hubs, destinations, places: places.filter((p) => !p.disabled) })

    const orgs = await officeRows<EnrichOrg>(admin, userId, 'tourism_entities', 'id,name,country_code,type_code,aliases,website,email,phone,status,disabled',
      (q) => q.eq('kind', 'organization').in('type_code', [...ENRICH_ORG_TYPES]))
    const linked = new Set((await officeRows<{ entity_id: string }>(admin, userId, 'tourism_crm_links', 'entity_id', undefined, 'entity_id')).map((l) => l.entity_id))
    const outputs = await officeRows<any>(admin, userId, 'office_agent_outputs', 'id,kind,status,target_id,decided_at,created_at,output_key,body',
      (q) => q.eq('agent_id', ctx.agent.id))
    const blocked = new Set(outputs.filter((o) => o.kind === 'proposal' && (o.status !== 'rejected' || daysBetween(o.decided_at || o.created_at, now) < REJECTED_COOLDOWN_DAYS)).map((o) => o.target_id))
    const lastChecked = new Map<string, string>()
    for (const o of outputs) if (String(o.output_key).startsWith('enricher:day:')) for (const [id, d] of Object.entries(o.body?.checked || {})) {
      if (!lastChecked.has(id) || String(d) > lastChecked.get(id)!) lastChecked.set(id, String(d))
    }

    const notFound: string[] = []; const alreadyIn: string[] = []; const lines: string[] = []
    const picked: Array<{ target: typeof targets[number]; org: EnrichOrg }> = []
    const used = new Set<string>()
    for (const target of targets) {
      if (picked.length >= MAX_ENTITIES_PER_RUN) break
      const org = matchOrganization(target, orgs)
      if (!org) { notFound.push(`${target.city} (${target.country})`); continue }
      if (used.has(org.id)) continue
      used.add(org.id)
      if (linked.has(org.id)) { alreadyIn.push(`${target.city}: ${org.name}`); continue }
      if (blocked.has(org.id)) continue
      const last = lastChecked.get(org.id)
      if (last && daysBetween(`${last}T12:00:00Z`, now) < RECHECK_DAYS) continue
      picked.push({ target, org })
    }

    const checkedToday: Record<string, string> = {}
    let proposals = 0; let stoppedForBudget = false
    for (const { target, org } of picked) {
      if (stoppedForBudget) break
      try {
        const pages = await readEntitySite(org.website!, options.fetchPage)
        if (pages.reduce((n, p) => n + p.text.length, 0) < 120) { checkedToday[org.id] = day; lines.push(`${target.city} — ${org.name}: il sito non ha testo leggibile, da completare a mano.`); continue }
        const response = await (options.model || callModel)(ctx, { model: ctx.agent.model, maxOutputTokens: 1500,
          input: enrichmentPrompt(org, target, pages), jsonSchema: { name: 'entity_enrichment', schema: ENRICHMENT_SCHEMA as unknown as Record<string, unknown> } })
        let parsed: ModelEnrichment
        try { parsed = JSON.parse(response.text) } catch { lines.push(`${target.city} — ${org.name}: risposta del modello non leggibile, nulla salvato.`); continue }
        const result = validateEnrichment({ org, target, pages, model: parsed })
        // Segnato come letto solo dopo la risposta: un budget finito non deve rimandarlo di un mese.
        checkedToday[org.id] = day
        if (!result.ready) {
          lines.push(`${target.city} — ${org.name}: non pronto, manca ${result.missing.join(', ')}.${result.rejected.length ? ` Scartato: ${result.rejected.join('; ')}.` : ''}`)
          continue
        }
        const p = result.proposal
        const added = [p.fill.email && `email ${p.fill.email}`, p.fill.phone && `telefono ${p.fill.phone}`].filter(Boolean).join(', ')
        await addOfficeOutputOnce(admin, ctx, `enricher:proposal:${org.id}:${day}`, { kind: 'proposal', target_table: 'tourism_entities', target_id: org.id,
          title: `${org.name}: ente di ${target.city} pronto per il CRM${added ? ` (${added})` : ''}`,
          body: { ...p, scartato: result.rejected,
            effetto: 'Approvando: le frasi diventano prove verificate a tuo nome, si riempiono solo i campi vuoti, l’ente entra nel CRM (scope crm, nessuna campagna) e va in coda alle Presentazioni.' } })
        proposals++
        lines.push(`${target.city} — ${org.name}: proposta pronta${added ? ` (${added})` : ' (recapiti già presenti)'}.`)
      } catch (error) {
        if (error instanceof BudgetExceeded) { stoppedForBudget = true; lines.push('Budget di oggi finito: gli altri enti al prossimo giro.'); break }
        const message = error instanceof Error ? error.message : String(error)
        checkedToday[org.id] = day
        lines.push(`${target.city} — ${org.name}: non letto (${message}).`)
      }
    }

    // Aziende che distribuiscono: agenzie, DMC, tour operator, property manager, catene.
    const companyLimit = ctx.agent.settings?.companies === false ? 0 : Math.max(0, Math.min(50, Number(ctx.agent.settings?.companies_per_run ?? MAX_COMPANIES_PER_RUN) || 0))
    const companyLines: string[] = []; let companyProposals = 0; let companiesRead = 0
    if (companyLimit && !stoppedForBudget) {
      const companies = await officeRows<EnrichCompany>(admin, userId, 'tourism_entities',
        'id,name,country_code,type_code,aliases,website,email,phone,status,disabled,details,version',
        (q) => q.eq('kind', 'organization').in('type_code', [...COMPANY_TYPES]))
      const candidates = companyCandidates({ orgs: companies, linked, blocked, lastChecked, now, limit: companyLimit })
      for (const org of candidates) {
        companiesRead++
        try {
          const pages = await readEntitySite(org.website!, options.fetchPage)
          if (pages.reduce((n, p) => n + p.text.length, 0) < 120) { checkedToday[org.id] = day; companyLines.push(`${org.name}: il sito non ha testo leggibile.`); continue }
          const response = await (options.model || callModel)(ctx, { model: ctx.agent.model, maxOutputTokens: 1200,
            input: companyPrompt(org, pages), jsonSchema: { name: 'company_enrichment', schema: COMPANY_SCHEMA as unknown as Record<string, unknown> } })
          let parsed: ModelCompanyEnrichment
          try { parsed = JSON.parse(response.text) } catch { companyLines.push(`${org.name}: risposta del modello non leggibile, nulla salvato.`); continue }
          checkedToday[org.id] = day
          const result = validateCompanyEnrichment({ org, pages, model: parsed })
          if (!result.ready) {
            companyLines.push(`${org.name}: non pronta, manca ${result.missing.join(', ')}.${result.rejected.length ? ` Scartato: ${result.rejected.join('; ')}.` : ''}`)
            continue
          }
          const p = result.proposal
          const added = [p.fill.email && `email ${p.fill.email}`, p.fill.phone && `telefono ${p.fill.phone}`].filter(Boolean).join(', ')
          await addOfficeOutputOnce(admin, ctx, `enricher:company:${org.id}:${day}`, { kind: 'proposal', target_table: 'tourism_entities', target_id: org.id,
            title: `${org.name}: recapiti d’ufficio dal sito (${added})`,
            body: { ...p, scartato: result.rejected,
              effetto: 'Approvando: i recapiti entrano nei campi vuoti con le frasi del sito come prova a tuo nome, l’azienda diventa verificata ed entra nel CRM (scope crm, nessuna campagna). Nessuna email parte.' } })
          companyProposals++
          companyLines.push(`${org.name}: proposta pronta (${added}).`)
        } catch (error) {
          if (error instanceof BudgetExceeded) { stoppedForBudget = true; companyLines.push('Budget di oggi finito: le altre aziende al prossimo giro.'); break }
          checkedToday[org.id] = day
          companyLines.push(`${org.name}: non letta (${error instanceof Error ? error.message : String(error)}).`)
        }
      }
    }

    if (!targets.length && !companiesRead) return { summary: 'Nessuna destinazione prioritaria e nessuna azienda da leggere: niente da arricchire.' }
    await addOfficeOutputOnce(admin, ctx, `enricher:day:${day}`, { kind: 'report', title: `Arricchimento enti — ${day}`,
      body: { righe: lines, proposte: proposals, aziende: companyLines, proposte_aziende: companyProposals, checked: checkedToday, gia_nel_crm: alreadyIn.slice(0, 30),
        ente_non_trovato: notFound.slice(0, 40), ente_non_trovato_totale: notFound.length, budget_finito: stoppedForBudget,
        nota: 'Napoli esclusa. Gli enti si cercano solo nel catalogo Tourism Intelligence: una città senza ente va aggiunta a mano. Nessuna email personale, nessun campo pieno sovrascritto, nessuna scrittura prima dell’approvazione.' } })
    return { summary: `${picked.length} enti letti, ${proposals} proposte pronte${notFound.length ? `, ${notFound.length} città senza ente nel catalogo` : ''}; ${companiesRead} aziende lette, ${companyProposals} proposte.` }
  }
}

export const runEntityEnricher: AgentHandler = (ctx) => entityEnricherHandler(createServiceRoleClient())(ctx)
