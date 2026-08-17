/**
 * Cadenza di follow-up: fonte di verita unica.
 *
 * Prima esistevano due copie divergenti della stessa tabella SLA — una in
 * /api/automation/followups (generazione task) e una in /api/automation/send-draft
 * (data di follow-up dopo l'invio). Ogni consumer deve passare da qui.
 */

/** Ore di SLA prima che un contatto fermo in questo stage vada richiamato. */
export function statusSlaHours(status?: string | null) {
  const normalized = String(status || '').trim().toLowerCase()
  if (normalized === 'new') return 4
  if (normalized === 'contacted') return 24
  if (normalized === 'interested' || normalized === 'supertop' || normalized === 'quote') return 24
  if (normalized.includes('call')) return 12
  return 72
}

/** Giorni di attesa per i contatti in holding: cadenza lunga, non azzeramento. */
export const HOLDING_FOLLOWUP_DAYS = 7

const CALLABLE_HOUR = 10

/**
 * Sposta una data in uno slot in cui si puo davvero chiamare o scrivere:
 * mai a mezzanotte, mai nel weekend.
 */
export function toCallableSlot(date: Date) {
  const slot = new Date(date)
  if (slot.getHours() === 0) slot.setHours(CALLABLE_HOUR, 0, 0, 0)
  while (slot.getDay() === 0 || slot.getDay() === 6) {
    slot.setDate(slot.getDate() + 1)
    slot.setHours(CALLABLE_HOUR, 0, 0, 0)
  }
  return slot
}

/** Prossimo follow-up dopo aver inviato un'email, in base allo stage del contatto. */
export function nextFollowupAfterEmail(status?: string | null, from: Date = new Date()) {
  return toCallableSlot(new Date(from.getTime() + statusSlaHours(status) * 60 * 60 * 1000))
}

/** Prossimo follow-up per un contatto in holding (cadenza lenta). */
export function nextHoldingFollowup(from: Date = new Date()) {
  return toCallableSlot(new Date(from.getTime() + HOLDING_FOLLOWUP_DAYS * 24 * 60 * 60 * 1000))
}
