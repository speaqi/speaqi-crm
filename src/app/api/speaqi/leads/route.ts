import { NextRequest } from 'next/server'
import {
  createActivities,
  ensurePipelineStages,
  syncPendingCallTask,
  updateContactSummary,
} from '@/lib/server/crm'
import { createServiceRoleClient } from '@/lib/server/supabase'
import {
  loadWineProjectAutomationSettings,
  planWineProjectFollowups,
  stopWineProjectFollowups,
  wineFollowupDueAt,
} from '@/lib/server/wine-project-automation'
import { verifyWineProjectCampaignToken } from '@/lib/server/wine-project-campaign-token'
import { toCallableSlot } from '@/lib/sla'

function unauthorized() {
  return Response.json({ error: 'Unauthorized webhook' }, { status: 401 })
}

function text(value: unknown, max = 500) {
  return String(value || '').trim().slice(0, max)
}

function normalizedEmail(value: unknown) {
  const email = text(value, 320).toLowerCase()
  return email || null
}

function nextDay() {
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
}

function demoSummary(body: Record<string, unknown>, vertical: 'wine' | 'hospitality') {
  const resultsCount = Number.isFinite(Number(body.results_count))
    ? Math.max(0, Math.floor(Number(body.results_count)))
    : null
  const wines = Array.isArray(body.wine_names)
    ? body.wine_names.map((item) => text(item, 160)).filter(Boolean).slice(0, 8)
    : []
  const isWine = vertical === 'wine'
  const details = [
    `${isWine ? 'Wine' : 'Hospitality'} Project completato: il contatto ha lasciato email e telefono.`,
    body.company ? `${isWine ? 'Cantina' : 'Struttura'}: ${text(body.company, 160)}.` : null,
    body.source_url ? `Sito analizzato: ${text(body.source_url, 1000)}.` : null,
    resultsCount !== null ? `${isWine ? 'Vini' : 'Informazioni'} importati: ${resultsCount}.` : null,
    wines.length ? `Vini rilevati: ${wines.join(', ')}.` : null,
    body.demo_project_url ? `Demo pronta: ${text(body.demo_project_url, 1000)}.` : null,
  ].filter(Boolean)
  return { summary: details.join(' '), resultsCount, wines }
}

