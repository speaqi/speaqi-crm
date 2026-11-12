import { crmErrorText } from '../office/entity-activation'
import type { CompanyProposal } from '../office/entity-enricher'

type Admin = any
const CLAIM_TTL_MS = 5 * 60_000

function checked<T>(result: { data: T; error: unknown }): T {
  if (result.error) throw result.error
  return result.data
}

/**
 * Il clic su una proposta «azienda» dell'Arricchimento enti. Le frasi lette sul sito
 * diventano una prova verificata a nome del titolare, i recapiti entrano solo nei campi
 * vuoti e l'azienda va nel CRM: tutto dentro tourism_activate, senza città. Una sola
 * richiesta lavora la proposta (la presa si scrive e si rilegge prima del lavoro).
 * Restituisce null quando l'uscita non è di questo tipo.
 */
export async function approveEnrichedCompany(admin: Admin, userId: string, outputId: string) {
  const row = checked(await admin.from('office_agent_outputs').select('id,status,body').eq('id', outputId).eq('user_id', userId)
    .eq('agent_id', 'entity_enricher').eq('kind', 'proposal').eq('body->>action', 'enrich_company').maybeSingle()) as { id: string; status: string; body: any } | null
  if (!row) return null
  if (row.status !== 'pending') return { error: 'Questa proposta è già stata decisa. Aggiorna la pagina.', status: 409 }
  const previous = row.body?.claimed_at ? String(row.body.claimed_at) : null
  if (previous && Date.now() - new Date(previous).getTime() < CLAIM_TTL_MS) return { error: 'Sto già lavorando questa proposta: aspetta qualche secondo e aggiorna.', status: 409 }

  const token = new Date().toISOString()
  let claim = admin.from('office_agent_outputs').update({ body: { ...row.body, claimed_at: token } }).eq('id', outputId).eq('user_id', userId).eq('status', 'pending')
  claim = previous ? claim.eq('body->>claimed_at', previous) : claim.is('body->>claimed_at', null)
  checked(await claim)
  const mine = checked(await admin.from('office_agent_outputs').select('status,body').eq('id', outputId).eq('user_id', userId).single()) as { status: string; body: any }
  if (mine.status !== 'pending' || mine.body?.claimed_at !== token) return { error: 'Sto già lavorando questa proposta: aspetta qualche secondo e aggiorna.', status: 409 }

  const body = mine.body as CompanyProposal & Record<string, any>
  const release = () => admin.from('office_agent_outputs').update({ body: { ...body, claimed_at: null } }).eq('id', outputId).eq('user_id', userId)
    .eq('status', 'pending').eq('body->>claimed_at', token)
  const quote = [body.evidence?.identity?.quote, body.evidence?.email?.quote, body.evidence?.phone?.quote].filter(Boolean).join(' … ').slice(0, 2000)
  let result: { contact_id: string | null; contact_created: boolean; crm_error: string | null; filled: string[] }
  try {
    result = checked(await admin.rpc('tourism_activate', { p_user_id: userId, p_entity_id: body.entity_id, p_payload: {
      origin: 'owner', email: body.fill?.email || null, phone: body.fill?.phone || null,
      identity: { source_url: body.evidence?.identity?.source_url || body.website, quote },
    } }))
  } catch (error) {
    await release()
    const message = (error as { message?: string })?.message || String(error)
    return { error: `Azienda non aggiornata: ${message}. La proposta resta in attesa.`, status: 409 }
  }

  const { claimed_at: _ignored, ...rest } = body
  const done = checked(await admin.from('office_agent_outputs')
    .update({ status: 'approved', decided_at: new Date().toISOString(), body: { ...rest, result } })
    .eq('id', outputId).eq('user_id', userId).eq('status', 'pending').eq('body->>claimed_at', token).select('*')) as unknown[]
  if (!done?.length) return { error: 'Questa proposta è già stata decisa. Aggiorna la pagina.', status: 409 }

  const filled = (result.filled || []).map((f) => ({ email: 'email', phone: 'telefono', website: 'sito' } as Record<string, string>)[f] || f)
  const crm = crmErrorText(result.crm_error)
  const notice = `${body.entity_name}: ${filled.length ? `aggiunti ${filled.join(' e ')}` : 'recapiti già presenti'}, verificata; ${
    crm ? `non l’ho portata nei contatti: ${crm}` : result.contact_created ? 'aggiunta ai contatti' : 'era già nei contatti'}.`
  return { output: done[0], notice, contact_id: result.contact_id || undefined }
}
