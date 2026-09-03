import { createActivities } from '@/lib/server/crm'

export type WineProjectSequenceTemplate = {
  sequence: number
  label: string
  condition: 'all' | 'unopened'
  subject: string
  body: string
}

export type WineProjectAutomationSettings = {
  enabled: boolean
  campaign_name: string
  acumbamail_list_id: string | null
  acumbamail_campaign_id: string | null
  daily_send_cap: number
  daily_enrollment_cap: number
  campaign_send_enabled: boolean
  first_followup_days: number
  second_followup_days: number
  third_followup_days: number
  fourth_followup_days: number
  fifth_followup_days: number
  sequence_templates: WineProjectSequenceTemplate[]
}

export const DEFAULT_WINE_PROJECT_SEQUENCE_TEMPLATES: WineProjectSequenceTemplate[] = [
  {
    sequence: 1,
    label: 'Ripresa dopo Vinitaly',
    condition: 'all',
    subject: '{{azienda}} - All’attenzione di {{nome}}',
    body: `Buongiorno {{nome}},

sono Massimo Morgante, fondatore di Speaqi.

Vi avevamo contattato dopo Vinitaly. Da allora Speaqi si è evoluta molto.

Oggi possiamo trasformare **l’intera cantina e il suo catalogo vini** in un’esperienza digitale multilingua, accessibile da web o QR code.

Un cliente, un importatore o un turista può scoprire i vostri vini, ascoltarne il racconto nella propria lingua e chiedere direttamente all’**AI Concierge** informazioni su abbinamenti, vinificazione, azienda, degustazioni e territorio.

La cosa interessante è che **non dovete caricare tutto manualmente**. Con Wine Project inseriamo il sito della cantina e Speaqi importa automaticamente azienda e vini, creando una prima versione del progetto da farvi vedere.

Il servizio avrà un costo di **300 €**, ma in questa fase stiamo selezionando alcune cantine a cui realizzare **gratuitamente l’intero progetto fino al 30 settembre**.

Stanno già collaborando con Speaqi realtà come **San Salvatore 1988, Dalibrà e Leonarda Tardi**.

Speaqi è stato raccontato anche da **Rai 3 – Mezzogiorno Italia**: https://www.youtube.com/watch?v=HMb5XQEY4cM

**→ Scoprite come sarebbe la vostra cantina su Speaqi**

Non serve acquistare nulla per vedere il risultato.`,
  },
  {
    sequence: 2,
    label: 'Promemoria dopo il primo contatto',
    condition: 'all',
    subject: 'Le posso mostrare {{azienda}} in pochi minuti?',
    body: `Buongiorno {{nome}},

sono Massimo Morgante, fondatore di Speaqi.

Le riscrivo solo per rendere il passaggio più semplice: per vedere la demo della cantina bastano il sito, un indirizzo email e un recapito. Non chiediamo di cambiare sito, preparare materiali o affrontare un progetto tecnico.

Partiamo da ciò che {{azienda}} racconta già online e lo trasformiamo in una demo dove clienti, visitatori e buyer possono scoprire vini e cantina in tutte le lingue, fare domande e ricevere risposte immediate.

**L’obiettivo non è un QR isolato:** è rendere la cantina pronta per chi arriva dall’estero, cerca informazioni sui vini o vuole capire meglio azienda e territorio.

Se Le fa piacere, Le prepariamo una demo completa della cantina {{azienda}}.`,
  },
  {
    sequence: 3,
    label: 'Esempio sulla bottiglia',
    condition: 'all',
    subject: 'Partiamo da una bottiglia di {{azienda}}?',
    body: `Buongiorno {{nome}},

sono Massimo Morgante, fondatore di Speaqi.

Provo a renderlo molto concreto: un cliente prende una bottiglia di {{azienda}}, scansiona il QR e trova il vino, la sua storia, la cantina e il territorio nella propria lingua. Può anche fare una domanda e ottenere una risposta basata sui contenuti della vostra azienda.

Non è una traduzione o un QR isolato: è il racconto della cantina, pronto per chiunque arrivi da qualsiasi Paese. Lo stesso sistema può accompagnare una degustazione, una visita in cantina o la scelta di un importatore.

Se Le fa piacere, Le mostriamo la demo di {{azienda}} e come apparirebbe l’esperienza completa.`,
  },
  {
    sequence: 4,
    label: 'Referenze e Rai 3',
    condition: 'all',
    subject: 'Come stanno usando Speaqi le cantine',
    body: `Buongiorno {{nome}},

sono Massimo Morgante, fondatore di Speaqi.

Le riscrivo perché il progetto Wine di Speaqi è ormai molto concreto: stiamo lavorando con cantine come **San Salvatore, Dalibrà e Leonarda Tardi** per rendere vini, cantina e territorio accessibili a un pubblico internazionale.

Speaqi è stato raccontato anche da **Rai 3, durante Mezzogiorno Italia**: https://www.youtube.com/watch?v=HMb5XQEY4cM

Il punto per noi è semplice: lasciare alla cantina il suo racconto e renderlo comprensibile, interrogabile e utile in ogni lingua, senza rifare il sito.

Se Le fa piacere, posso farLe vedere una demo completa costruita su {{azienda}}, senza impegno.`,
  },
  {
    sequence: 5,
    label: 'Chiusura gentile',
    condition: 'all',
    subject: 'Chiudo qui, ma Le lascio un esempio?',
    body: `Buongiorno {{nome}},

sono Massimo Morgante, fondatore di Speaqi.

Chiudo qui i miei messaggi per non disturbarLa oltre.

L’idea resta semplice: {{azienda}} racconta una volta vini, cantina e territorio; Speaqi li rende disponibili a clienti e visitatori in tutte le lingue, con un’esperienza che può rispondere anche alle loro domande.

Se non è il momento, nessun problema. Se invece desidera vedere una demo gratuita della cantina {{azienda}}, mi basta una Sua risposta e la prepariamo.`,
  },
]

