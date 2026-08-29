import { createHash } from 'node:crypto'

export const HOSPITALITY_CAMPAIGN_NAME = 'Hospitality Italia 2026 · Sequenza 5 email'
export const HOSPITALITY_EVENT_TAG = 'hospitality-project'

const RAI3_URL = 'https://www.rainews.it/tgr/campania/video/2025/03/tgr-campania-web-speaqi-rai3-innovazione-turismo-2f17c632-0282-4ab9-a64b-73533dc6a327.html'
const DEMO_URL = 'https://speaqi.com/demo/hotel-project'

const steps = [
  {
    step_number: 1,
    day_offset: 1,
    only_without_engagement: false,
    subject_template: '{{azienda}} - All\'attenzione di {{nome}}',
    body: `{{saluto}}\n\nSpeaqi trasforma le informazioni già presenti sul sito di {{azienda}} in un'esperienza digitale multilingua per gli ospiti.\n\nCheck-in, servizi, ristorazione, wellness, territorio e assistenza diventano consultabili da un solo QR, con un AI Concierge che risponde usando esclusivamente le informazioni della struttura.\n\nPuò vedere gratuitamente una demo preparata dal vostro sito: {{demo_url}}\n\nCordiali saluti,\nMassimo Morgante\nCEO · Speaqi\n+39 389 686 8162\ninfo@speaqi.com`,
  },
  {
    step_number: 2,
    day_offset: 4,
    only_without_engagement: true,
    subject_template: '{{azienda}} - All\'attenzione di {{nome}}',
    body: `{{saluto}}\n\nLe riscrivo con un esempio semplice: un ospite inquadra il QR in camera e trova subito orari, servizi, ristorante, spa, indicazioni e risposte nella propria lingua.\n\nSpeaqi importa automaticamente le informazioni pubbliche del sito della struttura, così la prima demo è già pronta senza un progetto tecnico iniziale.\n\nPuò provarla qui: {{demo_url}}\n\nCordiali saluti,\nMassimo Morgante\nCEO · Speaqi\n+39 389 686 8162\ninfo@speaqi.com`,
  },
  {
    step_number: 3,
    day_offset: 9,
    only_without_engagement: false,
    subject_template: '{{azienda}} - All\'attenzione di {{nome}}',
    body: `{{saluto}}\n\nPensiamo all'arrivo di un ospite internazionale: prima del check-in può già capire come raggiungere la struttura; durante il soggiorno trova servizi e territorio; quando serve, il Concierge risponde 24 ore su 24 nella sua lingua.\n\nLa struttura mantiene una sola base informativa, riutilizzata su pagina web, QR e AI Concierge.\n\nEcco la demo gratuita: {{demo_url}}\n\nCordiali saluti,\nMassimo Morgante\nCEO · Speaqi\n+39 389 686 8162\ninfo@speaqi.com`,
  },
  {
    step_number: 4,
    day_offset: 16,
    only_without_engagement: false,
    subject_template: '{{azienda}} - All\'attenzione di {{nome}}',
    body: `{{saluto}}\n\nAccogliere bene un ospite internazionale significa rendere le informazioni comprensibili, aggiornate e disponibili nel momento giusto.\n\nSpeaqi nasce per centralizzare la conoscenza e distribuirla automaticamente in più lingue. Rai 3 ha raccontato il progetto in un servizio dedicato all'innovazione nel turismo: {{rai3_url}}\n\nPuò vedere come funzionerebbe per {{azienda}} qui: {{demo_url}}\n\nCordiali saluti,\nMassimo Morgante\nCEO · Speaqi\n+39 389 686 8162\ninfo@speaqi.com`,
  },
  {
    step_number: 5,
    day_offset: 28,
    only_without_engagement: false,
    subject_template: '{{azienda}} - All\'attenzione di {{nome}}',
    body: `{{saluto}}\n\nChiudo qui i miei messaggi per non disturbarla oltre.\n\nSe desidera vedere una demo gratuita dell'esperienza ospite di {{azienda}}, può prepararla dal sito della struttura: {{demo_url}}\n\nResto volentieri disponibile se vorrà approfondire in futuro.\n\nCordiali saluti,\nMassimo Morgante\nCEO · Speaqi\n+39 389 686 8162\ninfo@speaqi.com`,
  },
]

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function textToLeftAlignedHtml(value: string) {
  return `<div style="font-family:Arial,sans-serif;color:#101828;line-height:1.55;text-align:left;background:#fff;">${value
    .split(/\n\n+/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('')}</div>`
}

