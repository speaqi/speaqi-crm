import { NextRequest } from 'next/server'
import { createActivities } from '@/lib/server/crm'
import { validateAutomationSecret } from '@/lib/server/automation-auth'
import {
  addCampaignRecipients,
  createWineProjectCampaign,
  createWineProjectRecipientList,
} from '@/lib/server/acumbamail-marketing'
import { errorMessage } from '@/lib/server/http'
import { createServiceRoleClient } from '@/lib/server/supabase'
import { loadWineProjectAutomationSettings, type WineProjectSequenceTemplate } from '@/lib/server/wine-project-automation'
import { createWineProjectCampaignToken } from '@/lib/server/wine-project-campaign-token'

type QueuedEvent = {
  id: string
  user_id: string
  contact_id: string
  sequence: number
  contacts: {
    id: string
    user_id: string
    name: string
    email: string | null
    company: string | null
    status: string | null
    email_unsubscribed_at: string | null
    event_tag: string | null
  } | Array<{
    id: string
    user_id: string
    name: string
    email: string | null
    company: string | null
    status: string | null
    email_unsubscribed_at: string | null
    event_tag: string | null
  }>
}

function firstName(value: string) {
  return String(value || '').trim().split(/\s+/)[0] || ''
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] || char))
}

function paragraphHtml(text: string) {
  const escaped = escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(https:\/\/[^\s<]+)/g, '<a href="$1" style="color:#a85619;text-decoration:underline;">$1</a>')
  return `<p style="margin:0 0 20px;font:16px/1.6 Arial,Helvetica,sans-serif;color:#15243a;text-align:left;">${escaped}</p>`
}

function campaignHtml(template: WineProjectSequenceTemplate) {
  const copy = template.body
    .replaceAll('Buongiorno {{nome}},', '*|GREETING|*')
    .replaceAll('{{nome}}', '*|FIRST_NAME|*')
    .replaceAll('{{azienda}}', '*|COMPANY|*')
  const paragraphs = copy.split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean)
  const body = paragraphs.map((paragraph) => {
    if (paragraph.includes('→ Scoprite come sarebbe la vostra cantina su Speaqi')) {
      return '<p style="margin:28px 0 24px;text-align:left;"><a href="*|WINE_URL|*" style="display:inline-block;background:#132034;color:#ffffff;text-decoration:none;padding:13px 18px;font:600 16px Arial,Helvetica,sans-serif;">Scoprite come sarebbe la vostra cantina su Speaqi →</a></p>'
    }
    return paragraphHtml(paragraph)
  }).join('')

  return `<!doctype html><html><body style="margin:0;background:#ffffff;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="padding:32px 20px;background:#ffffff;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:680px;margin:0;"><tr><td style="padding:0;text-align:left;"><p style="margin:0 0 24px;font:700 13px/1.3 Arial,Helvetica,sans-serif;letter-spacing:1.8px;color:#b66326;">SPEAQI · GLOBAL WINE EXPERIENCE</p>${body}<hr style="border:0;border-top:1px solid #d8dde4;margin:30px 0 20px;"><p style="margin:0;font:14px/1.55 Arial,Helvetica,sans-serif;color:#526174;text-align:left;">Massimo Morgante<br>CEO · Speaqi<br><a href="mailto:massimo@speaqi.com" style="color:#334e70;">massimo@speaqi.com</a> · <a href="https://www.speaqi.com" style="color:#334e70;">www.speaqi.com</a></p><p style="margin:24px 0 0;font:12px/1.5 Arial,Helvetica,sans-serif;color:#6b7280;text-align:left;">Non desidera più ricevere aggiornamenti? <a href="*|UNSUBSCRIBE_URL|*" style="color:#526174;text-decoration:underline;">Si disiscriva qui</a>.</p></td></tr></table></td></tr></table></body></html>`
}

function campaignSubject(template: WineProjectSequenceTemplate) {
  return template.subject
    .replaceAll('{{nome}}', '*|FULL_NAME|*')
    .replaceAll('{{azienda}}', '*|COMPANY|*')
}

function startOfRomeDay(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || ''
  const year = Number(value('year'))
  const month = Number(value('month'))
  const day = Number(value('day'))
  const offset = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Rome', timeZoneName: 'longOffset' })
    .formatToParts(now)
    .find((part) => part.type === 'timeZoneName')?.value || 'GMT+00:00'
  const offsetMatch = offset.match(/^GMT([+-])(\d{2}):(\d{2})$/)
  const offsetMinutes = offsetMatch
    ? (Number(offsetMatch[2]) * 60 + Number(offsetMatch[3])) * (offsetMatch[1] === '+' ? 1 : -1)
    : 0
  return new Date(Date.UTC(year, month - 1, day) - offsetMinutes * 60 * 1000).toISOString()
}

