import { crmErrorText, cityForEntity, siteCandidates, siteMatchesEntity, websiteFromText } from '../office/entity-activation'
import { ENRICHMENT_SCHEMA, enrichmentPrompt, validateEnrichment, type EnrichOrg, type EnrichPage, type ModelEnrichment } from '../office/entity-enricher'
import { BudgetExceeded, callModel, type AgentContext } from './office-agents'
import { readEntitySite } from './office-agents/entity-enricher'
import type { ResearchFetch } from './tourism-site-crawler'
import { errorMessage } from './http'

type Admin = any
export type ActivationEntity = EnrichOrg & { version?: number }
export type ActivationResult =
  | { ok: true; placeId: string | null; contactId: string | null; note: string }
  | { ok: false; reply: string }

const checked = (result: any) => { if (result.error) throw result.error; return result.data }
const host = (url: string) => new URL(url).hostname.replace(/^www\./, '')

/** Il sito ufficiale cercato sul web: solo una pagina letta che nomina l'ente vale. */
async function findWebsite(ctx: AgentContext, entity: ActivationEntity, city: string | null,
  deps: { model: typeof callModel; fetchPage?: ResearchFetch }): Promise<{ site: string; pages: EnrichPage[] } | null> {
  const where = [city, entity.country_code].filter(Boolean).join(', ')
  const answer = await deps.model(ctx, { model: ctx.agent.model, maxOutputTokens: 300, webSearch: { maxResults: 5 },
    input: `Qual è il sito web ufficiale dell'ente «${entity.name}» (${where})? È un ente del turismo o un'amministrazione. `
      + 'Rispondi solo con l’indirizzo della home page del sito ufficiale, oppure NESSUNO se non lo trovi. Niente social, Wikipedia o portali di prenotazione.' })
  for (const site of siteCandidates(answer.text, (answer as { citations?: string[] }).citations || [])) {
    try {
      const pages = await readEntitySite(site, deps.fetchPage)
      if (siteMatchesEntity(site, pages.map((p) => p.text).join('\n'), entity.name)) return { site, pages }
    } catch { /* Un candidato che non risponde non ferma la ricerca: si prova il prossimo. */ }
  }
  return null
}

/**
 * «Prepara la presentazione per X» con X non ancora attivo: il Direttore lo attiva
 * lui, a nome del titolare che l'ha chiesto. Sito dall'ente, dall'ordine o dal web;
 * lettura del sito per email e frasi di prova; poi tourism_activate (verifica, luogo,
 * contatto nel CRM). Si ferma solo per chiedere ciò che non può trovare: il sito o la città.
 */
