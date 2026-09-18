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
import { sendContactEmail } from '@/lib/server/gmail'
import { recordWhatsappEvent } from '@/lib/server/whatsapp-notify'
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

/**
 * Email alla cantina quando la demo e pronta.
 *
 * Il form viene compilato sulla landing e la demo esiste da subito, ma finora
 * dal CRM non usciva niente: la cantina restava senza il link e senza una
 * risposta, e il solo segnale era un task di chiamata che poteva aspettare
 * ore. Il testo resta corto di proposito — il contenuto e il link, e la
 * telefonata che arriva dopo fa il resto.
 *
 * Apertura con la presentazione del mittente, come ogni altra email del CRM
 * (`EMAIL_SENDER_*` in `src/lib/email-ai-framework.ts`).
 */
function wineDemoEmail(input: { firstName: string; company: string | null; demoUrl: string }) {
  const greeting = input.firstName ? `Buongiorno ${input.firstName},` : 'Buongiorno,'
  const subject = input.company
    ? `La demo Speaqi di ${input.company} è pronta`
    : 'La sua demo Speaqi è pronta'
  const paragraphs = [
    greeting,
    'sono Massimo Morgante, fondatore di Speaqi.',
    input.company
      ? `La pagina che avete richiesto per ${input.company} è pronta: qui sotto trovate il link per vederla.`
      : 'La pagina che avete richiesto è pronta: qui sotto trovate il link per vederla.',
    input.demoUrl,
    'È una demo costruita sui vostri contenuti, quindi la trovate già con i vostri vini e la vostra storia. Se qualcosa non torna, me lo scriva: la sistemiamo insieme.',
    'Nei prossimi giorni la chiamo per capire se ha senso portarla avanti.',
  ]
  // Non `text`: quel nome e gia la funzione di normalizzazione del modulo.
  const plain = paragraphs.join('\n\n')
  const html = paragraphs
    .map((paragraph) =>
      paragraph === input.demoUrl
        ? `<p style="margin:24px 0;"><a href="${paragraph}" style="display:inline-block;background:#132034;color:#ffffff;text-decoration:none;padding:13px 18px;font:600 16px Arial,Helvetica,sans-serif;">Guardi la demo →</a></p>`
        : `<p style="margin:0 0 16px;font:16px/1.6 Arial,Helvetica,sans-serif;color:#15243a;">${paragraph}</p>`
    )
    .join('')
  return { subject, text: plain, html }
}

/**
 * Consegna la demo: email alla cantina e notifica immediata a chi la richiama.
 *
 * Le due cose sono indipendenti apposta. La notifica deve partire anche quando
 * l'email non parte (Gmail scollegato, nessun link demo nel payload): sapere
 * che una cantina ha compilato il form vale a prescindere, ed e' proprio il
 * caso in cui serve intervenire a mano. Per lo stesso motivo niente qui puo
 * far fallire la rotta: il contatto e il task sono gia stati scritti, e un
 * errore di consegna non deve far ritentare al mittente tutto l'ingest.
 */
async function deliverWineDemo(
  supabase: any,
  userId: string,
  contact: Record<string, any>,
  demoUrl: string | null
) {
  const emailEnabled = String(process.env.WINE_DEMO_EMAIL_ENABLED || 'true').trim().toLowerCase() !== 'false'
  let emailSent = false
  let emailError: string | null = null

  if (demoUrl && contact.email && emailEnabled) {
    try {
      const message = wineDemoEmail({
        firstName: String(contact.name || '').trim().split(/\s+/)[0] || '',
        company: String(contact.company || '').trim() || null,
        demoUrl,
      })
      // `sendContactEmail` tiene insieme invio, `email_logs`, activity e coda
      // WhatsApp: passare da qui evita di riscrivere quella catena a mano.
      await sendContactEmail(supabase, userId, contact as any, {
        subject: message.subject,
        html: message.html,
        text: message.text,
        // Il follow-up lo decide gia la chiamata prioritaria creata sopra:
        // sovrascriverlo qui la sposterebbe in avanti.
        followupAt: null,
      })
      emailSent = true
    } catch (error) {
      emailError = error instanceof Error ? error.message : 'Invio demo non riuscito'
      console.error('speaqi/leads: email demo Wine non inviata', emailError)
    }
  } else if (!demoUrl) {
    emailError = 'demo_project_url assente nel payload'
  } else if (!emailEnabled) {
    emailError = 'WINE_DEMO_EMAIL_ENABLED=false'
  }

  await recordWhatsappEvent(supabase, {
    userId,
    type: 'wine_demo_ready',
    contact: contact as any,
    detail: [
      'Form compilato: demo pronta.',
      contact.phone ? `Tel: ${contact.phone}` : null,
      demoUrl,
      emailSent ? 'Email con il link inviata.' : `Email NON inviata (${emailError || 'motivo sconosciuto'}).`,
    ].filter(Boolean).join(' '),
    campaign: 'Wine Project',
    source: 'wine_demo',
  })

  return { email_sent: emailSent, email_error: emailError }
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
    // L'API Speaqi invia wine_demo_contact SOLO quando la demo e' pronta, ma non
    // propaga il campo reason: trattare il solo reason === 'demo_ready' come
    // conversione lasciava la sequenza attiva per ogni form reale. Un reason
    // esplicito diverso resta rispettato per eventuali mittenti futuri.
    const wineDemoReason = text(body.reason, 80)
    const isWineConversion = isWineDemo && (!wineDemoReason || wineDemoReason === 'demo_ready')
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

    // Una demo pronta smetteva qui: nessuna email alla cantina e nessuna
    // notifica a chi deve chiamarla. Restava solo un task in una lista, che
    // nel frattempo si era gia riempita di altro.
    const demoDelivery = isWineConversion
      ? await deliverWineDemo(supabase, userId, contact, text(body.demo_project_url, 1000) || null)
      : null

    return Response.json({ contact, task, plan, stopped, created, event_type: eventType, demo_delivery: demoDelivery }, { status: created ? 201 : 200 })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to ingest Speaqi lead' },
      { status: 500 }
    )
  }
}
