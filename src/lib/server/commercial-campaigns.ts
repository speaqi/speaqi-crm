/**
 * Motore campagne generico sopra le tabelle `commercial_*`.
 *
 * Aggiungere un verticale (consorzi, GAL, comuni, aree SNAI) deve essere un
 * atto di configurazione: nome, tag, mittente, lista sorgente e testi vivono
 * sulla riga della campagna, non nel codice. Qui sta solo la meccanica comune —
 * step predefiniti, arruolamento con tetti atomici, filtri di import.
 *
 * Wine Project resta sulle sue tabelle: la sua migrazione e un lavoro separato,
 * da fare quando queste campagne avranno collaudato il motore.
 */

import { fetchAcumbamailListSubscribers } from '@/lib/server/acumbamail-marketing'

export const CAMPAIGN_STATUSES = ['paused', 'active', 'completed'] as const
export const CAMPAIGN_APPROVAL_STATUSES = ['analysis', 'pending_legal', 'approved', 'rejected'] as const

export type CommercialCampaign = {
  id: string
  user_id: string
  vertical: string
  name: string
  slug: string | null
  list_name: string
  event_tag: string
  status: (typeof CAMPAIGN_STATUSES)[number]
  approval_status: (typeof CAMPAIGN_APPROVAL_STATUSES)[number]
  daily_cap: number
  daily_enrollment_cap: number
  sender_name: string
  sender_email: string
  reply_to: string | null
  acumbamail_list_id: string | null
  cadence_days: number[]
  brand_eyebrow: string | null
  landing_url: string | null
  import_exclude_keyword: string | null
  import_required_country: string | null
  require_marketing_attestation: boolean
  stop_on_open: boolean
  stop_on_click: boolean
}

/** Stati contatto che chiudono la trattativa: non si arruolano e non ricevono. */
export const CLOSED_CONTACT_STATUSES = ['Closed', 'Paid', 'Lost']

/**
 * Definizione unica di "contatto arruolabile in questa campagna".
 *
 * La usano sia il motore, per pescare i candidati, sia la scheda della
 * campagna, per dire quanti sono. Se vivessero in due posti diversi, la
 * pagina finirebbe prima o poi a mostrare un numero che il motore non
 * riconosce — ed e esattamente il caso in cui l'utente non capisce perche
 * il bacino e pieno e gli arruolamenti sono zero.
 */
export function applyEnrollableContactFilter(
  query: any,
  campaign: Pick<CommercialCampaign, 'user_id' | 'event_tag' | 'require_marketing_attestation'>
) {
  let filtered = query
    .eq('user_id', campaign.user_id)
    .eq('event_tag', campaign.event_tag)
    .eq('marketing_eligibility', 'eligible')
    .is('email_unsubscribed_at', null)
    .not('email', 'is', null)
    .not('status', 'in', `(${CLOSED_CONTACT_STATUSES.join(',')})`)
  if (campaign.require_marketing_attestation) {
    filtered = filtered
      .eq('hospitality_filter_decision', 'include')
      .not('marketing_legal_basis', 'is', null)
      .not('marketing_source_acquired_at', 'is', null)
  }
  return filtered
}

const CONTACT_PAGE_SIZE = 500

export function campaignSlug(value: unknown) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

// ---------------------------------------------------------------------------
// Step predefiniti
// ---------------------------------------------------------------------------

/**
 * Cinque tappe generiche: la campagna nasce utilizzabile, non vuota. I testi
 * sono un punto di partenza da riscrivere sulla pagina della campagna, non la
 * voce di Speaqi su un verticale specifico.
 */
