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
  wineFollowupDueAt,
} from '@/lib/server/wine-project-automation'

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
    const email = normalizedEmail(body.email)
    const eventType = text(body.event_type, 80) || 'inbound_lead'

    if (!userId) return Response.json({ error: 'user_id is required' }, { status: 400 })
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
    const requestedFollowup = text(body.next_followup_at, 80)
    const nextFollowupAt = requestedFollowup || (wineSettings
      ? wineFollowupDueAt(wineSettings.first_followup_days)
      : nextDay())

    await ensurePipelineStages(supabase, userId)

    const { data: matches, error: matchError } = await supabase
      .from('contacts')
      .select('*')
      .eq('user_id', userId)
      .ilike('email', email)
      .order('created_at', { ascending: false })
      .limit(1)
    if (matchError) throw matchError

    const existing = matches?.[0] || null
    const isUnsubscribed = Boolean(existing?.email_unsubscribed_at)
    const shouldScheduleFollowup = !isUnsubscribed &&
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
      next_action_at: shouldScheduleFollowup ? nextFollowupAt : existing?.next_action_at || null,
      next_followup_at: shouldScheduleFollowup ? nextFollowupAt : existing?.next_followup_at || null,
      updated_at: new Date().toISOString(),
    }

    let contact = existing
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

    const plan = isWineDemo && shouldScheduleFollowup && wineSettings
      ? await planWineProjectFollowups(supabase, contact, wineSettings)
      : null
    const task = shouldScheduleFollowup && !isWineDemo
      ? await syncPendingCallTask(supabase, userId, contact.id, nextFollowupAt, {
        type: 'follow-up',
        priority: Number(contact.priority || 0) >= 3 ? 'high' : Number(contact.priority || 0) >= 2 ? 'medium' : 'low',
        note: isHospitalityDemo
          ? 'Hospitality Project completato: contattare la struttura entro 24 ore.'
          : 'Primo contatto generato automaticamente dal canale inbound.',
        overwriteNote: false,
      })
      : null

    await createActivities(supabase, [{
      user_id: userId,
      contact_id: contact.id,
      type: isWineDemo ? 'wine_demo' : isHospitalityDemo ? 'hospitality_demo' : created ? 'import' : 'note',
      content: activityContent,
      metadata: {
        provider: 'speaqi',
        event_type: eventType,
        attempt_id: text(body.attempt_id, 120) || null,
        activity_id: text(body.activity_id, 120) || null,
        demo_project_url: text(body.demo_project_url, 1000) || null,
        source_url: text(body.source_url, 1000) || null,
        results_count: resultsCount,
        wine_names: wines,
        campaign: text(body.campaign, 160) || null,
      },
    }])

    await updateContactSummary(supabase, contact.id, activityContent, {
      nextFollowupAt: shouldScheduleFollowup ? nextFollowupAt : undefined,
      touchLastContactAt: isProjectDemo,
    })

    return Response.json({ contact, task, plan, created, event_type: eventType }, { status: created ? 201 : 200 })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to ingest Speaqi lead' },
      { status: 500 }
    )
  }
}