export async function activateEntityForOrder(admin: Admin, ctx: AgentContext, userId: string, entity: ActivationEntity,
  input: { orderText: string; proposedCity: string | null; contactId?: string | null },
  deps: { model?: typeof callModel; fetchPage?: ResearchFetch } = {}): Promise<ActivationResult> {
  const model = deps.model || callModel
  const city = cityForEntity({ proposed: input.proposedCity, entityName: entity.name, aliases: entity.aliases, orderText: input.orderText })
  if (!city) return { ok: false, reply: `${entity.name} non è ancora attivo e non capisco di quale città sia l’ente. Scrivimi «presentazione per ${entity.name}, città …» e lo attivo io.` }

  const notes: string[] = []
  let website = entity.website || websiteFromText(input.orderText)
  let pages: EnrichPage[] = []
  let newSite: string | null = entity.website ? null : website
  if (!website) {
    try {
      const found = await findWebsite(ctx, entity, city, { model, fetchPage: deps.fetchPage })
      if (found) { website = found.site; pages = found.pages; newSite = found.site; notes.push(`ho trovato il sito ${host(found.site)}`) }
    } catch (error) {
      if (error instanceof BudgetExceeded) return { ok: false, reply: `Per attivare ${entity.name} devo cercarne il sito, ma il budget di oggi del Direttore è finito. Mandami il sito («presentazione per ${entity.name}, sito …») e riparto.` }
      notes.push(`la ricerca del sito non è riuscita (${errorMessage(error, 'errore')})`)
    }
  } else if (newSite) notes.push(`ho aggiunto il sito ${host(newSite)}`)
  if (!website) return { ok: false, reply: `${entity.name} non è ancora attivo e non ho trovato il suo sito. Mandamelo («presentazione per ${entity.name}, sito …») e lo attivo io.` }

  // Il sito si legge per prendere email, telefono e le frasi che fanno da prova.
  let parts: ReturnType<typeof validateEnrichment>['parts'] | null = null
  try {
    if (!pages.length) pages = await readEntitySite(website, deps.fetchPage)
    if (pages.reduce((n, p) => n + p.text.length, 0) >= 120) {
      const target = { key: `${entity.country_code}:${city}`, city, country: entity.country_code, names: [city], priority: 1, in_progress: false, place_id: null }
      const response = await model(ctx, { model: ctx.agent.model, maxOutputTokens: 1500, input: enrichmentPrompt(entity, target, pages),
        jsonSchema: { name: 'entity_enrichment', schema: ENRICHMENT_SCHEMA as unknown as Record<string, unknown> } })
      let parsed: ModelEnrichment | null = null
      try { parsed = JSON.parse(response.text) } catch { /* Risposta illeggibile: si attiva senza frasi di prova dal sito. */ }
      if (parsed) parts = validateEnrichment({ org: { ...entity, website }, target, pages, model: parsed }).parts
    } else notes.push('il sito non ha testo leggibile')
  } catch (error) {
    if (error instanceof BudgetExceeded) notes.push('budget finito: attivato senza leggere il sito')
    else notes.push(`il sito non si legge (${errorMessage(error, 'errore')})`)
  }

  const result = checked(await admin.rpc('tourism_activate', { p_user_id: userId, p_entity_id: entity.id, p_payload: {
    origin: 'director', city, website: newSite, ...(input.contactId ? { contact_id: input.contactId } : {}),
    email: parts?.fill.email || null, phone: parts?.fill.phone || null,
    identity: parts?.identity || null,
    coverage: parts?.coverage ? { source_url: parts.coverage.source_url, quote: parts.coverage.quote, relation: parts.coverage.relation } : null,
  } })) as { place_id: string | null; contact_id: string | null; contact_created: boolean; contact_linked?: boolean; crm_error: string | null; filled: string[] }
  if (result.filled?.includes('email')) notes.push(`ho aggiunto l’email ${parts?.fill.email}`)
  else if (!entity.email) notes.push('email non trovata sul sito')
  const crm = crmErrorText(result.crm_error)
  notes.push(crm ? `non l’ho aggiunto ai contatti: ${crm}` : result.contact_created ? 'l’ho aggiunto ai contatti'
    : result.contact_linked ? 'l’ho collegato al contatto che c’era già' : 'era già nei contatti')
  return { ok: true, placeId: result.place_id, contactId: result.contact_id, note: `Ho attivato ${entity.name} (${city}): ${notes.join(', ')}.` }
}

/** Ente già attivo e con una sola destinazione coperta verificata: la presentazione può partire così com'è. */
export async function verifiedDestination(admin: Admin, userId: string, entityId: string): Promise<string | null> {
  const relations = checked(await admin.from('tourism_relations').select('to_id,evidence_id').eq('user_id', userId).eq('from_id', entityId)
    .in('relation', ['COVERS', 'MANAGES', 'PROMOTES']).limit(50)) as Array<{ to_id: string; evidence_id: string }>
  if (!relations.length) return null
  const evidence = checked(await admin.from('tourism_evidence').select('id').eq('user_id', userId).eq('status', 'VERIFIED')
    .in('id', [...new Set(relations.map((r) => r.evidence_id))])) as Array<{ id: string }>
  const ok = new Set(evidence.map((e) => e.id))
  const places = [...new Set(relations.filter((r) => ok.has(r.evidence_id)).map((r) => r.to_id))]
  if (places.length !== 1) return null
  const place = checked(await admin.from('tourism_entities').select('id,status,disabled').eq('user_id', userId).eq('id', places[0]).maybeSingle())
  return place && place.status === 'VERIFIED' && !place.disabled ? place.id : null
}