export function defaultCampaignSteps(campaign: Pick<CommercialCampaign, 'name' | 'cadence_days' | 'sender_name' | 'sender_email'>) {
  const cadence = (Array.isArray(campaign.cadence_days) && campaign.cadence_days.length
    ? campaign.cadence_days
    : [1, 4, 9, 16, 28]
  ).map((day) => Math.max(0, Math.floor(Number(day) || 0)))

  const firma = `Cordiali saluti,\n${campaign.sender_name}\nSpeaqi\n${campaign.sender_email}`
  const bodies = [
    `{{saluto}}\n\nLe scrivo a proposito di {{azienda}}.\n\nSpeaqi trasforma le informazioni gia pubblicate dall'organizzazione in un'esperienza digitale multilingua, consultabile da un solo indirizzo.\n\nPuo vedere un esempio qui: {{landing_url}}\n\n${firma}`,
    `{{saluto}}\n\nTorno brevemente sulla mia email precedente.\n\nLa prima versione si costruisce dalle informazioni gia pubbliche di {{azienda}}: non serve un progetto tecnico per vederla.\n\n{{landing_url}}\n\n${firma}`,
    `{{saluto}}\n\nUn esempio concreto: chi arriva da un altro paese trova le stesse informazioni nella propria lingua, aggiornate da un'unica fonte.\n\nPer {{azienda}} funzionerebbe cosi: {{landing_url}}\n\n${firma}`,
    `{{saluto}}\n\nSe il tema le interessa ma non e il momento, mi dica pure quando riprendere.\n\nIntanto lascio qui l'esempio dedicato a {{azienda}}: {{landing_url}}\n\n${firma}`,
    `{{saluto}}\n\nChiudo qui i miei messaggi per non disturbarla oltre.\n\nSe in futuro vorra vedere l'esperienza pensata per {{azienda}}, la trova sempre qui: {{landing_url}}\n\nResto volentieri a disposizione.\n\n${firma}`,
  ]

  return bodies.map((body, index) => ({
    step_number: index + 1,
    day_offset: cadence[index] ?? (cadence[cadence.length - 1] || 0) + (index + 1 - cadence.length) * 7,
    // Solo la seconda email si ferma davanti a un segnale: e il richiamo, non
    // ha senso mandarlo a chi ha gia aperto.
    only_without_engagement: index === 1,
    subject_template: `{{azienda}} - ${campaign.name}`,
    body_text_template: body,
    body_html_template: textToHtml(body),
  }))
}

export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] || char))
}

export function textToHtml(value: string) {
  return `<div style="font-family:Arial,sans-serif;color:#101828;line-height:1.55;text-align:left;background:#fff;">${value
    .split(/\n\n+/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('')}</div>`
}

/**
 * Crea gli step mancanti senza toccare quelli esistenti.
 *
 * Non e un upsert: uno step gia inviato e immutabile (lo impone anche un
 * trigger), e riscrivere il testo di una email partita renderebbe la cronologia
 * bugiarda.
 */
export async function ensureCampaignSteps(supabase: any, campaign: CommercialCampaign) {
  const { data: existing, error } = await supabase
    .from('commercial_campaign_steps')
    .select('*')
    .eq('campaign_id', campaign.id)
    .order('step_number')
  if (error) throw error

  const present = new Set((existing || []).map((step: any) => Number(step.step_number)))
  const missing = defaultCampaignSteps(campaign)
    .filter((step) => !present.has(step.step_number))
    .map((step) => ({ campaign_id: campaign.id, ...step }))
  if (!missing.length) return existing || []

  const inserted = await supabase
    .from('commercial_campaign_steps')
    .upsert(missing, { onConflict: 'campaign_id,step_number', ignoreDuplicates: true })
    .select('*')
  if (inserted.error) throw inserted.error
  return [...(existing || []), ...(inserted.data || [])].sort((a: any, b: any) => a.step_number - b.step_number)
}

// ---------------------------------------------------------------------------
// Filtri di import
// ---------------------------------------------------------------------------

export type ImportCandidate = {
  email: string
  name?: string | null
  company?: string | null
  country?: string | null
}

export type FilterOutcome = 'enroll' | 'park' | 'exclude'

function normalize(value: unknown) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

/**
 * Decide cosa fare di un record della lista sorgente.
 *
 * `exclude` non entra affatto; `park` entra come contatto col tag suffisso
 * `_en` ma senza iscrizione — parcheggiato, non perso. Entrambi i criteri sono
 * per campagna e assenti (NULL) di default: una campagna nuova non eredita
 * filtri pensati per un altro verticale.
 */
export function classifyImportCandidate(
  campaign: Pick<CommercialCampaign, 'import_exclude_keyword' | 'import_required_country'>,
  candidate: ImportCandidate
): FilterOutcome {
  const keyword = normalize(campaign.import_exclude_keyword)
  if (keyword) {
    const haystack = `${normalize(candidate.company)} ${normalize(candidate.name)}`
    if (haystack.includes(keyword)) return 'exclude'
  }
  const required = normalize(campaign.import_required_country)
  if (required && normalize(candidate.country) !== required) return 'park'
  return 'enroll'
}

// ---------------------------------------------------------------------------
// Arruolamento
// ---------------------------------------------------------------------------

export type EnrollmentReport = {
  requested: number
  granted: number
  from_crm: number
  from_list: number
  parked: number
  excluded: number
  duplicates: number
  inserted: number
  list_error: string | null
}

const emptyReport = (requested = 0): EnrollmentReport => ({
  requested, granted: 0, from_crm: 0, from_list: 0,
  parked: 0, excluded: 0, duplicates: 0, inserted: 0, list_error: null,
})