function reliableFullName(contact: { name?: string | null; company?: string | null; email?: string | null }) {
  const name = String(contact.name || '').trim().replace(/\s+/g, ' ')
  if (!name || name === contact.company || name === contact.email || /[@\d/_]/.test(name)) return ''
  if (/^(?:info|booking|reception|hotel|albergo|agriturismo|staff|contatto|commerciale|marketing)\b/i.test(name)) return ''
  return name
}

function templateValues(contact: { name?: string | null; company?: string | null; email?: string | null }) {
  const fullName = reliableFullName(contact)
  const firstName = fullName.split(' ')[0] || ''
  const company = String(contact.company || contact.name || '').trim() || 'la vostra struttura'
  return {
    nome: fullName,
    azienda: company,
    saluto: firstName ? `Buongiorno ${firstName},` : 'Buongiorno,',
    demo_url: DEMO_URL,
    rai3_url: RAI3_URL,
  }
}

function render(template: string, values: Record<string, string>) {
  return template.replace(/{{\s*([a-z0-9_]+)\s*}}/gi, (_, key) => values[key] || '')
    .replace(/\s+- All'attenzione di\s*$/i, '')
}

export function hospitalityStepTemplates() {
  return steps.map(({ body, ...step }) => ({
    ...step,
    body_text_template: body,
    body_html_template: textToLeftAlignedHtml(body),
  }))
}

export function renderCommercialMessage(
  step: { subject_template: string; body_text_template: string },
  contact: { name?: string | null; company?: string | null; email?: string | null }
) {
  const values = templateValues(contact)
  const subject = render(step.subject_template, values).trim()
  const text = render(step.body_text_template, values).trim()
  return { subject, text, html: textToLeftAlignedHtml(text) }
}

export function structureKey(contact: { source_place_id?: string | null; source_google_id?: string | null; normalized_website?: string | null; email?: string | null }) {
  if (contact.source_place_id) return `place:${contact.source_place_id}`
  if (contact.source_google_id) return `google:${contact.source_google_id}`
  if (contact.normalized_website) {
    try { return `site:${new URL(contact.normalized_website).hostname.toLowerCase().replace(/^www\./, '')}` } catch {}
  }
  return `email:${String(contact.email || '').trim().toLowerCase()}`
}

export async function ensureHospitalityCampaign(supabase: any, userId: string) {
  const { data: existing, error: readError } = await supabase.from('commercial_campaigns').select('*')
    .eq('user_id', userId).eq('vertical', 'hospitality').eq('name', HOSPITALITY_CAMPAIGN_NAME).maybeSingle()
  if (readError) throw readError
  let campaign = existing
  if (!campaign) {
    const created = await supabase.from('commercial_campaigns').insert({
      user_id: userId, vertical: 'hospitality', name: HOSPITALITY_CAMPAIGN_NAME,
      list_name: 'Hospitality Italia 2026', event_tag: HOSPITALITY_EVENT_TAG,
      status: 'paused', approval_status: 'analysis', daily_cap: 100,
      sender_name: 'Massimo Morgante', sender_email: 'info@speaqi.com',
    }).select('*').single()
    if (created.error) throw created.error
    campaign = created.data
  }
  const rows = hospitalityStepTemplates().map((step) => ({ campaign_id: campaign.id, ...step }))
  const upsert = await supabase.from('commercial_campaign_steps').upsert(rows, { onConflict: 'campaign_id,step_number' })
  if (upsert.error) throw upsert.error
  return campaign
}

export async function enrollEligibleHospitalityContacts(supabase: any, campaign: any, limit = 500, dryRun = true) {
  const requested = Math.min(5000, Math.max(1, limit))
  const { data: existing, error: existingError } = await supabase.from('commercial_enrollments')
    .select('contact_id,structure_key,primary_email').eq('campaign_id', campaign.id)
  if (existingError) throw existingError
  const enrolled = new Set((existing || []).map((row: any) => row.contact_id))
  const enrolledStructures = new Set((existing || []).map((row: any) => row.structure_key).filter(Boolean))
  const enrolledEmails = new Set((existing || []).map((row: any) => String(row.primary_email || '').toLowerCase()).filter(Boolean))
  const candidates: any[] = []
  let cursor = ''

  // Keyset pagination prevents an already-enrolled first page from starving all
  // later contacts. Keep scanning until the requested number of new structures
  // is found or the source is exhausted.
  while (candidates.length < requested) {
    let query = supabase.from('contacts')
      .select('id,email,alternative_emails,source_place_id,source_google_id,normalized_website')
      .eq('user_id', campaign.user_id).eq('event_tag', HOSPITALITY_EVENT_TAG)
      .eq('contact_scope', 'holding').eq('marketing_eligibility', 'eligible')
      .eq('hospitality_filter_decision', 'include').is('email_unsubscribed_at', null)
      .not('marketing_legal_basis', 'is', null).not('marketing_source_acquired_at', 'is', null)
      .order('id', { ascending: true }).limit(500)
    if (cursor) query = query.gt('id', cursor)
    const { data: page, error } = await query
    if (error) throw error
    if (!page?.length) break
    cursor = page[page.length - 1].id
    for (const contact of page) {
      if (!contact.email || enrolled.has(contact.id)) continue
      const email = String(contact.email).toLowerCase()
      if (enrolledEmails.has(email)) continue
      const key = structureKey(contact)
      if (enrolledStructures.has(key)) continue
      candidates.push(contact)
      enrolledStructures.add(key)
      enrolledEmails.add(email)
      if (candidates.length >= requested) break
    }
    if (page.length < 500) break
  }
  if (dryRun || !candidates.length) return { candidates: candidates.length, inserted: 0 }
  const now = Date.now()
  const enrollments = candidates.map((contact: any) => ({
    campaign_id: campaign.id, contact_id: contact.id, structure_key: structureKey(contact),
    primary_email: String(contact.email).toLowerCase(), active_email: String(contact.email).toLowerCase(),
    status: 'pending', next_step_at: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
  }))
  const inserted = await supabase.from('commercial_enrollments').insert(enrollments).select('id,contact_id,next_step_at')
  if (inserted.error) throw inserted.error
  const messages = inserted.data.map((enrollment: any) => ({
    enrollment_id: enrollment.id, step_number: 1, recipient_email: enrollments.find((row: any) => row.contact_id === enrollment.contact_id)!.active_email,
    scheduled_at: enrollment.next_step_at, status: 'scheduled',
  }))
  const messageInsert = await supabase.from('commercial_messages').insert(messages)
  if (messageInsert.error) throw messageInsert.error
  return { candidates: candidates.length, inserted: inserted.data.length }
}

export async function applyCommercialEmailEvent(supabase: any, userId: string, event: { event: string; email: string; occurredAt: string }) {
  const { data: enrollments, error } = await supabase.from('commercial_enrollments')
    .select('*,commercial_campaigns!inner(id,user_id,stop_on_open,stop_on_click,automatic_pause_bounce_rate,automatic_pause_complaint_rate),contacts!inner(id,alternative_emails)')
    .eq('commercial_campaigns.user_id', userId).eq('active_email', event.email).in('status', ['pending', 'active'])
  // The generic Acumbamail webhook is already live. During a rolling deploy it
  // must keep working even if this new migration has not been applied yet.
  if (error && String(error.code || '') === '42P01') return 0
  if (error) throw error
  let updated = 0
  for (const enrollment of enrollments || []) {
    const enrollmentUpdates: Record<string, unknown> = {}
    const messageUpdates: Record<string, unknown> = {}
    if (event.event === 'opens') { enrollmentUpdates.opened_at = event.occurredAt; messageUpdates.opened_at = event.occurredAt }
    if (event.event === 'clicks') { enrollmentUpdates.clicked_at = event.occurredAt; messageUpdates.clicked_at = event.occurredAt }
    if ((event.event === 'opens' && enrollment.commercial_campaigns?.stop_on_open) || (event.event === 'clicks' && enrollment.commercial_campaigns?.stop_on_click)) {
      Object.assign(enrollmentUpdates, { status: 'stopped', stop_reason: event.event === 'opens' ? 'opened' : 'clicked', stopped_at: event.occurredAt, next_step_at: null })
    }
    if (event.event === 'hard_bounces') {
      const alternative = !enrollment.alternative_email_used
        ? (enrollment.contacts?.alternative_emails || []).find((email: string) => email && email !== enrollment.active_email)
        : null
      if (alternative) {
        enrollmentUpdates.active_email = String(alternative).toLowerCase()
        enrollmentUpdates.alternative_email_used = true
        enrollmentUpdates.hard_bounced_at = event.occurredAt
        enrollmentUpdates.next_step_at = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        await supabase.from('commercial_messages').insert({
          enrollment_id: enrollment.id,
          step_number: Math.max(1, Number(enrollment.current_step) || 1),
          attempt_number: 2,
          recipient_email: alternative,
          scheduled_at: enrollmentUpdates.next_step_at,
          status: 'scheduled',
        })
      } else {
        Object.assign(enrollmentUpdates, { status: 'stopped', stop_reason: 'hard_bounce', stopped_at: event.occurredAt, hard_bounced_at: event.occurredAt })
      }
    }
    if (event.event === 'unsubscribes' || event.event === 'complaints') {
      const reason = event.event === 'complaints' ? 'complaint' : 'unsubscribe'
      Object.assign(enrollmentUpdates, { status: 'stopped', stop_reason: reason, stopped_at: event.occurredAt, [`${event.event === 'complaints' ? 'complained' : 'unsubscribed'}_at`]: event.occurredAt })
      await supabase.from('commercial_suppressions').upsert({ user_id: userId, structure_key: enrollment.structure_key, email: event.email, reason, source: 'acumbamail' }, { onConflict: 'user_id,structure_key' })
      await supabase.from('contacts').update({ marketing_eligibility: 'suppressed', marketing_reason: reason, email_unsubscribed_at: event.occurredAt })
        .eq('user_id', userId).eq('id', enrollment.contact_id)
      const structureColumn = enrollment.structure_key.startsWith('place:') ? 'source_place_id'
        : enrollment.structure_key.startsWith('google:') ? 'source_google_id'
        : enrollment.structure_key.startsWith('site:') ? 'normalized_website' : null
      if (structureColumn) {
        const rawValue = enrollment.structure_key.replace(/^[^:]+:/, '')
        const value = structureColumn === 'normalized_website' ? rawValue : rawValue
        await supabase.from('contacts').update({ marketing_eligibility: 'suppressed', marketing_reason: reason, email_unsubscribed_at: event.occurredAt })
          .eq('user_id', userId).eq(structureColumn, value)
      }
    }
    if (Object.keys(enrollmentUpdates).length) {
      const result = await supabase.from('commercial_enrollments').update(enrollmentUpdates).eq('id', enrollment.id)
      if (result.error) throw result.error
    }
    if (Object.keys(messageUpdates).length) await supabase.from('commercial_messages').update(messageUpdates).eq('enrollment_id', enrollment.id).eq('status', 'sent')
    updated += 1
  }
  const campaignIds = Array.from(new Set((enrollments || []).map((row: any) => row.campaign_id)))
  for (const campaignId of campaignIds) {
    const rows = (enrollments || []).filter((row: any) => row.campaign_id === campaignId)
    const campaign = rows[0]?.commercial_campaigns
    const sent = await supabase.from('commercial_messages')
      .select('id,commercial_enrollments!inner(campaign_id)', { count: 'exact', head: true })
      .eq('status', 'sent').eq('commercial_enrollments.campaign_id', campaignId)
    const total = Math.max(1, Number(sent.count) || 0)
    const bounced = await supabase.from('commercial_enrollments').select('id', { count: 'exact', head: true }).eq('campaign_id', campaignId).not('hard_bounced_at', 'is', null)
    const complained = await supabase.from('commercial_enrollments').select('id', { count: 'exact', head: true }).eq('campaign_id', campaignId).not('complained_at', 'is', null)
    const bounceRate = (Number(bounced.count) || 0) * 100 / total
    const complaintRate = (Number(complained.count) || 0) * 100 / total
    if (bounceRate >= Number(campaign?.automatic_pause_bounce_rate || 5) || complaintRate >= Number(campaign?.automatic_pause_complaint_rate || 0.1)) {
      await supabase.from('commercial_campaigns').update({ status: 'paused', approval_note: `Pausa automatica: bounce ${bounceRate.toFixed(2)}%, reclami ${complaintRate.toFixed(2)}%` }).eq('id', campaignId)
    }
  }
  return updated
}

export function acumbamailIdempotencyKey(messageId: string, recipient: string) {
  return createHash('sha256').update(`${messageId}:${recipient}`).digest('hex')
}
