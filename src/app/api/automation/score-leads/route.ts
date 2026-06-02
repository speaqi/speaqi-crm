/**
 * POST /api/automation/score-leads
 *
 * Cron endpoint per ricalcolo automatico score lead.
 * Chiamabile da n8n ogni ora.
 *
 * - Bulk: ricalcolo euristico per tutti i contatti attivi non aggiornati da >24h
 * - Top 20: usa AI per i lead con valore/score più alto (opzionale)
 */

import { NextRequest } from 'next/server'
import { calcLeadScore } from '@/lib/server/scoring'
import { createServiceRoleClient } from '@/lib/server/supabase'

function validateSecret(request: NextRequest) {
  const secret = process.env.AUTOMATION_SECRET
  return !!secret && request.headers.get('x-automation-secret') === secret
}

export async function POST(request: NextRequest) {
  if (!validateSecret(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const dryRun = body.dry_run === true
    const limit = Math.min(Number(body.limit) || 500, 2000)
    const supabase = createServiceRoleClient()

    // Contatti attivi con score non aggiornato da >24h
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    let query = supabase
      .from('contacts')
      .select('*')
      .or(`last_scored_at.is.null,last_scored_at.lt.${since}`)
      .not('status', 'in', '("Closed","Paid","Lost")')
      .order('value', { ascending: false, nullsFirst: false })
      .limit(limit)

    const { data: contacts, error } = await query

    if (error) throw error

    let scored = 0
    const updates: Array<{ id: string; score: number }> = []

    for (const contact of (contacts || [])) {
      const result = calcLeadScore(contact)
      updates.push({ id: contact.id, score: result.score })

      if (!dryRun) {
        const { error: updateError } = await supabase
          .from('contacts')
          .update({
            score: result.score,
            engagement_score: result.engagement,
            fit_score: result.fit,
            urgency_score: result.urgency,
            last_scored_at: new Date().toISOString(),
          })
          .eq('id', contact.id)

        if (updateError) {
          console.error(`[score-leads] Failed to update ${contact.id}:`, updateError)
        } else {
          scored++
        }
      }
    }

    return Response.json({
      dry_run: dryRun,
      total_contacts: contacts?.length || 0,
      scored,
      top_scores: updates.slice(0, 10),
    })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to score leads' },
      { status: 500 }
    )
  }
}