export const DEFAULT_WINE_PROJECT_AUTOMATION_SETTINGS: WineProjectAutomationSettings = {
  enabled: true,
  campaign_name: 'Wine Project — Vinitaly',
  acumbamail_list_id: '1465520',
  acumbamail_campaign_id: null,
  daily_send_cap: 100,
  daily_enrollment_cap: 30,
  campaign_send_enabled: false,
  first_followup_days: 1,
  second_followup_days: 4,
  third_followup_days: 9,
  fourth_followup_days: 16,
  fifth_followup_days: 28,
  sequence_templates: DEFAULT_WINE_PROJECT_SEQUENCE_TEMPLATES,
}

type WineContact = {
  id: string
  user_id: string
  name: string
  email?: string | null
  phone?: string | null
  status?: string | null
  email_unsubscribed_at?: string | null
  email_open_count?: number | null
  email_click_count?: number | null
}

function text(value: unknown, max = 240) {
  return String(value || '').trim().slice(0, max)
}

function integer(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback
}

function isMissingTable(error: unknown) {
  const message = String((error as { message?: unknown })?.message || '').toLowerCase()
  return (message.includes('wine_project_') || message.includes('fourth_followup') || message.includes('sequence_templates') || message.includes('daily_send_cap')) &&
    (message.includes('schema cache') || message.includes('does not exist') || message.includes('column'))
}

function normalizeSequenceTemplates(input: unknown) {
  const supplied = Array.isArray(input) ? input : []
  return DEFAULT_WINE_PROJECT_SEQUENCE_TEMPLATES.map((defaultTemplate) => {
    const candidate = supplied.find((item) => Number((item as { sequence?: unknown })?.sequence) === defaultTemplate.sequence) as Partial<WineProjectSequenceTemplate> | undefined
    return {
      sequence: defaultTemplate.sequence,
      label: text(candidate?.label, 100) || defaultTemplate.label,
      condition: defaultTemplate.condition,
      subject: text(candidate?.subject, 240) || defaultTemplate.subject,
      body: text(candidate?.body, 5000) || defaultTemplate.body,
    } satisfies WineProjectSequenceTemplate
  })
}

