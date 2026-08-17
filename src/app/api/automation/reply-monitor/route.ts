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

    if (!recentOutbounds?.length) {
      return Response.json({ ok: true, since_minutes: sinceMinutes, checked: 0, replies_found: 0, errors: 0, message: 'Nessuna email outbound recente' })
    }

    // Deduplicate by contact — keep only the latest outbound per contact for the sent_at threshold
    const latestPerContact = new Map<string, string>()
    for (const msg of recentOutbounds) {
      if (!latestPerContact.has(msg.contact_id)) {
        latestPerContact.set(msg.contact_id, msg.sent_at || '')
      }
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
          return { contact_id: contactId, reply_found: false }
        }

        const replyText = inboundAfter
          .map((m: any) => String(m.body_text || m.snippet || '').trim())
          .filter(Boolean)
          .join('\n---\n')

        if (!replyText) {
          return { contact_id: contactId, reply_found: false }
        }

        if (dryRun) {
          const classification = await classifyReplyWithAI(replyText)
          return { contact_id: contactId, reply_found: true, intent: classification.intent }
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
