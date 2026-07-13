import type { CRMContact } from '@/types'

/**
 * Pertinenza contatto ("relevance"): un punteggio semplice e spiegabile che
 * porta in cima i contatti con cui hai avuto più a che fare, pesando anche la
 * posizione in pipeline. Serve per non perdere i lead "trascinati" (sentiti
 * tante volte) sotto lead mai contattati che risultano solo vecchi.
 *
 * Formula:
 *   pertinenza = interazioni + stage pipeline + priorità + score AI + richiamo scaduto
 * La vecchiaia (giorni fermo) NON entra nel punteggio: resta solo come
 * spareggio, così i "mai contattati" non salgono in cima solo perché vecchi.
 */

// Peso di ogni stage: più avanti nella pipeline = più prezioso da recuperare.
const STAGE_WEIGHTS: Record<string, number> = {
  new: 0,
  contacted: 12,
  replied: 18,
  interested: 26,
  waiting: 16,
  supertop: 30,
  call_booked: 34,
  call_scheduled: 34,
  quote: 44,
}

function stageWeight(status?: string | null): number {
  const key = String(status || '').toLowerCase().trim().replace(/\s+/g, '_')
  return STAGE_WEIGHTS[key] ?? 0
}

// Ogni interazione registrata vale ENGAGEMENT_UNIT punti, con un tetto: oltre
// un certo numero di tocchi il contatto è già "top", non serve gonfiare.
const ENGAGEMENT_UNIT = 9
const ENGAGEMENT_CAP = 18

export function engagementScore(count?: number | null): number {
  const n = Math.max(0, Math.floor(Number(count || 0)))
  return Math.min(n, ENGAGEMENT_CAP) * ENGAGEMENT_UNIT
}

export interface RelevanceInput {
  contact: Pick<CRMContact, 'status' | 'priority' | 'score' | 'engagement_count'>
  /** true se il richiamo pianificato è già scaduto (Waiting con data passata). */
  recallOverdue?: boolean
}

export function contactRelevanceScore({ contact, recallOverdue }: RelevanceInput): number {
  let score = engagementScore(contact.engagement_count)
  score += stageWeight(contact.status)

  const priority = Number(contact.priority || 0)
  if (priority >= 3) score += 30
  else if (priority === 2) score += 12
  else if (priority === 1) score += 5

  const leadScore = Number(contact.score || 0)
  if (leadScore > 0) score += Math.min(20, Math.round(leadScore / 5))

  if (recallOverdue) score += 14

  return Math.round(score)
}

/** Etichetta breve per il badge pertinenza, es. "7×". Null se mai lavorato. */
export function engagementBadge(count?: number | null): string | null {
  const n = Math.max(0, Math.floor(Number(count || 0)))
  if (n <= 0) return null
  return `${n}×`
}