export function normalizeWineProjectAutomationSettings(input: Partial<WineProjectAutomationSettings>) {
  const first = integer(input.first_followup_days, DEFAULT_WINE_PROJECT_AUTOMATION_SETTINGS.first_followup_days, 1, 14)
  const secondCandidate = integer(input.second_followup_days, DEFAULT_WINE_PROJECT_AUTOMATION_SETTINGS.second_followup_days, 2, 30)
  const second = Math.max(first + 1, secondCandidate)
  const thirdCandidate = integer(input.third_followup_days, DEFAULT_WINE_PROJECT_AUTOMATION_SETTINGS.third_followup_days, 3, 60)
  const third = Math.max(second + 1, thirdCandidate)
  const fourthCandidate = integer(input.fourth_followup_days, DEFAULT_WINE_PROJECT_AUTOMATION_SETTINGS.fourth_followup_days, 4, 75)
  const fourth = Math.max(third + 1, fourthCandidate)
  const fifthCandidate = integer(input.fifth_followup_days, DEFAULT_WINE_PROJECT_AUTOMATION_SETTINGS.fifth_followup_days, 5, 90)
  const fifth = Math.max(fourth + 1, fifthCandidate)
  if (fifth > 90) throw new Error('Il quinto messaggio deve essere entro 90 giorni.')

  return {
    enabled: input.enabled !== false,
    campaign_name: text(input.campaign_name, 160) || DEFAULT_WINE_PROJECT_AUTOMATION_SETTINGS.campaign_name,
    acumbamail_list_id: text(input.acumbamail_list_id, 80) || null,
    acumbamail_campaign_id: text(input.acumbamail_campaign_id, 80) || null,
    daily_send_cap: integer(input.daily_send_cap, DEFAULT_WINE_PROJECT_AUTOMATION_SETTINGS.daily_send_cap, 1, 5000),
    daily_enrollment_cap: integer(input.daily_enrollment_cap, DEFAULT_WINE_PROJECT_AUTOMATION_SETTINGS.daily_enrollment_cap, 1, 5000),
    campaign_send_enabled: input.campaign_send_enabled === true,
    first_followup_days: first,
    second_followup_days: second,
    third_followup_days: third,
    fourth_followup_days: fourth,
    fifth_followup_days: fifth,
    sequence_templates: normalizeSequenceTemplates(input.sequence_templates),
  } satisfies WineProjectAutomationSettings
}

export async function loadWineProjectAutomationSettings(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from('wine_project_automation_settings')
    .select('enabled, campaign_name, acumbamail_list_id, acumbamail_campaign_id, daily_send_cap, daily_enrollment_cap, campaign_send_enabled, first_followup_days, second_followup_days, third_followup_days, fourth_followup_days, fifth_followup_days, sequence_templates')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    if (isMissingTable(error)) return DEFAULT_WINE_PROJECT_AUTOMATION_SETTINGS
    throw error
  }
  return normalizeWineProjectAutomationSettings(data || DEFAULT_WINE_PROJECT_AUTOMATION_SETTINGS)
}

/** Ora fissa di partenza: la sequenza esce sempre alle 10:00 italiane. */
const SEND_HOUR_ROME = 10

/** Scarto in minuti fra Roma e UTC nell'istante dato (gestisce l'ora legale). */
function romeOffsetMinutes(at: Date) {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Rome', timeZoneName: 'longOffset' })
    .formatToParts(at)
    .find((part) => part.type === 'timeZoneName')?.value || 'GMT+00:00'
  const match = name.match(/^GMT([+-])(\d{2}):(\d{2})$/)
  return match ? (Number(match[2]) * 60 + Number(match[3])) * (match[1] === '+' ? 1 : -1) : 0
}

