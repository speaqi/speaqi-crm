/**
 * Lead Scoring — formula ICE (Interest + Contact_Fit + Engagement + Urgency).
 * Sostituisce il vecchio scoreLeadHeuristically con pesi più granulari.
 */

import { isClosedStatus } from '@/lib/data'
import type { CRMContact } from '@/types'

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(value)))
}

// ─── Interest (0-100): quanto è interessato in base allo stage ───

const STATUS_INTEREST: Record<string, number> = {
  new: 5,
  contacted: 25,
  replied: 35,
  interested: 55,
  supertop: 70,
  call_booked: 60,
  call_scheduled: 60,
  quote: 85,
  preventivo: 85,
}

export function calcInterestScore(contact: Pick<CRMContact, 'status'>): number {
  const key = String(contact.status || '').trim().toLowerCase()
  return STATUS_INTEREST[key] ?? 10
}

// ─── Contact Fit (0-100): quanto matcha il profilo ideale Speaqi ───

const TARGET_INDUSTRIES = [
  'turismo', 'touris', 'travel', 'viaggi',
  'export', 'export manager', 'import export',
  'eventi', 'events', 'event',
  'immobiliare', 'real estate',
  'vino', 'wine', 'winery', 'vinitaly',
  'food', 'cibo', 'alimentare', 'ristorazione',
  'hotel', 'hospitality', 'ospitalità',
  'marketing', 'digital', 'agenzia',
  'ente pubblico', 'comune', 'museo', 'cultura',
]

const DECISION_MAKER_ROLES = [
  'ceo', 'founder', 'titolare', 'proprietario', 'owner',
  'direttore', 'director', 'manager', 'responsabile',
  'marketing manager', 'export manager', 'sales manager',
  'digital manager', 'head of', 'vp',
]

function matchTargetIndustry(category?: string | null, company?: string | null): boolean {
  const haystack = [category, company].filter(Boolean).join(' ').toLowerCase()
  if (!haystack) return false
  return TARGET_INDUSTRIES.some((kw) => haystack.includes(kw))
}

function matchDecisionMaker(note?: string | null, category?: string | null): boolean {
  const haystack = [note, category].filter(Boolean).join(' ').toLowerCase()
  if (!haystack) return false
  return DECISION_MAKER_ROLES.some((kw) => haystack.includes(kw))
}

export function calcFitScore(contact: Pick<CRMContact, 'industry' | 'company' | 'category' | 'note' | 'language' | 'country' | 'source'>): number {
  let score = 20 // base

  // Industry match
  if (contact.industry) {
    if (matchTargetIndustry(contact.industry, contact.company)) score += 25
  } else if (matchTargetIndustry(contact.category, contact.company)) {
    score += 20
  }

  // Decision maker role
  if (matchDecisionMaker(contact.note, contact.category)) score += 15

  // Has multilingual need (Speaqi core value prop)
  if (contact.language && contact.language !== 'it') score += 12

  // Target country (Italy + EU)
  if (!contact.country || contact.country.toLowerCase() === 'italy' || contact.country.toLowerCase() === 'italia') {
    score += 8
  }

  // Inbound lead (higher intent)
  if (contact.source === 'speaqi' || contact.source === 'inbound') score += 10

  // Has company (B2B vs consumer)
  if (contact.company) score += 8

  return clamp(score, 0, 100)
}

// ─── Engagement (0-100): quanto interagisce ───

export function calcEngagementScore(contact: Pick<CRMContact, 'email_open_count' | 'email_click_count' | 'last_email_open_at' | 'last_email_click_at' | 'last_contact_at'>): number {
  const now = Date.now()
  const DAY = 24 * 60 * 60 * 1000
  let score = 15

  const openCount = contact.email_open_count || 0
  const clickCount = contact.email_click_count || 0

  // Email opens
  if (openCount > 0) score += Math.min(openCount * 3, 20)

  // Email clicks (stronger signal)
  if (clickCount > 0) score += Math.min(clickCount * 8, 30)

  // Recent open (last 7 days)
  const lastOpen = contact.last_email_open_at ? new Date(contact.last_email_open_at).getTime() : null
  if (lastOpen && now - lastOpen <= 7 * DAY) score += 15

  // Recent click (last 14 days)
  const lastClick = contact.last_email_click_at ? new Date(contact.last_email_click_at).getTime() : null
  if (lastClick && now - lastClick <= 14 * DAY) score += 18

  // Recent contact (last 7 days)
  const lastContact = contact.last_contact_at ? new Date(contact.last_contact_at).getTime() : null
  if (lastContact && now - lastContact <= 7 * DAY) score += 8

  // Penalty: no engagement in 30+ days
  const reference = lastContact || (contact.last_email_open_at ? new Date(contact.last_email_open_at).getTime() : null)
  if (!reference || now - reference > 30 * DAY) {
    score -= 25
  } else if (reference && now - reference > 14 * DAY) {
    score -= 10
  }

  return clamp(score, 0, 100)
}

// ─── Urgency (0-100): quanto è urgente per il cliente ───

export function calcUrgencyScore(contact: Pick<CRMContact, 'status' | 'next_followup_at'>): number {
  const now = Date.now()
  const DAY = 24 * 60 * 60 * 1000
  let score = 15

  // Has scheduled follow-up soon
  const followupDate = contact.next_followup_at ? new Date(contact.next_followup_at).getTime() : null
  if (followupDate && followupDate <= now) {
    score += 35 // overdue
  } else if (followupDate && followupDate - now <= 24 * 60 * 60 * 1000) {
    score += 25 // due today
  } else if (followupDate && followupDate - now <= 3 * DAY) {
    score += 12 // this week
  }

  // In negotiation/quote phase (high urgency)
  const status = String(contact.status || '').trim().toLowerCase()
  if (status === 'quote' || status === 'preventivo') score += 25
  if (status === 'supertop') score += 20

  // Inbound = more urgent
  // (handled in fit, not duplicated here)

  return clamp(score, 0, 100)
}

// ─── Composite ICE Score ───

const WEIGHTS = {
  interest: 0.30,
  fit: 0.25,
  engagement: 0.25,
  urgency: 0.20,
}

export function calcLeadScore(
  contact: CRMContact,
  components?: { interest?: number; fit?: number; engagement?: number; urgency?: number }
): { score: number; interest: number; fit: number; engagement: number; urgency: number } {
  const interest = components?.interest ?? calcInterestScore(contact)
  const fit = components?.fit ?? calcFitScore(contact)
  const engagement = components?.engagement ?? calcEngagementScore(contact)
  const urgency = components?.urgency ?? calcUrgencyScore(contact)

  const score = clamp(
    interest * WEIGHTS.interest +
    fit * WEIGHTS.fit +
    engagement * WEIGHTS.engagement +
    urgency * WEIGHTS.urgency,
    0,
    100
  )

  return { score, interest, fit, engagement, urgency }
}

/**
 * Full score recalculation — scrive i componenti su contacts.
 * Chiamare dopo ogni attività, cambio stage, o evento email.
 */
export async function recalcAndPersistScore(
  supabase: any,
  contact: CRMContact
): Promise<{ score: number; interest: number; fit: number; engagement: number; urgency: number }> {
  const result = calcLeadScore(contact)

  const { error } = await supabase
    .from('contacts')
    .update({
      score: result.score,
      engagement_score: result.engagement,
      fit_score: result.fit,
      urgency_score: result.urgency,
      last_scored_at: new Date().toISOString(),
    })
    .eq('id', contact.id)

  if (error) {
    console.error('[scoring] Failed to persist score:', error)
  }

  return result
}
