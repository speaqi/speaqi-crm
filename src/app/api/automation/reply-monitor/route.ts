import { NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/server/supabase'
import { errorMessage } from '@/lib/server/http'
import { classifyReplyWithAI } from '@/lib/server/ai-ready'
import { syncContactGmailMessages } from '@/lib/server/gmail'
import { validateAutomationSecret } from '@/lib/server/automation-auth'

export async function POST(request: NextRequest) {
  if (!validateAutomationSecret(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return Response.json({ error: 'OPENAI_API_KEY not configured' }, { status: 500 })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const dryRun = body.dry_run === true
    const parsedSinceMinutes = Number(body.since_minutes)
    const sinceMinutes = Number.isFinite(parsedSinceMinutes)
      ? Math.min(14 * 24 * 60, Math.max(1, Math.floor(parsedSinceMinutes)))
      : 60
    const parsedCommercialLimit = Number(body.commercial_limit)
    const commercialLimit = Number.isFinite(parsedCommercialLimit)
      ? Math.min(500, Math.max(1, Math.floor(parsedCommercialLimit)))
      : 200
    const supabase = createServiceRoleClient()

    const since = new Date(Date.now() - sinceMinutes * 60 * 1000).toISOString()

    const { data: recentOutbounds, error: outError } = await supabase
      .from('gmail_messages')
      .select('contact_id, user_id, sent_at')
      .eq('direction', 'outbound')
      .gte('sent_at', since)
      .not('contact_id', 'is', null)
      .order('sent_at', { ascending: false })

    if (outError) throw outError

    // Rotate through active commercial enrollments independently from the
    // recent-outbound window. This catches replies arriving days or weeks later.
    const { data: commercialEnrollmentRows, error: enrollmentError } = await supabase
      .from('commercial_enrollments')
      .select('id,contact_id,last_reply_checked_at')
      .in('status', ['pending', 'active'])
      .order('last_reply_checked_at', { ascending: true, nullsFirst: true })
      .limit(commercialLimit)
    if (enrollmentError && String(enrollmentError.code || '') !== '42P01') throw enrollmentError
    const commercialEnrollments = enrollmentError ? [] : (commercialEnrollmentRows || [])

    const enrollmentIds = commercialEnrollments.map((row: any) => row.id)
    let commercialOutbounds: any[] = []
    if (enrollmentIds.length) {
      const { data, error: commercialError } = await supabase
        .from('commercial_messages')
        .select('enrollment_id,sent_at')
        .in('enrollment_id', enrollmentIds)
        .eq('status', 'sent')
        .not('sent_at', 'is', null)
        .order('sent_at', { ascending: false })
      if (commercialError) throw commercialError
      commercialOutbounds = data || []
    }

    if (!dryRun && enrollmentIds.length) {
      const withSent = new Set(commercialOutbounds.map((row: any) => row.enrollment_id))
      const withoutSent = enrollmentIds.filter((id: string) => !withSent.has(id))
      if (withoutSent.length) {
        await supabase.from('commercial_enrollments')
          .update({ last_reply_checked_at: new Date().toISOString() })
          .in('id', withoutSent)
      }
    }

    if (!recentOutbounds?.length && !commercialOutbounds?.length) {
      return Response.json({ ok: true, since_minutes: sinceMinutes, commercial_limit: commercialLimit, checked: 0, replies_found: 0, errors: 0, message: 'Nessuna email outbound da controllare' })
    }

    // Deduplicate by contact — keep only the latest outbound per contact for the sent_at threshold
    const latestPerContact = new Map<string, string>()
    for (const msg of recentOutbounds) {
      if (!latestPerContact.has(msg.contact_id)) {
        latestPerContact.set(msg.contact_id, msg.sent_at || '')
      }
    }
    const enrollmentById = new Map(commercialEnrollments.map((row: any) => [row.id, row]))
    for (const msg of commercialOutbounds) {
      const enrollment: any = enrollmentById.get(msg.enrollment_id)
      const contactId = enrollment?.contact_id
      const previous = contactId ? latestPerContact.get(contactId) : null
      if (contactId && (!previous || String(msg.sent_at || '') > previous)) latestPerContact.set(contactId, msg.sent_at || '')
    }

    const results: Array<{
      contact_id: string
      reply_found: boolean
      intent?: string
      action?: string
      error?: string
    }> = []

    async function runWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>) {
      const out = new Array<R>(items.length)
      let next = 0
      async function runner() {
        while (next < items.length) {
          const i = next++
          out[i] = await worker(items[i])
        }
      }
      await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => runner()))
      return out
    }

    const entries = [...latestPerContact.entries()].map(([contactId, latestSentAt]) => ({ contactId, latestSentAt }))

    const processed = await runWithConcurrency(entries, 2, async ({ contactId, latestSentAt }) => {
      try {
        const { data: contact, error: contactError } = await supabase
          .from('contacts')
          .select('*')
          .eq('id', contactId)
          .single()

        if (contactError || !contact?.user_id) {
          return { contact_id: contactId, reply_found: false }
        }

        if (!dryRun) {
          await syncContactGmailMessages(supabase, contact.user_id, contact, 30)
        }

        // Check for inbound messages after the latest outbound (already in DB from Gmail sync)
        const { data: inboundAfter, error: inError } = await supabase
          .from('gmail_messages')
          .select('body_text, snippet')
          .eq('contact_id', contactId)
          .eq('direction', 'inbound')
          .gte('sent_at', latestSentAt)
          .order('sent_at', { ascending: true })
          .limit(5)

        if (inError || !inboundAfter?.length) {
          if (!dryRun) {
            await supabase.from('commercial_enrollments')
              .update({ last_reply_checked_at: new Date().toISOString() })
              .eq('contact_id', contactId).in('status', ['pending', 'active'])
          }
          return { contact_id: contactId, reply_found: false }
        }

        const replyText = inboundAfter
          .map((m: any) => String(m.body_text || m.snippet || '').trim())
          .filter(Boolean)
          .join('\n---\n')

        if (!replyText) {
          if (!dryRun) {
            await supabase.from('commercial_enrollments')
              .update({ last_reply_checked_at: new Date().toISOString() })
              .eq('contact_id', contactId).in('status', ['pending', 'active'])
          }
          return { contact_id: contactId, reply_found: false }
        }

        if (dryRun) {
          const classification = await classifyReplyWithAI(replyText)
          return { contact_id: contactId, reply_found: true, intent: classification.intent }
        }

        const repliedAt = new Date().toISOString()
        const { data: stoppedEnrollments, error: stopError } = await supabase
          .from('commercial_enrollments')
          .update({ status: 'stopped', stop_reason: 'reply', stopped_at: repliedAt, replied_at: repliedAt, next_step_at: null })
          .eq('contact_id', contactId).in('status', ['pending', 'active']).select('id')
        if (stopError) throw stopError
        if (stoppedEnrollments?.length) {
          const enrollmentIds = stoppedEnrollments.map((row: any) => row.id)
          await supabase.from('commercial_messages').update({ replied_at: repliedAt }).in('enrollment_id', enrollmentIds).eq('status', 'sent')
          await supabase.from('contacts').update({ status: 'Interested', next_action_at: null, next_followup_at: null, last_activity_summary: 'Risposta ricevuta: sequenza automatica interrotta' }).eq('id', contactId)
          await supabase.from('activities').insert({ user_id: contact.user_id, contact_id: contactId, type: 'email_reply', content: 'Risposta Gmail ricevuta. Sequenza Hospitality interrotta automaticamente.' })
          await supabase.from('tasks').insert({ user_id: contact.user_id, contact_id: contactId, type: 'follow-up', action: 'reply', due_date: repliedAt, priority: 'high', status: 'pending', note: 'Rispondere al contatto Hospitality interessato' })
        }

        return {
          contact_id: contactId,
          reply_found: true,
          action: 'processed_by_gmail_sync',
        }
      } catch (err) {
        return { contact_id: contactId, reply_found: false, error: errorMessage(err, 'Errore') }
      }
    })

    results.push(...processed)

    const replies = results.filter((r) => r.reply_found)
    const errors = results.filter((r) => r.error).length

    return Response.json({
      ok: errors === 0,
      dry_run: dryRun,
      since_minutes: sinceMinutes,
      commercial_limit: commercialLimit,
      checked: results.length,
      replies_found: replies.length,
      errors,
      message: `${replies.length} risposte trovate su ${results.length} contatti`,
      replies,
    }, { status: errors > 0 ? 500 : 200 })
  } catch (error) {
    console.error('reply-monitor failed', error)
    return Response.json({ error: errorMessage(error, 'Reply monitor failed') }, { status: 500 })
  }
}