/** Istante UTC corrispondente alle SEND_HOUR_ROME di Roma in una data data. */
function romeSendSlot(year: number, month: number, day: number) {
  const wall = new Date(Date.UTC(year, month - 1, day, SEND_HOUR_ROME, 0, 0, 0))
  const first = new Date(wall.getTime() - romeOffsetMinutes(wall) * 60 * 1000)
  // Ricontrolla con lo scarto valido nell'istante calcolato: nei giorni di
  // cambio ora il primo tentativo puo' cadere dalla parte sbagliata.
  const second = romeOffsetMinutes(first)
  return new Date(wall.getTime() - second * 60 * 1000).toISOString()
}

/**
 * Restituisce le 10:00 di Roma del giorno che cade `days` giorni dopo `from`,
 * saltando sabato e domenica.
 *
 * Non usa toCallableSlot: quello corregge l'orario solo quando cade a
 * mezzanotte nell'ora del server, che in produzione e' UTC. Un arruolamento
 * alle 22:00 UTC passava indisturbato e l'email finiva a mezzanotte italiana,
 * l'orario peggiore per una campagna B2B.
 */
export function wineFollowupDueAt(days: number, from = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(from)
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || ''

  // Calendario di Roma, non UTC: chi viene arruolato a mezzanotte italiana
  // deve contare i giorni dal giorno italiano, non da quello precedente.
  const cursor = new Date(Date.UTC(Number(value('year')), Number(value('month')) - 1, Number(value('day'))))
  cursor.setUTCDate(cursor.getUTCDate() + Math.max(0, Math.round(days)))
  while (cursor.getUTCDay() === 0 || cursor.getUTCDay() === 6) {
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }

  return romeSendSlot(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, cursor.getUTCDate())
}

/** Giorni dall'arruolamento previsti per ciascuna email della sequenza. */
export function wineSequenceOffsets(settings: WineProjectAutomationSettings) {
  return [
    settings.first_followup_days,
    settings.second_followup_days,
    settings.third_followup_days,
    settings.fourth_followup_days,
    settings.fifth_followup_days,
  ]
}

export const WINE_SEQUENCE_LAST = 5

/**
 * Arruola il contatto creando SOLO la prima email. Le successive nascono a
 * catena dopo ogni invio riuscito (scheduleNextWineProjectFollowup): creare
 * tutte e cinque le scadenze in anticipo le ancorava alla data di
 * arruolamento, così l'email 2 partiva al suo giorno di calendario anche se
 * la 1 non era mai uscita.
 */
export async function planWineProjectFollowups(
  supabase: any,
  contact: WineContact,
  settings: WineProjectAutomationSettings,
  from = new Date()
) {
  if (!settings.enabled) return { planned: 0, firstDueAt: null }

  const firstDueAt = wineFollowupDueAt(settings.first_followup_days, from)
  const rows = [{ sequence: 1, due_at: firstDueAt, user_id: contact.user_id, contact_id: contact.id }]

  const { error } = await supabase
    .from('wine_project_followup_events')
    .upsert(rows, { onConflict: 'contact_id,sequence', ignoreDuplicates: true })
  if (error) {
    if (isMissingTable(error)) return { planned: 0, firstDueAt }
    throw error
  }
  return { planned: rows.length, firstDueAt }
}

/**
 * Crea l'email successiva partendo dall'invio appena riuscito: la distanza è
 * quella prevista fra le due tappe, ma contata dall'invio reale e non
 * dall'arruolamento. Se il contatto ha già un evento per quella sequenza
 * (ritentativo, doppio worker) l'upsert lo lascia intatto.
 */
