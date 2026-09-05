import { createActivities } from '@/lib/server/crm'
import { ensureSenderIntroInText } from '@/lib/email-ai-framework'

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
    label: 'La vostra cantina è già pronta',
    condition: 'all',
    subject: 'Abbiamo messo {{azienda}} su Speaqi',
    body: `Buongiorno {{nome}},

sono Massimo Morgante, ci eravamo sentiti dopo Vinitaly con {{azienda}}.

Nel frattempo Speaqi si è evoluta e abbiamo fatto un test sulla vostra cantina: abbiamo importato automaticamente azienda e vini e creato una prima versione multilingua con **AI Concierge**.

Prima di raccontarvi cosa può fare, preferisco farvela vedere:

Qui c'è **{{azienda}}**
→ [VEDI LA VOSTRA CANTINA SU SPEAQI]

Non dovete registrarvi e non c'è nulla da acquistare.

Se vi piace quello che vedete, rispondetemi semplicemente "Sì" e vi spiego come funziona.`,
  },
  {
    sequence: 2,
    label: 'Promemoria: la demo è ancora lì',
    condition: 'all',
    subject: 'La demo di {{azienda}} è ancora online',
    body: `Buongiorno {{nome}},

sono Massimo Morgante di Speaqi. Le riscrivo solo perché la versione di {{azienda}} che abbiamo preparato è ancora online e mi dispiacerebbe che restasse lì senza che l'abbiate vista.

Sono due minuti: si apre da telefono, non chiede registrazione e non impegna a nulla.

→ [APRI LA DEMO DI {{azienda}}]

Se qualcosa nei testi o nei vini non è corretto me lo dica pure: l'abbiamo costruita partendo dal vostro sito, quindi si sistema in poco.`,
  },
  {
    sequence: 3,
    label: 'Cosa vede un cliente straniero',
    condition: 'all',
    subject: 'Cosa vede un cliente straniero davanti a una vostra bottiglia',
    body: `Buongiorno {{nome}},

sono Massimo Morgante di Speaqi. Provo a renderlo concreto.

Un cliente prende una bottiglia di {{azienda}}, inquadra il QR e trova il vino, la sua storia, la cantina e il territorio **nella propria lingua**. Può ascoltare il racconto, guardare un video e fare domande, ricevendo risposte basate solo sui vostri contenuti.

Non è una traduzione e non è un QR isolato: è il vostro racconto, pronto per chiunque arrivi da qualsiasi Paese, in cantina, in degustazione o dall'altra parte del mondo.

È esattamente quello che trovate nella versione che abbiamo preparato:

→ [VEDI LA VOSTRA CANTINA SU SPEAQI]`,
  },
  {
    sequence: 4,
    label: 'Le cantine che stanno già lavorando così',
    condition: 'all',
    subject: 'Come stanno usando Speaqi le cantine',
    body: `Buongiorno {{nome}},

sono Massimo Morgante di Speaqi. Le scrivo perché il progetto Wine è ormai molto concreto: stiamo lavorando con cantine come **San Salvatore 1988, Dalibrà e Leonarda Tardi** per rendere vini, cantina e territorio accessibili a un pubblico internazionale.

Speaqi è stato raccontato anche da **Rai 3, durante Mezzogiorno Italia**: https://www.youtube.com/watch?v=HMb5XQEY4cM

Il punto resta semplice: la cantina racconta una volta il proprio mondo, noi lo rendiamo comprensibile e interrogabile in ogni lingua, senza rifare il sito.

Su {{azienda}} lo può vedere applicato davvero:

→ [VEDI LA VOSTRA CANTINA SU SPEAQI]`,
  },
  {
    sequence: 5,
    label: 'Chiusura gentile',
    condition: 'all',
    subject: 'Chiudo qui, ma la demo resta vostra',
    body: `Buongiorno {{nome}},

sono Massimo Morgante di Speaqi. Chiudo qui i miei messaggi per non disturbarLa oltre.

La versione di {{azienda}} che abbiamo preparato resta comunque online e può guardarla quando vuole, senza impegno:

→ [VEDI LA VOSTRA CANTINA SU SPEAQI]

Se non è il momento nessun problema: se invece un giorno vorrà riprenderla in mano, le basta rispondere a questa email.`,
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

/**
 * I modelli salvati in impostazioni vincono sui default, quindi cambiare i
 * default non basta a far dire a queste email chi le scrive: la presentazione
 * viene garantita qui, su ogni lettura e su ogni salvataggio, qualunque testo
 * ci sia in `wine_project_automation_settings.sequence_templates`.
 */
function normalizeSequenceTemplates(input: unknown) {
  const supplied = Array.isArray(input) ? input : []
  return DEFAULT_WINE_PROJECT_SEQUENCE_TEMPLATES.map((defaultTemplate) => {
    const candidate = supplied.find((item) => Number((item as { sequence?: unknown })?.sequence) === defaultTemplate.sequence) as Partial<WineProjectSequenceTemplate> | undefined
    return {
      sequence: defaultTemplate.sequence,
      label: text(candidate?.label, 100) || defaultTemplate.label,
      condition: defaultTemplate.condition,
      subject: text(candidate?.subject, 240) || defaultTemplate.subject,
      body: ensureSenderIntroInText(text(candidate?.body, 5000) || defaultTemplate.body),
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
  // Il funnel corre tutti i giorni, weekend compreso: gli offset configurati
  // (5, 10, ...) valgono dal giorno 1 senza spostamenti.
  const cursor = new Date(Date.UTC(Number(value('year')), Number(value('month')) - 1, Number(value('day'))))
  cursor.setUTCDate(cursor.getUTCDate() + Math.max(0, Math.round(days)))

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
 * Tutte le schede contatto che condividono l'indirizzo di quella data, la sua
 * compresa. Con i re-import della lista lo stesso indirizzo finisce su piu'
 * righe di `contacts`, e fermare una sola riga non ferma la sequenza.
 */
async function contactIdsSharingEmail(supabase: any, userId: string, contactId: string) {
  const { data: contact, error } = await supabase
    .from('contacts')
    .select('email')
    .eq('user_id', userId)
    .eq('id', contactId)
    .maybeSingle()
  if (error) throw error

  const email = String(contact?.email || '').trim().toLowerCase()
  if (!email) return [contactId]

  const { data: twins, error: twinsError } = await supabase
    .from('contacts')
    .select('id')
    .eq('user_id', userId)
    .ilike('email', likeLiteral(email))
  if (twinsError) throw twinsError

  const ids = new Set<string>([contactId])
  for (const twin of twins || []) ids.add(String(twin.id))
  return [...ids]
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
  // Ferma anche le schede duplicate con lo stesso indirizzo: chi ha risposto
  // ha risposto come persona, non come record, e l'email successiva partirebbe
  // comunque dal gemello importato dopo.
  const contactIds = await contactIdsSharingEmail(supabase, userId, contactId)
  const { data, error } = await supabase
    .from('wine_project_followup_events')
    .update({ status: 'skipped', skipped_at: now, skip_reason: reason })
    .eq('user_id', userId)
    .in('contact_id', contactIds)
    .in('status', ['scheduled', 'queued', 'sending'])
    .select('id, sequence')

  if (error) {
    if (isMissingTable(error)) return { stopped: 0, events: [] as Array<{ id: string; sequence: number }> }
    throw error
  }
  return { stopped: data?.length || 0, events: (data || []) as Array<{ id: string; sequence: number }> }
}

const ENROLLMENT_PAGE = 500

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
        // Non si arruola chi ha gia' risposto, si e' disiscritto o ha una
        // scheda gemella chiusa: prima il filtro guardava solo la riga in
        // esame, e la scheda nata dall'ultimo import passava sempre.
        if (await wineSequenceBlockReason(supabase, contact)) continue
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

const CLOSED_WINE_STATUSES = ['Closed', 'Paid', 'Lost']

/** Neutralizza i jolly di LIKE: `_` dentro un indirizzo email e' comunissimo. */
function likeLiteral(value: string) {
  return value.replace(/([\\%_])/g, '\\$1')
}

/**
 * Motivo per cui la sequenza non deve partire ne' proseguire, cercato
 * sull'INDIRIZZO e non sulla singola scheda contatto.
 *
 * Lo stesso indirizzo vive spesso su piu' schede: ogni re-import dalla lista
 * Acumbamail ne crea una nuova. La risposta si attacca alla scheda su cui era
 * sincronizzata la casella, mentre la sequenza gira su quella appena
 * importata, che di quella risposta non sa nulla — ed e' cosi' che una cantina
 * che aveva gia' risposto «non siamo interessati» si e' vista ripartire la
 * sequenza da capo.
 *
 * La risposta si cerca per `from_email` e non per `contact_id`: e' l'unico
 * dato che lega il messaggio alla persona invece che alla scheda, e in piu'
 * scarta i messaggi nostri finiti fra gli inbound perche' spediti da un
 * indirizzo diverso da quello dell'account Gmail collegato.
 */
export async function wineSequenceBlockReason(supabase: any, contact: WineContact) {
  if (contact.email_unsubscribed_at) return 'disiscritto'
  if (CLOSED_WINE_STATUSES.includes(String(contact.status || ''))) return 'trattativa chiusa'

  const email = String(contact.email || '').trim().toLowerCase()
  if (!email) return null
  const pattern = likeLiteral(email)

  const { data: twins, error: twinsError } = await supabase
    .from('contacts')
    .select('id, status, email_unsubscribed_at')
    .eq('user_id', contact.user_id)
    .ilike('email', pattern)
  if (twinsError) throw twinsError
  for (const twin of twins || []) {
    if (twin.id === contact.id) continue
    if (twin.email_unsubscribed_at) return 'disiscritto su scheda duplicata'
    if (CLOSED_WINE_STATUSES.includes(String(twin.status || ''))) return 'trattativa chiusa su scheda duplicata'
  }

  const { count, error: replyError } = await supabase
    .from('gmail_messages')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', contact.user_id)
    .eq('direction', 'inbound')
    .ilike('from_email', pattern)
  if (replyError) throw replyError
  return (count || 0) > 0 ? 'risposta ricevuta' : null
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
    'Questo brief è vincolante: mantieni oggetto, messaggio, riga di presentazione iniziale (“sono Massimo Morgante, fondatore di Speaqi.”) e unica CTA. Personalizza solo nome e azienda; nell’oggetto usa il nome completo del contatto, mentre nel saluto usa solo il nome. Non aggiungere una firma, perché la firma viene aggiunta dal CRM. Quando il testo contiene **parole tra doppio asterisco**, rendile in grassetto solo nel body_html usando <strong>; nel body_text lasciale senza asterischi. La riga nella forma → [ETICHETTA] è il pulsante verso la demo personalizzata della cantina: riportala come riga a sé esattamente uguale, senza inventare un indirizzo e senza trasformarla in un link.',
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
    // Il controllo non ha finestra temporale: una risposta arrivata prima
    // dell'arruolamento vale quanto una arrivata dopo. La versione precedente
    // guardava solo i messaggi successivi alla creazione dell'evento, quindi
    // un re-import bastava a far ripartire la sequenza su chi aveva gia'
    // risposto mesi prima.
    const reason = await wineSequenceBlockReason(supabase, contact)
    if (reason) {
      // Si ferma tutta la coda del contatto (schede gemelle comprese), non il
      // solo evento in scadenza: altrimenti lo stesso motivo va riscoperto una
      // email per volta, e ogni giro ne lascia passare una.
      const stop = await stopWineProjectFollowups(supabase, contact.user_id, contact.id, reason)
      skipped += Math.max(1, stop.stopped)
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