export async function POST(request: NextRequest) {
  const secret = process.env.SPEAQI_WEBHOOK_SECRET
  if (!secret || request.headers.get('x-webhook-secret') !== secret) {
    return unauthorized()
  }

  try {
    const body = (await request.json()) as Record<string, unknown>
    const userId = text(body.user_id, 80)
    const eventType = text(body.event_type, 80) || 'inbound_lead'
    const isWineLandingClick = eventType === 'wine_landing_clicked'
    const campaignToken = verifyWineProjectCampaignToken(text(body.campaign_token, 1200))

    if (!userId) return Response.json({ error: 'user_id is required' }, { status: 400 })

    if (isWineLandingClick) {
      if (!campaignToken || campaignToken.user_id !== userId) {
        return Response.json({ error: 'campaign token non valido' }, { status: 400 })
      }
      const supabase = createServiceRoleClient()
      const { data: contact, error: contactError } = await supabase
        .from('contacts')
        .select('id,user_id,email_click_count,last_email_click_at')
        .eq('user_id', userId)
        .eq('id', campaignToken.contact_id)
        .eq('event_tag', 'wine-project')
        .maybeSingle()
      if (contactError) throw contactError
      if (!contact) return Response.json({ error: 'contatto Wine non trovato' }, { status: 404 })

      const { data: duplicate, error: duplicateError } = await supabase
        .from('activities')
        .select('id')
        .eq('user_id', userId)
        .eq('contact_id', contact.id)
        .eq('type', 'landing_clicked')
        .contains('metadata', { campaign_event_id: campaignToken.event_id })
        .limit(1)
      if (duplicateError) throw duplicateError
      const clickedAt = new Date().toISOString()
      if (!duplicate?.length) {
        await createActivities(supabase, [{
          user_id: userId,
          contact_id: contact.id,
          type: 'landing_clicked',
          content: 'Wine Project: landing aperta dalla campagna email.',
          metadata: { source: 'wine_campaign_link', campaign_event_id: campaignToken.event_id },
        }])
      }
      const { error: clickUpdateError } = await supabase
        .from('contacts')
        .update({
          email_click_count: Math.max(1, Number(contact.email_click_count || 0)),
          last_email_click_at: clickedAt,
          updated_at: clickedAt,
        })
        .eq('user_id', userId)
        .eq('id', contact.id)
      if (clickUpdateError) throw clickUpdateError
      return Response.json({ ok: true, contact_id: contact.id, duplicate: Boolean(duplicate?.length) })
    }

    const email = normalizedEmail(body.email)
    if (!email) return Response.json({ error: 'email is required' }, { status: 400 })

    const isWineDemo = eventType === 'wine_demo_contact'
    const isHospitalityDemo = eventType === 'hospitality_demo_contact'
    const isProjectDemo = isWineDemo || isHospitalityDemo
    const vertical = isWineDemo ? 'wine' : 'hospitality'
    const source = text(body.source, 120) || (isProjectDemo ? `${vertical}-project` : 'speaqi')
    const name = text(body.name, 160) || email
    const phone = text(body.phone, 80) || null
    const company = text(body.company, 160) || null
    const category = text(body.category, 120) || (isProjectDemo ? `${vertical}-project` : null)
    const responsible = text(body.responsible, 160) || null
    const priority = Math.max(0, Math.min(3, Number(body.priority ?? (isProjectDemo ? 3 : 2))))
    const { summary, resultsCount, wines } = demoSummary(body, vertical)
    const activityContent = isProjectDemo ? summary : text(body.note, 4000) || 'Lead creato da integrazione inbound.'
    const supabase = createServiceRoleClient()
    const wineSettings = isWineDemo
      ? await loadWineProjectAutomationSettings(supabase, userId)
      : null
    const isWineConversion = isWineDemo && text(body.reason, 80) === 'demo_ready'
    const requestedFollowup = text(body.next_followup_at, 80)
    const nextFollowupAt = requestedFollowup || (wineSettings
      ? wineFollowupDueAt(wineSettings.first_followup_days)
      : nextDay())
    const callDueAt = toCallableSlot(new Date(Date.now() + 24 * 60 * 60 * 1000)).toISOString()

    await ensurePipelineStages(supabase, userId)

    let existing: Record<string, any> | null = null
    if (isWineDemo && campaignToken?.user_id === userId) {
      const { data: campaignContact, error: campaignContactError } = await supabase
        .from('contacts')
        .select('*')
        .eq('user_id', userId)
        .eq('id', campaignToken.contact_id)
        .eq('event_tag', 'wine-project')
        .maybeSingle()
      if (campaignContactError) throw campaignContactError
      existing = campaignContact || null
    }
    if (!existing) {
      const { data: matches, error: matchError } = await supabase
        .from('contacts')
        .select('*')
        .eq('user_id', userId)
        .ilike('email', email)
        .order('created_at', { ascending: false })
        .limit(1)
      if (matchError) throw matchError
      existing = matches?.[0] || null
    }

    const isUnsubscribed = Boolean(existing?.email_unsubscribed_at)
    const shouldScheduleFollowup = !isWineConversion && !isUnsubscribed &&
      !['Closed', 'Paid'].includes(String(existing?.status || '')) &&
      (!wineSettings || wineSettings.enabled)
    const desiredStatus = isProjectDemo && !isUnsubscribed ? 'Interested' : (existing?.status || 'New')
    const contactPayload = {
      name: name || existing?.name || email,
      email,
      phone: phone || existing?.phone || null,
      company: company || existing?.company || null,
      category: category || existing?.category || null,
      source: existing?.source || source,
      contact_scope: 'crm',
      status: desiredStatus,
      priority: Math.max(Number(existing?.priority || 0), priority),
      responsible: responsible || existing?.responsible || null,
      assigned_agent: responsible || existing?.assigned_agent || null,
      event_tag: isProjectDemo ? `${vertical}-project` : (existing?.event_tag || null),
      list_name: isProjectDemo ? `${isWineDemo ? 'Wine' : 'Hospitality'} Demo` : (existing?.list_name || null),
      last_activity_summary: activityContent.slice(0, 180),
      next_action_at: isWineConversion ? callDueAt : shouldScheduleFollowup ? nextFollowupAt : existing?.next_action_at || null,
      next_followup_at: isWineConversion ? callDueAt : shouldScheduleFollowup ? nextFollowupAt : existing?.next_followup_at || null,
      updated_at: new Date().toISOString(),
    }

    let contact: any = existing
    let created = false
    if (existing) {
      const { data, error } = await supabase
        .from('contacts')
        .update(contactPayload)
        .eq('id', existing.id)
        .select('*')
        .single()
      if (error) throw error
      contact = data
    } else {
      const { data, error } = await supabase
        .from('contacts')
        .insert({
          user_id: userId,
          ...contactPayload,
          status: isProjectDemo ? 'Interested' : 'New',
          source,
          note: text(body.note, 4000) || null,
        })
        .select('*')
        .single()
      if (error) throw error
      contact = data
      created = true
    }

    const stopped = isWineConversion
      ? await stopWineProjectFollowups(supabase, userId, contact.id, 'demo Wine completata dal prospect')
      : null
    const plan = isWineDemo && shouldScheduleFollowup && wineSettings
      ? await planWineProjectFollowups(supabase, contact, wineSettings)
      : null
    const task = isWineConversion
      ? await syncPendingCallTask(supabase, userId, contact.id, callDueAt, {
        type: 'call',
        priority: 'high',
        note: [
          'Wine Project completato: chiamata prioritaria.',
          company ? `Cantina: ${company}.` : null,
          phone ? `Telefono: ${phone}.` : null,
          body.source_url ? `Sito: ${text(body.source_url, 1000)}.` : null,
          resultsCount !== null ? `Vini importati: ${resultsCount}.` : null,
          wines.length ? `Vini: ${wines.join(', ')}.` : null,
          body.demo_project_url ? `Demo: ${text(body.demo_project_url, 1000)}` : null,
        ].filter(Boolean).join(' '),
        overwriteNote: true,
      })
      : shouldScheduleFollowup && !isWineDemo
      ? await syncPendingCallTask(supabase, userId, contact.id, nextFollowupAt, {
        type: 'follow-up',
        priority: Number(contact.priority || 0) >= 3 ? 'high' : Number(contact.priority || 0) >= 2 ? 'medium' : 'low',
        note: isHospitalityDemo
          ? 'Hospitality Project completato: contattare la struttura entro 24 ore.'
          : 'Primo contatto generato automaticamente dal canale inbound.',
        overwriteNote: false,
      })
      : null

    const activityMetadata = {
      provider: 'speaqi',
      event_type: eventType,
      attempt_id: text(body.attempt_id, 120) || null,
      activity_id: text(body.activity_id, 120) || null,
      demo_project_url: text(body.demo_project_url, 1000) || null,
      source_url: text(body.source_url, 1000) || null,
      results_count: resultsCount,
      wine_names: wines,
      campaign: text(body.campaign, 160) || null,
      campaign_event_id: campaignToken?.event_id || null,
      campaign_recipient_email: existing?.email || null,
      submitted_email: isWineConversion ? email : null,
      stopped_followups: stopped?.stopped || 0,
    }
    await createActivities(supabase, [
      ...(isWineConversion ? [{
        user_id: userId,
        contact_id: contact.id,
        type: 'demo_form_submitted',
        content: 'Wine Project: form compilato con sito, email e telefono.',
        metadata: activityMetadata,
      }, {
        user_id: userId,
        contact_id: contact.id,
        type: 'demo_ready',
        content: 'Wine Project: demo pronta e rilanci automatici interrotti.',
        metadata: activityMetadata,
      }] : []),
      {
      user_id: userId,
      contact_id: contact.id,
      type: isWineDemo ? 'wine_demo' : isHospitalityDemo ? 'hospitality_demo' : created ? 'import' : 'note',
      content: activityContent,
      metadata: activityMetadata,
    }])

    await updateContactSummary(supabase, contact.id, activityContent, {
      nextFollowupAt: isWineConversion ? callDueAt : shouldScheduleFollowup ? nextFollowupAt : undefined,
      touchLastContactAt: isProjectDemo,
    })

    return Response.json({ contact, task, plan, stopped, created, event_type: eventType }, { status: created ? 201 : 200 })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to ingest Speaqi lead' },
      { status: 500 }
    )
  }
}
