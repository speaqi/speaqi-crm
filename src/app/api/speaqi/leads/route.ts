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

/**
 * Eventi che raccontano la stessa cosa: la cantina (o la struttura) ha
 * compilato la scheda e lasciato i suoi dati. `*_demo_contact` arriva quando la
 * demo e' gia' pronta, `*_form_submitted` subito dopo l'invio del form: se
 * l'analisi fallisce o finisce in revisione la demo non nasce mai, e senza
 * questo secondo evento quel lead non entrava proprio nel CRM.
 */
const WINE_FORM_EVENTS = new Set(['wine_demo_contact', 'wine_form_submitted', 'wine_demo_form'])
const HOSPITALITY_FORM_EVENTS = new Set(['hospitality_demo_contact', 'hospitality_form_submitted'])
const DEMO_READY_EVENTS = new Set(['wine_demo_contact', 'hospitality_demo_contact'])

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

/**
 * L'host del sito analizzato, normalizzato. I link arrivano come capita —
 * senza schema, con le barre rovesciate (`https:\\www.jannamico.com`), con o
 * senza `www` — e un host sbagliato vale come nessun host.
 */
function siteHost(value: unknown) {
  const raw = text(value, 1000).replace(/\\/g, '/')
  if (!raw) return null
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
    return url.hostname.toLowerCase().replace(/^www\./, '') || null
  } catch {
    return null
  }
}

/** Il dominio registrabile: `shop.alfeu.it` e `alfeu.it` sono la stessa cantina. */
function rootHost(host: string | null) {
  if (!host) return null
  const labels = host.split('.')
  return labels.length > 2 ? labels.slice(-2).join('.') : host
}

function demoSummary(body: Record<string, unknown>, vertical: 'wine' | 'hospitality', demoReady: boolean) {
  const resultsCount = Number.isFinite(Number(body.results_count))
    ? Math.max(0, Math.floor(Number(body.results_count)))
    : null
  const wines = Array.isArray(body.wine_names)
    ? body.wine_names.map((item) => text(item, 160)).filter(Boolean).slice(0, 8)
    : []
  const isWine = vertical === 'wine'
  const details = [
    demoReady
      ? `${isWine ? 'Wine' : 'Hospitality'} Project completato: il contatto ha lasciato email e telefono.`
      : `${isWine ? 'Wine' : 'Hospitality'} Project: scheda compilata dal prospect, demo non ancora pronta.`,
    body.company ? `${isWine ? 'Cantina' : 'Struttura'}: ${text(body.company, 160)}.` : null,
    body.source_url ? `Sito analizzato: ${text(body.source_url, 1000)}.` : null,
    resultsCount !== null ? `${isWine ? 'Vini' : 'Informazioni'} importati: ${resultsCount}.` : null,
    wines.length ? `Vini rilevati: ${wines.join(', ')}.` : null,
    body.demo_project_url ? `Demo pronta: ${text(body.demo_project_url, 1000)}.` : null,
  ].filter(Boolean)
  return { summary: details.join(' '), resultsCount, wines }
}

/**
 * La cantina che sta dietro al sito analizzato. Le schede wine-project non
 * hanno `normalized_website` (arrivano da Acumbamail), quindi la strada vera e'
 * il dominio dell'email: `info@cantinecogo.it` e' la scheda di
 * `https://www.cantinecogo.it/`.
 */
async function findContactBySite(
  supabase: ReturnType<typeof createServiceRoleClient>,
  userId: string,
  eventTag: string,
  sourceUrl: unknown,
) {
  const host = siteHost(sourceUrl)
  const candidates = [host, rootHost(host)].filter((value, index, list): value is string =>
    Boolean(value) && list.indexOf(value) === index)
  for (const candidate of candidates) {
    const { data, error } = await supabase
      .from('contacts')
      .select('*')
      .eq('user_id', userId)
      .eq('event_tag', eventTag)
      .or(`email.ilike.%@${candidate},normalized_website.ilike.%${candidate}%`)
      .order('updated_at', { ascending: false })
      .limit(1)
    if (error) throw error
    if (data?.length) return data[0] as Record<string, any>
  }
  return null
}

