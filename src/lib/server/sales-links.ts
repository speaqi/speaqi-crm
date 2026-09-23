import { createHash, randomBytes } from 'node:crypto'
import { isClosedStatus } from '@/lib/data'
import { isSpeaqiPackageKey, type SpeaqiPackageKey } from '@/lib/speaqi-quote-packages'
import { insertStageTransition } from '@/lib/server/ai-ready'
import { syncDealWithContactStatus } from '@/lib/server/deal-ops'

/**
 * Link vendita: /vendita/<token> senza login, uno per membro del team.
 * 32 byte casuali (256 bit) in base64url = 43 caratteri. Con questa entropia
 * basta uno SHA-256 semplice: nessun sale, nessun hash lento.
 */
export function generateSalesToken() {
  return randomBytes(32).toString('base64url')
}

export function hashSalesToken(token: string) {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export function isWellFormedSalesToken(token: unknown): token is string {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token)
}

export function salesTokenHint(token: string) {
  return token.slice(-4)
}

export function salesLinkPath(token: string) {
  return `/vendita/${token}`
}

/** Tetto anti-abuso: preventivi creati da un link in un'ora. */
export const SALES_LINK_HOURLY_LIMIT = 10
/** Doppio clic / reinvio del modulo: stesso cliente e pacchetto in questa finestra riusa il preventivo. */
export const SALES_LINK_DEDUP_MINUTES = 10

export type SalesQuotePayload = {
  company: string
  contactName: string
  email: string
  phone: string | null
  taxId: string
  address: string | null
  zip: string | null
  city: string | null
  pec: string | null
  sdi: string | null
  packageKey: SpeaqiPackageKey
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function text(value: unknown, max = 200) {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim()
  return normalized ? normalized.slice(0, max) : null
}

export function parseSalesQuotePayload(
  body: unknown
): { ok: true; value: SalesQuotePayload } | { ok: false; error: string } {
  const row = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  const company = text(row.company)
  const contactName = text(row.contact_name)
  const email = text(row.email)?.toLowerCase() || null
  const taxId = text(row.tax_id, 32)?.toUpperCase() || null
  const packageRaw = text(row.package_key, 40) || 'video_map'

  if (!company) return { ok: false, error: 'Ragione sociale obbligatoria' }
  if (!contactName) return { ok: false, error: 'Nome del referente obbligatorio' }
  if (!email || !EMAIL_RE.test(email)) return { ok: false, error: 'Email non valida' }
  if (!taxId) return { ok: false, error: 'Partita IVA o codice fiscale obbligatorio' }
  if (!isSpeaqiPackageKey(packageRaw)) return { ok: false, error: 'Pacchetto non valido' }

  return {
    ok: true,
    value: {
      company,
      contactName,
      email,
      phone: text(row.phone, 40),
      taxId,
      address: text(row.address),
      zip: text(row.zip, 10),
      city: text(row.city, 80),
      pec: text(row.pec)?.toLowerCase() || null,
      sdi: text(row.sdi, 7)?.toUpperCase() || null,
      packageKey: packageRaw,
    },
  }
}

/** `_` e `%` sono jolly per LIKE, e `_` negli indirizzi email e' comune. */
export function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`)
}

export type ResolvedSalesLink = {
  id: string
  userId: string
  member: { id: string; name: string; email: string | null; user_id: string }
}

export async function resolveSalesLink(admin: any, token: unknown): Promise<ResolvedSalesLink | null> {
  if (!isWellFormedSalesToken(token)) return null
  const { data, error } = await admin
    .from('sales_links')
    .select('id, user_id, team_member_id, revoked_at, member:team_members(id, name, email, user_id)')
    .eq('token_hash', hashSalesToken(token))
    .is('revoked_at', null)
    .maybeSingle()
  if (error) throw error
  const member = Array.isArray(data?.member) ? data.member[0] : data?.member
  // Il membro deve appartenere allo stesso workspace del link.
  if (!data || !member || member.user_id !== data.user_id) return null
  return { id: data.id, userId: data.user_id, member }
}

const CONTACT_SELECT =
  'id, name, email, company, phone, status, contact_scope, responsible, assigned_agent, billing_tax_id, billing_pec, billing_sdi, billing_address, billing_zip, billing_city, updated_at'

/**
 * Il contatto del preventivo: se l'email e' gia' nel workspace si riusa la
 * scheda (completando solo i campi vuoti), altrimenti se ne crea una in
 * pipeline intestata al commerciale.
 */
export async function findOrCreateSalesContact(
  admin: any,
  workspaceUserId: string,
  memberName: string,
  payload: SalesQuotePayload
) {
  const { data: candidates, error } = await admin
    .from('contacts')
    .select(CONTACT_SELECT)
    .eq('user_id', workspaceUserId)
    .ilike('email', escapeLike(payload.email))
    .order('updated_at', { ascending: false })
    .limit(10)
  if (error) throw error

  const matches = (candidates || []).filter(
    (row: any) => String(row.email || '').trim().toLowerCase() === payload.email
  )
  const existing = matches.find((row: any) => row.contact_scope === 'crm') || matches[0] || null
  const now = new Date().toISOString()

  if (existing) {
    const patch: Record<string, unknown> = {}
    const fill = (column: string, value: string | null) => {
      if (value && !String(existing[column] || '').trim()) patch[column] = value
    }
    fill('company', payload.company)
    fill('phone', payload.phone)
    fill('billing_tax_id', payload.taxId)
    fill('billing_pec', payload.pec)
    fill('billing_sdi', payload.sdi)
    fill('billing_address', payload.address)
    fill('billing_zip', payload.zip)
    fill('billing_city', payload.city)
    // Il responsabile gia' assegnato non si tocca; se manca, e' di chi ha venduto.
    if (!String(existing.responsible || '').trim() && !String(existing.assigned_agent || '').trim()) {
      patch.responsible = memberName
    }
    if (existing.contact_scope === 'holding') patch.contact_scope = 'crm'

    const moveToQuote = !isClosedStatus(existing.status || '') && existing.status !== 'Quote'
    if (moveToQuote) {
      patch.status = 'Quote'
      patch.stage_entered_at = now
    }

    if (Object.keys(patch).length) {
      const { error: updateError } = await admin
        .from('contacts')
        .update(patch)
        .eq('user_id', workspaceUserId)
        .eq('id', existing.id)
      if (updateError) throw updateError
    }
    if (moveToQuote) {
      await insertStageTransition(admin, {
        contactId: existing.id,
        userId: workspaceUserId,
        fromStage: existing.status || null,
        toStage: 'Quote',
      })
      await syncDealWithContactStatus(admin, workspaceUserId, existing.id, 'Quote')
    }
    return { ...existing, ...patch }
  }

  const { data: inserted, error: insertError } = await admin
    .from('contacts')
    .insert({
      user_id: workspaceUserId,
      name: payload.contactName,
      company: payload.company,
      email: payload.email,
      phone: payload.phone,
      billing_tax_id: payload.taxId,
      billing_pec: payload.pec,
      billing_sdi: payload.sdi,
      billing_address: payload.address,
      billing_zip: payload.zip,
      billing_city: payload.city,
      contact_scope: 'crm',
      status: 'Quote',
      source: 'vendita',
      responsible: memberName,
      stage_entered_at: now,
    })
    .select(CONTACT_SELECT)
    .single()
  if (insertError) throw insertError

  await insertStageTransition(admin, {
    contactId: inserted.id,
    userId: workspaceUserId,
    fromStage: null,
    toStage: 'Quote',
  })
  await syncDealWithContactStatus(admin, workspaceUserId, inserted.id, 'Quote')
  return inserted
}