/**
 * Porta in sequenza fino a `daily_enrollment_cap` contatti al giorno.
 *
 * Prima i contatti CRM che portano gia il tag della campagna — vanno riusati,
 * non scartati: e li che stanno i bacini gia importati. Poi, solo se restano
 * posti e la campagna ha una lista sorgente, i nuovi iscritti dalla lista
 * Acumbamail, creati nel CRM nel momento in cui entrano in sequenza.
 *
 * Il tetto e prenotato dal database (`reserve_commercial_enrollment_slots`) e
 * chiuso a fine giro: due worker in parallelo non possono sforarlo.
 */
export async function enrollCampaignContacts(
  supabase: any,
  campaign: CommercialCampaign,
  options: { limit?: number; dryRun?: boolean } = {}
): Promise<EnrollmentReport> {
  const dryRun = options.dryRun !== false
  const requested = Math.min(5000, Math.max(1, Math.floor(Number(options.limit) || campaign.daily_enrollment_cap || 30)))
  const report = emptyReport(requested)

  const enrolledKeys = await loadEnrolledKeys(supabase, campaign.id)
  const suppressed = await loadSuppressions(supabase, campaign)

  if (dryRun) {
    // Anteprima: nessuna prenotazione, nessuna scrittura. Il numero mostrato e
    // comunque limitato dal tetto residuo, altrimenti prometterebbe piu di
    // quanto un giro reale farebbe.
    const remaining = await remainingEnrollmentSlots(supabase, campaign)
    report.granted = Math.min(requested, remaining)
    const crm = await collectCrmCandidates(supabase, campaign, enrolledKeys, suppressed, report.granted)
    report.from_crm = crm.length
    return report
  }

  const { data: granted, error: reserveError } = await supabase.rpc('reserve_commercial_enrollment_slots', {
    p_campaign_id: campaign.id,
    p_wanted: requested,
  })
  if (reserveError) throw reserveError
  report.granted = Math.max(0, Number(granted) || 0)
  if (!report.granted) return report

  let used = 0
  try {
    const crm = await collectCrmCandidates(supabase, campaign, enrolledKeys, suppressed, report.granted)
    report.from_crm = await insertEnrollments(supabase, campaign, crm)
    used += report.from_crm

    // I posti restanti si contano sulle iscrizioni davvero create, non sui
    // candidati: un conflitto non deve consumare un posto.
    const left = report.granted - used
    if (left > 0 && campaign.acumbamail_list_id) {
      try {
        const fromList = await importFromSourceList(supabase, campaign, enrolledKeys, suppressed, left, report)
        report.from_list = await insertEnrollments(supabase, campaign, fromList)
        used += report.from_list
      } catch (listError) {
        // Import chiuso: se la lista non si legge, l'arruolamento da quella
        // fonte e zero e viene dichiarato. Nessun ripiego: arruolare per errore
        // l'intero bacino e il danno peggiore possibile qui.
        report.list_error = listError instanceof Error ? listError.message : String(listError)
      }
    }
  } finally {
    report.inserted = used
    await supabase.rpc('settle_commercial_enrollment_slots', {
      p_campaign_id: campaign.id,
      p_reserved: report.granted,
      p_used: used,
    })
  }
  return report
}

type EnrolledKeys = { contactIds: Set<string>; structures: Set<string>; emails: Set<string> }

async function loadEnrolledKeys(supabase: any, campaignId: string): Promise<EnrolledKeys> {
  const { data, error } = await supabase
    .from('commercial_enrollments')
    .select('contact_id,structure_key,primary_email')
    .eq('campaign_id', campaignId)
  if (error) throw error
  return {
    contactIds: new Set((data || []).map((row: any) => row.contact_id)),
    structures: new Set((data || []).map((row: any) => row.structure_key).filter(Boolean)),
    emails: new Set((data || []).map((row: any) => String(row.primary_email || '').toLowerCase()).filter(Boolean)),
  }
}

/** Disiscritti, reclami e blacklist non rientrano mai da un'altra porta. */
async function loadSuppressions(supabase: any, campaign: CommercialCampaign) {
  const { data, error } = await supabase
    .from('commercial_suppressions')
    .select('structure_key,email,campaign_id')
    .eq('user_id', campaign.user_id)
  if (error) throw error
  const structures = new Set<string>()
  const emails = new Set<string>()
  for (const row of data || []) {
    if (row.campaign_id && row.campaign_id !== campaign.id) continue
    if (row.structure_key) structures.add(row.structure_key)
    if (row.email) emails.add(String(row.email).toLowerCase())
  }
  return { structures, emails }
}

