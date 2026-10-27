/** Guardrail condivisi dagli invii manuali e automatici. */
export function emailBlockReason(contact: Record<string, unknown>): string | null {
  if (contact.email_unsubscribed_at) return 'Il contatto è disiscritto dalle email.'
  if (contact.hidden) return 'Il contatto è nascosto.'
  const eligibility = String(contact.marketing_eligibility || '').trim().toLowerCase()
  if (eligibility === 'excluded' || eligibility === 'suppressed') {
    return 'Il contatto non è eleggibile al marketing.'
  }
  if (
    contact.marketing_status === 'paused' &&
    (!contact.marketing_paused_until || new Date(String(contact.marketing_paused_until)).getTime() > Date.now())
  ) {
    return 'Il marketing è in pausa per questo contatto.'
  }
  return null
}
