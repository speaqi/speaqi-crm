import { NextRequest } from 'next/server'
import { isClosedStatus } from '@/lib/data'
import { createActivities, syncPendingCallTask, updateContactSummary } from '@/lib/server/crm'
import { createServiceRoleClient } from '@/lib/server/supabase'

function validateSecret(request: NextRequest) {
  const secret = process.env.AUTOMATION_SECRET
  return !!secret && request.headers.get('x-automation-secret') === secret
}

function followupAt(days: number) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  date.setHours(10, 0, 0, 0)
  return date.toISOString()
}

function normalizedEmail(value: unknown) {
  return String(value || '').trim().toLowerCase()
}

/**
 * Promotes only contacts still in the Acumbamail holding list. This keeps the
 * operation idempotent: a promoted contact is not picked up on future runs.
 */
export async function POST(request: NextRequest) {
  if (!validateSecret(request)) {
    return Response.json({ error: 'Unauthorized automation' }, { status: 401 })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const dryRun = body.dry_run === true
    const campaignKeyFilter = String(body.campaign_key || '').trim()
    const supabase = createServiceRoleClient()

    let campaignQuery = supabase
      .from('acumbamail_campaigns')
      .select('user_id,campaign_key,name,min_opens,responsible')
      .order('updated_at', { ascending: false })

    if (campaignKeyFilter) campaignQuery = campaignQuery.eq('campaign_key', campaignKeyFilter)

    const { data: campaigns, error: campaignsError } = await campaignQuery
    if (campaignsError) throw campaignsError

    let qualified = 0
    let promoted = 0
    let skippedClosed = 0
    const failures: Array<{ campaign_key: string; contact_id: string; error: string }> = []

    for (const campaign of campaigns || []) {
      const { data: engagements, error: engagementsError } = await supabase
        .from('acumbamail_campaign_engagements')
        .select('email,open_count,click_count')
        .eq('user_id', campaign.user_id)
        .eq('campaign_key', campaign.campaign_key)
        .or(`open_count.gte.${Math.max(1, Number(campaign.min_opens || 1))},click_count.gt.0`)

      if (engagementsError) throw engagementsError
      if (!engagements?.length) continue
      qualified += engagements.length

      const { data: holdingContacts, error: contactsError } = await supabase
        .from('contacts')
        .select('id,name,email,status,priority')
        .eq('user_id', campaign.user_id)
        .eq('contact_scope', 'holding')
        .eq('event_tag', campaign.campaign_key)

      if (contactsError) throw contactsError
      const contactByEmail = new Map(
        (holdingContacts || []).map((contact: any) => [normalizedEmail(contact.email), contact])
      )

      for (const engagement of engagements) {
        const contact = contactByEmail.get(normalizedEmail(engagement.email))
        if (!contact) continue
        if (isClosedStatus(String(contact.status || ''))) {
          skippedClosed += 1
          continue
        }

        const clicked = Number(engagement.click_count || 0) > 0
        const nextStatus = clicked ? 'Interested' : 'Contacted'
        const dueAt = followupAt(clicked ? 1 : 3)
        const priority = Math.max(Number(contact.priority || 0), clicked ? 3 : 2)
        const reason = clicked
          ? `Click rilevato nella campagna ${campaign.name || campaign.campaign_key}.`
          : `Qualificato dopo ${Number(engagement.open_count || 0)} aperture nella campagna ${campaign.name || campaign.campaign_key}.`
        const taskNote = `${reason} Ricontatta ${contact.name}.`

        if (dryRun) {
          promoted += 1
          continue
        }

        try {
          const updatePayload: Record<string, unknown> = {
            contact_scope: 'crm',
            promoted_at: new Date().toISOString(),
            status: nextStatus,
            priority,
            next_action_at: dueAt,
            next_followup_at: dueAt,
            last_activity_summary: reason,
            updated_at: new Date().toISOString(),
          }
          if (campaign.responsible) updatePayload.responsible = campaign.responsible

          const { error: updateError } = await supabase
            .from('contacts')
            .update(updatePayload)
            .eq('id', contact.id)
            .eq('user_id', campaign.user_id)

          if (updateError) throw updateError

          await syncPendingCallTask(supabase, campaign.user_id, contact.id, dueAt, {
            type: 'follow-up',
            priority: clicked ? 'high' : 'medium',
            note: taskNote,
            overwriteNote: true,
          })
          await createActivities(supabase, [{
            user_id: campaign.user_id,
            contact_id: contact.id,
            type: 'system',
            content: `Lead promosso automaticamente da Acumbamail. ${reason}`,
            metadata: {
              source: 'acumbamail_qualification',
              campaign_key: campaign.campaign_key,
              open_count: Number(engagement.open_count || 0),
              click_count: Number(engagement.click_count || 0),
            },
          }])
          await updateContactSummary(supabase, contact.id, reason, { nextFollowupAt: dueAt })
          promoted += 1
        } catch (error) {
          failures.push({
            campaign_key: campaign.campaign_key,
            contact_id: contact.id,
            error: error instanceof Error ? error.message : 'Promozione non riuscita',
          })
        }
      }
    }

    return Response.json({
      dry_run: dryRun,
      campaigns_checked: campaigns?.length || 0,
      qualified,
      promoted,
      skipped_closed: skippedClosed,
      failures,
    })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Acumbamail qualification failed' },
      { status: 500 }
    )
  }
}