async function remainingEnrollmentSlots(supabase: any, campaign: CommercialCampaign) {
  const { data, error } = await supabase
    .from('commercial_campaign_daily_counters')
    .select('enrolled_reserved,enrolled_count')
    .eq('campaign_id', campaign.id)
    .eq('local_day', localDay())
    .maybeSingle()
  if (error) throw error
  const used = (Number(data?.enrolled_reserved) || 0) + (Number(data?.enrolled_count) || 0)
  return Math.max(0, (Number(campaign.daily_enrollment_cap) || 0) - used)
}

export function localDay(now = new Date(), timeZone = process.env.AUTOMATION_TIMEZONE || 'Europe/Rome') {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

export function structureKey(contact: {
  source_place_id?: string | null
  source_google_id?: string | null
  normalized_website?: string | null
  email?: string | null
}) {
  if (contact.source_place_id) return `place:${contact.source_place_id}`
  if (contact.source_google_id) return `google:${contact.source_google_id}`
  if (contact.normalized_website) {
    try {
      return `site:${new URL(contact.normalized_website).hostname.toLowerCase().replace(/^www\./, '')}`
    } catch {}
  }
  return `email:${String(contact.email || '').trim().toLowerCase()}`
}

/**
 * Contatti gia nel CRM col tag della campagna e non ancora iscritti.
 * Paginazione per chiave: una prima pagina tutta gia iscritta non deve affamare
 * i contatti successivi.
 */
async function collectCrmCandidates(
  supabase: any,
  campaign: CommercialCampaign,
  enrolled: EnrolledKeys,
  suppressed: { structures: Set<string>; emails: Set<string> },
  wanted: number
) {
  if (wanted < 1) return []
  const picked: any[] = []
  const seenStructures = new Set(enrolled.structures)
  const seenEmails = new Set(enrolled.emails)
  let cursor = ''

  while (picked.length < wanted) {
    let query = applyEnrollableContactFilter(
      supabase
        .from('contacts')
        .select('id,email,name,company,alternative_emails,source_place_id,source_google_id,normalized_website'),
      campaign
    )
      .order('id', { ascending: true })
      .limit(CONTACT_PAGE_SIZE)
    if (cursor) query = query.gt('id', cursor)

    const { data: page, error } = await query
    if (error) throw error
    if (!page?.length) break
    cursor = page[page.length - 1].id

    for (const contact of page) {
      if (picked.length >= wanted) break
      const email = String(contact.email || '').trim().toLowerCase()
      if (!email || enrolled.contactIds.has(contact.id) || seenEmails.has(email)) continue
      const key = structureKey(contact)
      if (seenStructures.has(key)) continue
      if (suppressed.emails.has(email) || suppressed.structures.has(key)) continue
      picked.push({ contact_id: contact.id, email, structure_key: key })
      seenStructures.add(key)
      seenEmails.add(email)
    }
    if (page.length < CONTACT_PAGE_SIZE) break
  }
  return picked
}

/**
 * Scarica la lista sorgente, scarta chi e gia nel CRM (con qualunque tag),
 * applica i filtri della campagna e crea i soli contatti che entrano davvero
 * in sequenza. I record fuori paese vengono creati col tag `<event_tag>_en` e
 * senza iscrizione.
 */
async function importFromSourceList(
  supabase: any,
  campaign: CommercialCampaign,
  enrolled: EnrolledKeys,
  suppressed: { structures: Set<string>; emails: Set<string> },
  wanted: number,
  report: EnrollmentReport
) {
  const subscribers = await fetchAcumbamailListSubscribers(
    requireAcumbamailToken(),
    String(campaign.acumbamail_list_id)
  )

  const seen = new Set<string>()
  const eligible: ImportCandidate[] = []
  const parked: ImportCandidate[] = []

  for (const subscriber of subscribers) {
    const email = String(subscriber.email || '').trim().toLowerCase()
    if (!email || seen.has(email)) continue
    seen.add(email)
    if (suppressed.emails.has(email) || suppressed.structures.has(`email:${email}`)) {
      report.excluded += 1
      continue
    }
    const outcome = classifyImportCandidate(campaign, subscriber)
    if (outcome === 'exclude') report.excluded += 1
    else if (outcome === 'park') parked.push(subscriber)
    else eligible.push(subscriber)
    if (eligible.length >= wanted * 3) break
  }

  const known = await knownEmails(supabase, campaign.user_id, [...eligible, ...parked].map((row) => row.email))
  const fresh = eligible.filter((row) => !known.has(row.email) && !enrolled.emails.has(row.email))
  report.duplicates += eligible.length - fresh.length

  const toPark = parked.filter((row) => !known.has(row.email))
  if (toPark.length) {
    await insertContacts(supabase, campaign, toPark, `${campaign.event_tag}_en`)
    report.parked += toPark.length
  }

  const admitted = fresh.slice(0, wanted)
  if (!admitted.length) return []
  const created = await insertContacts(supabase, campaign, admitted, campaign.event_tag)
  return created.map((contact: any) => ({
    contact_id: contact.id,
    email: String(contact.email).toLowerCase(),
    structure_key: structureKey(contact),
  }))
}

function requireAcumbamailToken() {
  const token = process.env.ACUMBAMAIL_AUTH_TOKEN
  if (!token) throw new Error('ACUMBAMAIL_AUTH_TOKEN non configurato: import dalla lista non eseguito')
  return token
}

/** Una email gia presente nel CRM non viene ricreata, con qualunque tag stia. */
async function knownEmails(supabase: any, userId: string, emails: string[]) {
  const known = new Set<string>()
  const unique = Array.from(new Set(emails.filter(Boolean)))
  for (let index = 0; index < unique.length; index += 200) {
    const chunk = unique.slice(index, index + 200)
    const { data, error } = await supabase
      .from('contacts')
      .select('email')
      .eq('user_id', userId)
      .in('email', chunk)
    if (error) throw error
    for (const row of data || []) known.add(String(row.email || '').toLowerCase())
  }
  return known
}

async function insertContacts(
  supabase: any,
  campaign: CommercialCampaign,
  candidates: ImportCandidate[],
  eventTag: string
) {
  const rows = candidates.map((candidate) => ({
    user_id: campaign.user_id,
    name: String(candidate.name || candidate.company || candidate.email).trim(),
    email: candidate.email,
    company: candidate.company || null,
    country: candidate.country || null,
    status: 'New',
    source: `campagna:${campaign.slug || campaign.vertical}`,
    contact_scope: 'holding',
    event_tag: eventTag,
    list_name: campaign.list_name,
    marketing_eligibility: 'eligible',
    marketing_reason: `Import lista Acumbamail ${campaign.acumbamail_list_id}`,
    marketing_source_acquired_at: new Date().toISOString(),
  }))
  const { data, error } = await supabase.from('contacts').insert(rows).select('id,email,normalized_website,source_place_id,source_google_id')
  if (error) throw error
  return data || []
}

async function insertEnrollments(
  supabase: any,
  campaign: CommercialCampaign,
  candidates: Array<{ contact_id: string; email: string; structure_key: string }>
) {
  if (!candidates.length) return 0
  const firstOffset = Math.max(0, Number((campaign.cadence_days || [1])[0]) || 1)
  const scheduledAt = new Date(Date.now() + firstOffset * 24 * 60 * 60 * 1000).toISOString()

  const rows = candidates.map((candidate) => ({
    campaign_id: campaign.id,
    contact_id: candidate.contact_id,
    structure_key: candidate.structure_key,
    primary_email: candidate.email,
    active_email: candidate.email,
    status: 'pending',
    next_step_at: scheduledAt,
  }))

  // `ignoreDuplicates` regge il doppio giro di cron su unique(campaign_id,
  // contact_id). Gli altri unici della tabella (struttura, email) possono
  // scattare su un contatto diverso con lo stesso indirizzo: in quel caso il
  // lotto viene ripreso riga per riga, saltando i doppioni invece di perdere
  // l'intero giro.
  const insertRows = async (batch: typeof rows) =>
    supabase
      .from('commercial_enrollments')
      .upsert(batch, { onConflict: 'campaign_id,contact_id', ignoreDuplicates: true })
      .select('id,active_email,next_step_at')

  let { data, error } = await insertRows(rows)
  if (error && String((error as any).code) === '23505') {
    const accepted: any[] = []
    for (const row of rows) {
      const single = await insertRows([row])
      if (single.error) {
        if (String((single.error as any).code) === '23505') continue
        throw single.error
      }
      accepted.push(...(single.data || []))
    }
    data = accepted
    error = null
  }
  if (error) throw error
  if (!data?.length) return 0

  const messages = await supabase.from('commercial_messages').upsert(
    data.map((enrollment: any) => ({
      enrollment_id: enrollment.id,
      step_number: 1,
      attempt_number: 1,
      recipient_email: enrollment.active_email,
      scheduled_at: enrollment.next_step_at,
      status: 'scheduled',
    })),
    { onConflict: 'enrollment_id,step_number,attempt_number', ignoreDuplicates: true }
  )
  if (messages.error) throw messages.error
  return data.length
}
