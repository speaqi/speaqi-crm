import { createActivities } from '@/lib/server/crm'
import { toCallableSlot } from '@/lib/sla'

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
    .select('enabled, campaign_name, acumbamail_list_id, acumbamail_campaign_id, daily_send_cap, first_followup_days, second_followup_days, third_followup_days, fourth_followup_days, fifth_followup_days, sequence_templates')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    if (isMissingTable(error)) return DEFAULT_WINE_PROJECT_AUTOMATION_SETTINGS
    throw error
  }
  return normalizeWineProjectAutomationSettings(data || DEFAULT_WINE_PROJECT_AUTOMATION_SETTINGS)
}

export function wineFollowupDueAt(days: number, from = new Date()) {
  return toCallableSlot(new Date(from.getTime() + days * 24 * 60 * 60 * 1000)).toISOString()
}

export async function planWineProjectFollowups(
  supabase: any,
  contact: WineContact,
  settings: WineProjectAutomationSettings,
  from = new Date()
) {
  if (!settings.enabled) return { planned: 0, firstDueAt: null }

  const rows = [
    { sequence: 1, due_at: wineFollowupDueAt(settings.first_followup_days, from) },
    { sequence: 2, due_at: wineFollowupDueAt(settings.second_followup_days, from) },
    { sequence: 3, due_at: wineFollowupDueAt(settings.third_followup_days, from) },
    { sequence: 4, due_at: wineFollowupDueAt(settings.fourth_followup_days, from) },
    { sequence: 5, due_at: wineFollowupDueAt(settings.fifth_followup_days, from) },
  ].map((item) => ({ ...item, user_id: contact.user_id, contact_id: contact.id }))

  const { error } = await supabase
    .from('wine_project_followup_events')
    .upsert(rows, { onConflict: 'contact_id,sequence', ignoreDuplicates: true })
  if (error) {
    if (isMissingTable(error)) return { planned: 0, firstDueAt: rows[0].due_at }
    throw error
  }
  return { planned: rows.length, firstDueAt: rows[0].due_at }
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

export async function backfillWineProjectFollowups(supabase: any) {
  const { data: contacts, error } = await supabase
    .from('contacts')
    .select('id, user_id, name, email, phone, status, email_unsubscribed_at')
    .eq('event_tag', 'wine-project')
    .is('email_unsubscribed_at', null)
    .not('status', 'in', '(Closed,Paid,Lost)')
    .limit(500)
  if (error) throw error

  const settingsByUser = new Map<string, WineProjectAutomationSettings>()
  let planned = 0
  for (const contact of contacts || []) {
    let settings = settingsByUser.get(contact.user_id)
    if (!settings) {
      settings = await loadWineProjectAutomationSettings(supabase, contact.user_id)
      settingsByUser.set(contact.user_id, settings)
    }
    const result = await planWineProjectFollowups(supabase, contact, settings)
    planned += result.planned
  }
  return { contacts: contacts?.length || 0, planned }
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
    'Questo brief è vincolante: mantieni oggetto, messaggio e unica CTA. Personalizza solo nome e azienda; nell’oggetto usa il nome completo del contatto, mentre nel saluto usa solo il nome. Non aggiungere una firma, perché la firma viene aggiunta dal CRM. Quando il testo contiene **parole tra doppio asterisco**, rendile in grassetto solo nel body_html usando <strong>; nel body_text lasciale senza asterischi.',
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
