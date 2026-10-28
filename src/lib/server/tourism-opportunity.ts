import { tourismOpportunityPlan } from '../opportunities'
import { errorMessage } from './http'

type Admin = any

/**
 * Ogni ente di Tourism Intelligence che entra nei contatti entra anche nel
 * percorso commerciale: un'opportunità nella pipeline del suo tipo, legata
 * all'ente, con il prossimo passo fra due giorni. Una già aperta per lo stesso
 * contatto e pipeline non si duplica (indice unico, 23505). Non lancia mai:
 * l'ente resta attivato anche se l'opportunità non si apre.
 */
export async function openTourismOpportunity(
  admin: Admin,
  userId: string,
  input: { entityId: string; contactId: string; origin: string; now?: Date }
): Promise<{ opened: boolean; pipeline: string | null; error?: string }> {
  try {
    const { data: entity, error } = await admin.from('tourism_entities').select('id,name,type_code')
      .eq('id', input.entityId).eq('user_id', userId).maybeSingle()
    if (error) throw error
    const plan = tourismOpportunityPlan(entity?.type_code)
    if (!entity || !plan) return { opened: false, pipeline: null }
    const due = new Date((input.now?.getTime() ?? Date.now()) + 2 * 86400_000).toISOString()
    const { error: insertError } = await admin.from('deals').insert({
      user_id: userId, contact_id: input.contactId, pipeline: plan.pipeline, role: plan.role, stage: 'qualificata',
      title: `${plan.label} · ${entity.name}`, entity_id: entity.id,
      next_step: plan.next_step, next_step_due: due,
      evidence: [{ kind: 'tourism', text: `Entrato dai contatti di Tourism Intelligence (${input.origin}).` }],
    })
    if (insertError && (insertError as { code?: string }).code !== '23505') throw insertError
    return { opened: !insertError, pipeline: plan.pipeline }
  } catch (error) {
    const message = errorMessage(error, 'opportunità non aperta')
    console.error('[tourism] opportunità non aperta', { entity: input.entityId, message })
    return { opened: false, pipeline: null, error: message }
  }
}

/**
 * Rete di sicurezza: un ente collegato a un contatto (attivazione dalla scheda,
 * Direttore, arricchimento approvato, «Conferma collegamento») senza nessuna
 * opportunità nella sua pipeline ne riceve una. Un'opportunità già chiusa (persa,
 * ferma) conta come esistente: non si riapre da sola quello che qualcuno ha chiuso.
 */
export async function syncTourismOpportunities(admin: Admin, userId: string, now = new Date()) {
  const { data: links, error } = await admin.from('tourism_crm_links').select('entity_id,contact_id').eq('user_id', userId).limit(5000)
  if (error) throw error
  const rows = (links || []) as Array<{ entity_id: string; contact_id: string }>
  if (!rows.length) return { checked: 0, opened: 0, errors: [] as string[] }
  const contactIds = [...new Set(rows.map((r) => r.contact_id))]
  const existing = new Set<string>()
  for (let i = 0; i < contactIds.length; i += 200) {
    const { data, error: dealsError } = await admin.from('deals').select('contact_id,pipeline')
      .eq('user_id', userId).in('pipeline', ['tourism', 'distribuzione']).in('contact_id', contactIds.slice(i, i + 200))
    if (dealsError) throw dealsError
    for (const deal of data || []) existing.add(`${deal.contact_id}:${deal.pipeline}`)
  }
  const entityIds = [...new Set(rows.map((r) => r.entity_id))]
  const types = new Map<string, string>()
  for (let i = 0; i < entityIds.length; i += 200) {
    const { data, error: entError } = await admin.from('tourism_entities').select('id,type_code').eq('user_id', userId).in('id', entityIds.slice(i, i + 200))
    if (entError) throw entError
    for (const e of data || []) types.set(e.id, e.type_code)
  }
  let opened = 0
  const errors: string[] = []
  for (const link of rows) {
    const plan = tourismOpportunityPlan(types.get(link.entity_id))
    if (!plan || existing.has(`${link.contact_id}:${plan.pipeline}`)) continue
    const result = await openTourismOpportunity(admin, userId, { entityId: link.entity_id, contactId: link.contact_id, origin: 'collegamento', now })
    if (result.opened) { opened++; existing.add(`${link.contact_id}:${plan.pipeline}`) }
    if (result.error) errors.push(result.error)
  }
  return { checked: rows.length, opened, errors }
}