/** Lo stesso tentativo non conta due volte: il mittente puo' ripetere la chiamata. */
async function hasActivityForAttempt(
  supabase: ReturnType<typeof createServiceRoleClient>,
  userId: string,
  contactId: string,
  type: string,
  attemptId: string | null,
) {
  if (!attemptId) return false
  const { data, error } = await supabase
    .from('activities')
    .select('id')
    .eq('user_id', userId)
    .eq('contact_id', contactId)
    .eq('type', type)
    .contains('metadata', { attempt_id: attemptId })
    .limit(1)
  if (error) throw error
  return Boolean(data?.length)
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

    const supabase = createServiceRoleClient()

    if (isWineLandingClick) {
      if (!campaignToken || campaignToken.user_id !== userId) {
        return Response.json({ error: 'campaign token non valido' }, { status: 400 })
      }
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
    const isWineDemo = WINE_FORM_EVENTS.has(eventType)
    const isHospitalityDemo = HOSPITALITY_FORM_EVENTS.has(eventType)
    const isProjectDemo = isWineDemo || isHospitalityDemo
    const vertical = isWineDemo ? 'wine' : 'hospitality'
    const eventTag = `${vertical}-project`
    const demoReady = isProjectDemo && (DEMO_READY_EVENTS.has(eventType) || Boolean(text(body.demo_project_url)))

    await ensurePipelineStages(supabase, userId)

    // Chi ha compilato la scheda, in ordine di certezza: il token firmato della
    // campagna, l'email, il sito analizzato. Senza la terza strada un form
    // arrivato senza email finiva in un 400 e il lead spariva: e' la ragione
    // per cui il CRM ne contava tre su nove schede davvero compilate.
    let existing: Record<string, any> | null = null
    let matchedBy: 'campaign_token' | 'email' | 'site' | null = null
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
      if (existing) matchedBy = 'campaign_token'
    }
    if (!existing && email) {
      const { data: matches, error: matchError } = await supabase
        .from('contacts')
        .select('*')
        .eq('user_id', userId)
        .ilike('email', email)
        .order('created_at', { ascending: false })
        .limit(1)
      if (matchError) throw matchError
      existing = matches?.[0] || null
      if (existing) matchedBy = 'email'
    }
    if (!existing && isProjectDemo && body.source_url) {
      existing = await findContactBySite(supabase, userId, eventTag, body.source_url)
      if (existing) matchedBy = 'site'
    }

    const contactEmail = email || normalizedEmail(existing?.email)
    if (!contactEmail) {
      return Response.json(
        { error: 'serve email, campaign_token o source_url riconducibile a un contatto' },
        { status: 400 },
      )
    }

    const source = text(body.source, 120) || (isProjectDemo ? eventTag : 'speaqi')
    const name = text(body.name, 160) || text(existing?.name, 160) || contactEmail
    const phone = text(body.phone, 80) || null
    const company = text(body.company, 160) || null
    const category = text(body.category, 120) || (isProjectDemo ? eventTag : null)
    const responsible = text(body.responsible, 160) || null
    const priority = Math.max(0, Math.min(3, Number(body.priority ?? (isProjectDemo ? 3 : 2))))
    const { summary, resultsCount, wines } = demoSummary(body, vertical, demoReady)
    const activityContent = isProjectDemo ? summary : text(body.note, 4000) || 'Lead creato da integrazione inbound.'
    const wineSettings = isWineDemo
      ? await loadWineProjectAutomationSettings(supabase, userId)
      : null
    // L'API Speaqi invia wine_demo_contact SOLO quando la demo e' pronta, ma non
    // propaga il campo reason: trattare il solo reason === 'demo_ready' come
    // conversione lasciava la sequenza attiva per ogni form reale. Un reason
    // esplicito diverso resta rispettato per eventuali mittenti futuri.
    const wineDemoReason = text(body.reason, 80)
    const isWineConversion = isWineDemo &&
      (!wineDemoReason || wineDemoReason === 'demo_ready' || wineDemoReason === 'form_submitted')
    const requestedFollowup = text(body.next_followup_at, 80)
    const nextFollowupAt = requestedFollowup || (wineSettings
      ? wineFollowupDueAt(wineSettings.first_followup_days)
      : nextDay())
    const callDueAt = toCallableSlot(new Date(Date.now() + 24 * 60 * 60 * 1000)).toISOString()

    const isUnsubscribed = Boolean(existing?.email_unsubscribed_at)
    const shouldScheduleFollowup = !isWineConversion && !isUnsubscribed &&
      !['Closed', 'Paid'].includes(String(existing?.status || '')) &&
      (!wineSettings || wineSettings.enabled)
    const desiredStatus = isProjectDemo && !isUnsubscribed ? 'Interested' : (existing?.status || 'New')
    const contactPayload = {
      name: name || existing?.name || contactEmail,
      email: contactEmail,
      phone: phone || existing?.phone || null,
      company: company || existing?.company || null,
      category: category || existing?.category || null,
      source: existing?.source || source,
      contact_scope: 'crm',
      status: desiredStatus,
      priority: Math.max(Number(existing?.priority || 0), priority),
      responsible: responsible || existing?.responsible || null,
      assigned_agent: responsible || existing?.assigned_agent || null,
      event_tag: isProjectDemo ? eventTag : (existing?.event_tag || null),
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
          demoReady ? 'Wine Project completato: chiamata prioritaria.' : 'Wine Project: scheda compilata, chiamata prioritaria.',
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

    const attemptId = text(body.attempt_id, 120) || null
    const activityMetadata = {
      provider: 'speaqi',
      event_type: eventType,
      attempt_id: attemptId,
      activity_id: text(body.activity_id, 120) || null,
      demo_project_url: text(body.demo_project_url, 1000) || null,
      source_url: text(body.source_url, 1000) || null,
      results_count: resultsCount,
      wine_names: wines,
      campaign: text(body.campaign, 160) || null,
      campaign_event_id: campaignToken?.event_id || null,
      campaign_recipient_email: existing?.email || null,
      submitted_email: isWineConversion ? email : null,
      matched_by: matchedBy,
      demo_ready: demoReady,
      stopped_followups: stopped?.stopped || 0,
    }
    // Form e demo si contano una volta per tentativo: il form puo' arrivare
    // prima (scheda compilata) e la demo dopo, con lo stesso attempt_id.
    const [formAlreadyLogged, demoAlreadyLogged] = await Promise.all([
      isWineConversion
        ? hasActivityForAttempt(supabase, userId, contact.id, 'demo_form_submitted', attemptId)
        : Promise.resolve(true),
      isWineConversion && demoReady
        ? hasActivityForAttempt(supabase, userId, contact.id, 'demo_ready', attemptId)
        : Promise.resolve(true),
    ])
    await createActivities(supabase, [
      ...(isWineConversion && !formAlreadyLogged ? [{
        user_id: userId,
        contact_id: contact.id,
        type: 'demo_form_submitted',
        content: 'Wine Project: form compilato con sito, email e telefono.',
        metadata: activityMetadata,
      }] : []),
      ...(isWineConversion && demoReady && !demoAlreadyLogged ? [{
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

    return Response.json(
      { contact, task, plan, stopped, created, event_type: eventType, matched_by: matchedBy, demo_ready: demoReady },
      { status: created ? 201 : 200 },
    )
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to ingest Speaqi lead' },
      { status: 500 }
    )
  }
}