function projectUrl(contact: { name: string; company: string | null }, event: Pick<QueuedEvent, 'id' | 'user_id' | 'contact_id'>) {
  const url = new URL('/demo/wine-project', process.env.WINE_PROJECT_URL || 'https://speaqi.com')
  url.searchParams.set('first_name', firstName(contact.name))
  if (contact.company) url.searchParams.set('company_name', contact.company)
  url.searchParams.set('source', 'acumbamail')
  url.searchParams.set('campaign', 'wine-project-followup')
  url.searchParams.set('utm_source', 'acumbamail')
  url.searchParams.set('utm_medium', 'email')
  url.searchParams.set('utm_campaign', 'wine-project-followup')
  url.searchParams.set('campaign_token', createWineProjectCampaignToken({
    user_id: event.user_id,
    contact_id: event.contact_id,
    event_id: event.id,
  }))
  return url.toString()
}

function closed(contact: { status: string | null; email_unsubscribed_at: string | null; email: string | null }) {
  return !contact.email || Boolean(contact.email_unsubscribed_at) || ['Closed', 'Paid', 'Lost'].includes(String(contact.status || ''))
}

export async function POST(request: NextRequest) {
  if (!validateAutomationSecret(request)) return Response.json({ error: 'Unauthorized automation' }, { status: 401 })
  if (process.env.WINE_PROJECT_CAMPAIGN_SEND_ENABLED !== 'true') {
    return Response.json({ error: 'Wine Project campaign sending disabled' }, { status: 503 })
  }
  const token = process.env.ACUMBAMAIL_AUTH_TOKEN
  if (!token) return Response.json({ error: 'ACUMBAMAIL_AUTH_TOKEN non configurato' }, { status: 500 })

  try {
    const body = await request.json().catch(() => ({}))
    const dryRun = body.dry_run === true
    const limit = Math.min(1000, Math.max(1, Number(body.limit) || 100))
    const supabase = createServiceRoleClient()
    const { data, error } = await supabase
      .from('wine_project_followup_events')
      .select('id,user_id,contact_id,sequence,contacts!inner(id,user_id,name,email,company,status,email_unsubscribed_at,event_tag)')
      .eq('status', 'queued')
      .eq('contacts.event_tag', 'wine-project')
      .order('due_at', { ascending: true })
      .limit(limit)
    if (error) throw error

    const grouped = new Map<string, QueuedEvent[]>()
    for (const event of (data || []) as QueuedEvent[]) {
      const key = `${event.user_id}:${event.sequence}`
      grouped.set(key, [...(grouped.get(key) || []), event])
    }

    const results: Array<Record<string, unknown>> = []
    const remainingByUser = new Map<string, number>()
    for (const [key, events] of grouped) {
      const contacts = events.map((event) => Array.isArray(event.contacts) ? event.contacts[0] : event.contacts).filter(Boolean)
      const eligible = events.filter((event, index) => !closed(contacts[index]))
      const ineligible = events.filter((event, index) => closed(contacts[index]))
      const now = new Date().toISOString()
      if (ineligible.length && !dryRun) {
        await supabase.from('wine_project_followup_events')
          .update({ status: 'skipped', skipped_at: now, skip_reason: 'contatto non piu contattabile' })
          .in('id', ineligible.map((event) => event.id)).eq('status', 'queued')
      }
      if (!eligible.length) {
        results.push({ key, sent: 0, skipped: ineligible.length })
        continue
      }

      const userId = eligible[0].user_id
      const settings = await loadWineProjectAutomationSettings(supabase, userId)
      const template = settings.sequence_templates.find((item) => item.sequence === Number(eligible[0].sequence))
      if (!template || !settings.enabled) {
        results.push({ key, sent: 0, skipped: ineligible.length, reason: 'sequenza non configurata o disattivata' })
        continue
      }
      let remaining = remainingByUser.get(userId)
      if (remaining === undefined) {
        const { count: sentToday, error: sentTodayError } = await supabase
          .from('wine_project_followup_events')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('status', 'sent')
          .gte('sent_at', startOfRomeDay())
        if (sentTodayError) throw sentTodayError
        remaining = Math.max(0, settings.daily_send_cap - (sentToday || 0))
      }
      if (remaining < 1) {
        results.push({ key, sent: 0, skipped: ineligible.length, reason: 'limite giornaliero raggiunto' })
        continue
      }
      const selected = eligible.slice(0, remaining)
      const deferred = eligible.length - selected.length
      const eventIds = selected.map((event) => event.id)
      if (!dryRun) {
        const { data: claimed, error: claimError } = await supabase
          .from('wine_project_followup_events')
          .update({ status: 'sending', sending_at: now, delivery_error: null })
          .in('id', eventIds).eq('status', 'queued').select('id')
        if (claimError) throw claimError
        if ((claimed || []).length !== eventIds.length) {
          results.push({ key, sent: 0, skipped: ineligible.length, reason: 'coda modificata da un altro worker' })
          continue
        }

        // Un form o una risposta possono aver fermato la sequenza mentre
        // questa automazione stava selezionando la coda. Non creare una
        // campagna per eventi che non sono piu effettivamente inviabili.
        const { count: stillSending, error: stillSendingError } = await supabase
          .from('wine_project_followup_events')
          .select('id', { count: 'exact', head: true })
          .in('id', eventIds)
          .eq('status', 'sending')
        if (stillSendingError) throw stillSendingError
        if ((stillSending || 0) !== eventIds.length) {
          results.push({ key, sent: 0, skipped: ineligible.length, reason: 'sequenza interrotta durante la preparazione' })
          continue
        }
      }

      const campaignKey = `wine-project-e${template.sequence}-${new Date().toISOString().slice(0, 10)}-${Math.random().toString(36).slice(2, 7)}`
      const senderEmail = process.env.WINE_PROJECT_FROM_EMAIL || 'info@speaqi.com'
      const senderName = process.env.WINE_PROJECT_FROM_NAME || 'Massimo Morgante | Speaqi'
      const recipients = selected.map((event) => {
        const contact = Array.isArray(event.contacts) ? event.contacts[0] : event.contacts
        const first = firstName(contact.name)
        const fullName = String(contact.name || '').trim() || first
        return {
          email: String(contact.email),
          firstName: first,
          fullName,
          greeting: first ? `Buongiorno ${first},` : 'Buongiorno,',
          company: String(contact.company || 'la vostra cantina'),
          wineUrl: projectUrl(contact, event),
        }
      })

      if (dryRun) {
        remainingByUser.set(userId, remaining - recipients.length)
        results.push({ key, dry_run: true, recipients: recipients.length, deferred, subject: campaignSubject(template), daily_cap: settings.daily_send_cap })
        continue
      }

      try {
        const listId = await createWineProjectRecipientList(token, `Wine Project · Email ${template.sequence}/5 · ${new Date().toISOString().slice(0, 16)}`, senderEmail)
        await addCampaignRecipients(token, listId, recipients)
        const campaignId = await createWineProjectCampaign(token, {
          name: `Wine Project · Email ${template.sequence}/5 · ${new Date().toLocaleDateString('it-IT')}`,
          subject: campaignSubject(template),
          html: campaignHtml(template),
          listId,
          fromName: senderName,
          fromEmail: senderEmail,
        })

        const sentAt = new Date().toISOString()
        await supabase.from('wine_project_followup_events')
          .update({ status: 'sent', sent_at: sentAt, campaign_id: campaignId, campaign_key: campaignKey, delivery_error: null })
          .in('id', eventIds).eq('status', 'sending')
        await supabase.from('acumbamail_campaigns').upsert({
          user_id: userId,
          campaign_key: campaignKey,
          campaign_id: campaignId,
          name: `Wine Project · Email ${template.sequence}/5`,
          list_name: `Wine Project · Email ${template.sequence}/5`,
          min_opens: 1,
          responsible: 'Massimo Morgante',
          updated_at: sentAt,
          last_synced_at: null,
          last_sync_error: null,
        }, { onConflict: 'user_id,campaign_key' })
        await supabase.from('contacts').update({ marketing_status: 'sent', last_contact_at: sentAt, updated_at: sentAt })
          .in('id', selected.map((event) => event.contact_id))
        await createActivities(supabase, selected.map((event) => ({
          user_id: event.user_id,
          contact_id: event.contact_id,
          type: 'wine_followup_sent',
          content: `Wine Project: inviata email ${template.sequence}/5 via Acumbamail (campagna ${campaignId}).`,
          metadata: { campaign_id: campaignId, campaign_key: campaignKey, sequence: template.sequence, provider: 'acumbamail' },
        })))
        remainingByUser.set(userId, remaining - recipients.length)
        results.push({ key, sent: recipients.length, deferred, campaign_id: campaignId, campaign_key: campaignKey, skipped: ineligible.length, daily_cap: settings.daily_send_cap })
      } catch (campaignError) {
        await supabase.from('wine_project_followup_events')
          .update({ status: 'failed', delivery_error: errorMessage(campaignError, 'Invio Acumbamail non riuscito') })
          .in('id', eventIds).eq('status', 'sending')
        throw campaignError
      }
    }
    return Response.json({ ok: true, dry_run: dryRun, groups: results })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Wine Project campaigns failed') }, { status: 500 })
  }
}