export async function scheduleNextWineProjectFollowup(
  supabase: any,
  input: { userId: string; contactId: string; sequence: number },
  settings: WineProjectAutomationSettings,
  sentAt = new Date()
) {
  const current = Number(input.sequence)
  if (!Number.isFinite(current) || current < 1 || current >= WINE_SEQUENCE_LAST) return { planned: 0, dueAt: null }

  const offsets = wineSequenceOffsets(settings)
  const gapDays = Math.max(1, offsets[current] - offsets[current - 1])
  const dueAt = wineFollowupDueAt(gapDays, sentAt)

  const { error } = await supabase
    .from('wine_project_followup_events')
    .upsert(
      [{ user_id: input.userId, contact_id: input.contactId, sequence: current + 1, due_at: dueAt, status: 'scheduled' }],
      { onConflict: 'contact_id,sequence', ignoreDuplicates: true }
    )
  if (error) {
    if (isMissingTable(error)) return { planned: 0, dueAt }
    throw error
  }
  return { planned: 1, dueAt }
}

/**
 * Ferma in un solo aggiornamento gli invii Wine non ancora consegnati. Gli
 * invii gia marcati come sent restano nello storico; gli elementi in sending
 * vengono annullati prima della pubblicazione della campagna quando possibile.
 */
export async function stopWineProjectFollowups(
  supabase: any,
  userId: string,
  contactId: string,
  reason: string
) {
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('wine_project_followup_events')
    .update({ status: 'skipped', skipped_at: now, skip_reason: reason })
    .eq('user_id', userId)
    .eq('contact_id', contactId)
    .in('status', ['scheduled', 'queued', 'sending'])
    .select('id, sequence')

  if (error) {
    if (isMissingTable(error)) return { stopped: 0, events: [] as Array<{ id: string; sequence: number }> }
    throw error
  }
  return { stopped: data?.length || 0, events: (data || []) as Array<{ id: string; sequence: number }> }
}

const ENROLLMENT_PAGE = 500

/** Vero se a Roma e' sabato o domenica. */
function isRomeWeekend(now = new Date()) {
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Rome', weekday: 'short' }).format(now)
  return weekday === 'Sat' || weekday === 'Sun'
}

/** Mezzanotte di Roma in ISO, per contare gli arruolamenti della giornata. */
function startOfRomeDay(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || ''
  const offset = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Rome', timeZoneName: 'longOffset' })
    .formatToParts(now)
    .find((part) => part.type === 'timeZoneName')?.value || 'GMT+00:00'
  const offsetMatch = offset.match(/^GMT([+-])(\d{2}):(\d{2})$/)
  const offsetMinutes = offsetMatch
    ? (Number(offsetMatch[2]) * 60 + Number(offsetMatch[3])) * (offsetMatch[1] === '+' ? 1 : -1)
    : 0
  return new Date(
    Date.UTC(Number(value('year')), Number(value('month')) - 1, Number(value('day'))) - offsetMinutes * 60 * 1000
  ).toISOString()
}

/**
 * Immette in sequenza al massimo `daily_enrollment_cap` contatti nuovi al
 * giorno, pescandoli dal bacino `event_tag = 'wine-project'` in ordine di id.
 *
 * Il tag dice soltanto chi fa parte del bacino: prima questa funzione
 * arruolava tutti i taggati a ogni giro, quindi taggare 3.300 cantine
 * significava creare 3.300 email 1 nello stesso istante, e l'unico freno era
 * un tetto sugli invii totali condiviso con i follow-up.
 *
 * In caso di errore arruola ZERO e lo dichiara nel risultato: ripiegare sul
 * comportamento precedente immetterebbe l'intero bacino per una lettura
 * fallita, che è esattamente il danno da evitare.
 */
