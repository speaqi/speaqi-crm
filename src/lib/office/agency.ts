import { AGENCY_STAGES, AGENCY_TODO_PATTERN, categorySlug, countTodo, type AgencySlide, type ServiceCategory } from '../agency'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export type AgencyQueueItem = { key: string; agency_project_id?: string; contact_id?: string; brief?: string; services?: string[] }
export function agencyQueue(raw: unknown) {
  const entries: AgencyQueueItem[] = [], rejected: string[] = [], seen = new Set<string>()
  if (!Array.isArray(raw)) return { entries, rejected: ['La coda deve essere una lista'] }
  for (const [i, item] of raw.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) { rejected.push(`Elemento ${i + 1} non valido`); continue }
    const project = typeof item.agency_project_id === 'string' && UUID.test(item.agency_project_id)
    const contact = typeof item.contact_id === 'string' && UUID.test(item.contact_id)
    if (project === contact || (item.agency_project_id && !project) || (item.contact_id && !contact)
      || (!project && (typeof item.brief !== 'string' || !item.brief.trim() || item.brief.length > 40000
        || !Array.isArray(item.services) || item.services.length > 20 || item.services.some((s: unknown) => typeof s !== 'string')))) {
      rejected.push(`Elemento ${i + 1}: servono un’opportunità oppure contatto, brief e servizi validi`); continue
    }
    const key = project ? `project:${item.agency_project_id.toLowerCase()}` : `contact:${item.contact_id.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    entries.push(project ? { key, agency_project_id: item.agency_project_id.toLowerCase() }
      : { key, contact_id: item.contact_id.toLowerCase(), brief: item.brief, services: item.services })
  }
  return { entries, rejected }
}

/** Gli alias risolvono solo categorie già presenti e attive; non ne creano. */
export function agencyServices(wanted: string[], categories: Pick<ServiceCategory, 'slug' | 'is_active'>[]) {
  const known = new Set(categories.filter((c) => c.is_active).map((c) => c.slug))
  const aliases: Record<string, string> = { sito: 'siti-web', siti: 'siti-web', seo: 'seo-geo', geo: 'seo-geo', ai: 'ai-automazioni', social: 'social-contenuti' }
  return [...new Set(wanted.map(categorySlug).map((s) => known.has(s) ? s : aliases[s]).filter((s) => known.has(s)))]
}

export function agencyTodo(slides: AgencySlide[], hasQuote: boolean) {
  const locations: Array<{ slide: string; field: string }> = []
  for (const slide of slides) {
    const fields: Array<[string, string]> = [['title', slide.title], ['kicker', slide.kicker], ['body', slide.body], ['note', slide.note]]
    slide.items.forEach((item, i) => { for (const key of ['title', 'text', 'value'] as const) fields.push([`items.${i}.${key}`, item[key]]) })
    for (const [field, value] of fields) if (String(value || '').match(AGENCY_TODO_PATTERN)) locations.push({ slide: slide.id, field })
    if (!hasQuote && slide.kind === 'investment') locations.push({ slide: slide.id, field: 'preventivo collegato' })
    if (['metrics', 'chart'].includes(slide.kind)) slide.items.forEach((item, i) => { if (!item.value.trim()) locations.push({ slide: slide.id, field: `items.${i}.value` }) })
  }
  return { count: countTodo(slides, { hasQuote }), locations }
}

export const agencyPipelineCounts = (projects: Array<{ stage: string }>) => Object.fromEntries(AGENCY_STAGES.map((stage) => [stage, projects.filter((p) => p.stage === stage).length]))
export const agencyEmail = (email: unknown) => String(email || '').trim().toLowerCase()