export async function backfillWineProjectFollowups(supabase: any, userId?: string) {
  const owners: string[] = []
  if (userId) owners.push(userId)
  else {
    const { data: distinct, error: distinctError } = await supabase
      .from('contacts')
      .select('user_id')
      .eq('event_tag', 'wine-project')
      .limit(1000)
    if (distinctError) throw distinctError
    for (const row of distinct || []) if (!owners.includes(row.user_id)) owners.push(row.user_id)
  }

  let planned = 0
  let scanned = 0
  const blocked: Array<{ user_id: string; reason: string }> = []

  for (const owner of owners) {
    let settings: WineProjectAutomationSettings
    try {
      settings = await loadWineProjectAutomationSettings(supabase, owner)
    } catch (settingsError) {
      blocked.push({ user_id: owner, reason: `impostazioni non leggibili: ${(settingsError as Error).message}` })
      continue
    }
    if (!settings.enabled) continue

    const { count: enrolledToday, error: countError } = await supabase
      .from('wine_project_followup_events')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', owner)
      .eq('sequence', 1)
      .gte('created_at', startOfRomeDay())
    if (countError) {
      blocked.push({ user_id: owner, reason: `conteggio arruolamenti non riuscito: ${countError.message}` })
      continue
    }

    let remaining = Math.max(0, settings.daily_enrollment_cap - (enrolledToday || 0))
    if (remaining < 1) continue

    // Nel weekend non si arruola. Le scadenze saltano sabato e domenica, quindi
    // arruolare in quei due giorni non anticipa nulla: accumula soltanto, e il
    // lunedi' si presentano insieme gli arruolati di venerdi', sabato e
    // domenica, tre volte la capacita' di invio giornaliera.
    if (isRomeWeekend()) continue

    const { data: existing, error: existingError } = await supabase
      .from('wine_project_followup_events')
      .select('contact_id')
      .eq('user_id', owner)
    if (existingError) {
      blocked.push({ user_id: owner, reason: `elenco arruolati non leggibile: ${existingError.message}` })
      continue
    }
    const alreadyEnrolled = new Set((existing || []).map((row: { contact_id: string }) => row.contact_id))

    // Paginazione keyset: con una semplice limit, appena le prime pagine sono
    // tutte di già arruolati il sistema continuerebbe a ripescarle e non
    // arruolerebbe mai i contatti successivi.
    let cursor = ''
    while (remaining > 0) {
      let query = supabase
        .from('contacts')
        .select('id, user_id, name, email, phone, status, email_unsubscribed_at')
        .eq('user_id', owner)
        .eq('event_tag', 'wine-project')
        .is('email_unsubscribed_at', null)
        .not('status', 'in', '(Closed,Paid,Lost)')
        .order('id', { ascending: true })
        .limit(ENROLLMENT_PAGE)
      if (cursor) query = query.gt('id', cursor)

      const { data: page, error: pageError } = await query
      if (pageError) {
        blocked.push({ user_id: owner, reason: `lettura bacino non riuscita: ${pageError.message}` })
        break
      }
      if (!page?.length) break
      cursor = page[page.length - 1].id
      scanned += page.length

      for (const contact of page) {
        if (remaining < 1) break
        if (!contact.email || alreadyEnrolled.has(contact.id)) continue
        const result = await planWineProjectFollowups(supabase, contact, settings)
        if (result.planned > 0) {
          alreadyEnrolled.add(contact.id)
          planned += result.planned
          remaining -= 1
        }
      }
    }
  }

  return { contacts: scanned, planned, blocked }
}

function stoppedReason(contact: WineContact, hasReply: boolean) {
  if (contact.email_unsubscribed_at) return 'disiscritto'
  if (['Closed', 'Paid', 'Lost'].includes(String(contact.status || ''))) return 'trattativa chiusa'
  if (hasReply) return 'risposta ricevuta'
  return null
}

function sequenceTemplate(settings: WineProjectAutomationSettings, sequence: number) {
  return settings.sequence_templates.find((template) => template.sequence === sequence) ||
    DEFAULT_WINE_PROJECT_SEQUENCE_TEMPLATES.find((template) => template.sequence === sequence) ||
    DEFAULT_WINE_PROJECT_SEQUENCE_TEMPLATES[0]
}

function eventNote(contact: WineContact, template: WineProjectSequenceTemplate) {
  return `Wine Project — Email ${template.sequence}/5 “${template.label}” per ${contact.name}.`
}

function sequenceBrief(template: WineProjectSequenceTemplate) {
  return [
    `SEQUENZA WINE PROJECT — EMAIL ${template.sequence}/5`,
    'Questo brief è vincolante: mantieni oggetto, messaggio, riga di presentazione iniziale (“sono Massimo Morgante, fondatore di Speaqi.”) e unica CTA. Personalizza solo nome e azienda; nell’oggetto usa il nome completo del contatto, mentre nel saluto usa solo il nome. Non aggiungere una firma, perché la firma viene aggiunta dal CRM. Quando il testo contiene **parole tra doppio asterisco**, rendile in grassetto solo nel body_html usando <strong>; nel body_text lasciale senza asterischi.',
    `Oggetto: ${template.subject}`,
    '',
    template.body,
  ].join('\n')
}

export async function queueDueWineProjectFollowups(supabase: any, userId?: string) {
  let eventsQuery = supabase
    .from('wine_project_followup_events')
    .select('id, user_id, contact_id, sequence, due_at, created_at, contacts!inner(id, user_id, name, email, phone, status, email_unsubscribed_at, email_open_count, email_click_count, event_tag)')
    .eq('status', 'scheduled')
    .lte('due_at', new Date().toISOString())
    .eq('contacts.event_tag', 'wine-project')
    .order('due_at', { ascending: true })
    .limit(100)
  if (userId) eventsQuery = eventsQuery.eq('user_id', userId)

  const { data: events, error } = await eventsQuery
  if (error) {
    if (isMissingTable(error)) return { queued: 0, skipped: 0 }
    throw error
  }

  let queued = 0
  let skipped = 0
  const settingsByUser = new Map<string, WineProjectAutomationSettings>()
  for (const event of events || []) {
    const contact = Array.isArray(event.contacts) ? event.contacts[0] : event.contacts
    if (!contact) continue
    let settings = settingsByUser.get(contact.user_id)
    if (!settings) {
      settings = await loadWineProjectAutomationSettings(supabase, contact.user_id)
      settingsByUser.set(contact.user_id, settings)
    }
    if (!settings.enabled) continue
    const template = sequenceTemplate(settings, Number(event.sequence))
    const { count, error: replyError } = await supabase
      .from('gmail_messages')
      .select('id', { count: 'exact', head: true })
      .eq('contact_id', contact.id)
      .eq('direction', 'inbound')
      .gte('sent_at', event.created_at || '1970-01-01T00:00:00.000Z')
    if (replyError) throw replyError

    const reason = stoppedReason(contact, Boolean(count))
    if (reason) {
      const { error: skipError } = await supabase
        .from('wine_project_followup_events')
        .update({ status: 'skipped', skipped_at: new Date().toISOString(), skip_reason: reason })
        .eq('id', event.id)
        .eq('status', 'scheduled')
      if (skipError) throw skipError
      skipped += 1
      continue
    }

    const action = 'send_email'
    const { error: taskError } = await supabase.from('tasks').insert({
      user_id: contact.user_id,
      contact_id: contact.id,
      type: 'email',
      action,
      due_date: new Date().toISOString(),
      priority: Number(event.sequence) >= 4 ? 'high' : 'medium',
      status: 'pending',
      note: eventNote(contact, template),
      idempotency_key: `wine-project:${contact.id}:${event.sequence}`,
    })
    if (taskError && !String(taskError.message || '').includes('duplicate')) throw taskError

    const now = new Date().toISOString()
    const { error: updateContactError } = await supabase
      .from('contacts')
      .update({
        next_action_at: now,
        next_followup_at: now,
        email_draft_note: sequenceBrief(template),
        updated_at: now,
      })
      .eq('id', contact.id)
    if (updateContactError) throw updateContactError
    const { error: queueError } = await supabase
      .from('wine_project_followup_events')
      .update({ status: 'queued', queued_at: now })
      .eq('id', event.id)
      .eq('status', 'scheduled')
    if (queueError) throw queueError
    await createActivities(supabase, [{
      user_id: contact.user_id,
      contact_id: contact.id,
      type: 'wine_followup_queued',
      content: eventNote(contact, template),
      metadata: { sequence: Number(event.sequence), template: template.label, source: 'wine-project-automation' },
    }])
    queued += 1
  }

  return { queued, skipped }
}
