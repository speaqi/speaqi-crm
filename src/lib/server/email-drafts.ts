import {
  appendEmailSignature,
  createContactDraft,
  loadGmailSignature,
  loadRequiredGmailSignature,
  simpleTextToHtml,
  type EmailSignature,
} from '@/lib/server/gmail'
import { EMPTY_USER_SETTINGS, loadUserSettings, type UserSettings } from '@/lib/server/user-settings'
import {
  buildEmailSegmentGuidance,
  formatPublicOrganizationResearch,
  researchPublicOrganization,
  validatePublicOrganizationDraft,
} from '@/lib/server/email-draft-context'
import { buildEmailAiPolicy } from '@/lib/email-ai-framework'
import type { CRMContact, GmailMessage } from '@/types'

type GeneratedEmail = {
  subject: string
  body_text: string
  body_html: string
}

type DraftContext = {
  messages: GmailMessage[]
  previousOutboundCount: number
  previousInboundCount: number
  latestOutbound: GmailMessage | null
  hasInboundAfterLatestOutbound: boolean
}

function summarizeMessageBody(message: GmailMessage) {
  return String(message.body_text || message.snippet || '').replace(/\s+/g, ' ').trim().slice(0, 650)
}

function summarizeThread(messages: GmailMessage[]) {
  return messages
    .slice(-12)
    .map((message) => {
      const sentAt = message.sent_at
        ? new Date(message.sent_at).toLocaleString('it-IT', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })
        : 'data non disponibile'

      return [
        `- ${message.direction === 'outbound' ? 'Email inviata' : 'Email ricevuta'} (${sentAt})`,
        message.subject ? `  Oggetto: ${message.subject}` : null,
        summarizeMessageBody(message) ? `  Testo: ${summarizeMessageBody(message)}` : null,
      ]
        .filter(Boolean)
        .join('\n')
    })
    .join('\n')
}

function buildDraftContext(messages: GmailMessage[]): DraftContext {
  const ordered = [...messages].sort(
    (left, right) => new Date(left.sent_at || left.created_at).getTime() - new Date(right.sent_at || right.created_at).getTime()
  )
  const latestOutbound = [...ordered].reverse().find((message) => message.direction === 'outbound') || null
  const latestOutboundTime = latestOutbound ? new Date(latestOutbound.sent_at || latestOutbound.created_at).getTime() : null

  return {
    messages: ordered,
    previousOutboundCount: ordered.filter((message) => message.direction === 'outbound').length,
    previousInboundCount: ordered.filter((message) => message.direction === 'inbound').length,
    latestOutbound,
    hasInboundAfterLatestOutbound:
      latestOutboundTime !== null &&
      ordered.some(
        (message) =>
          message.direction === 'inbound' &&
          new Date(message.sent_at || message.created_at).getTime() > latestOutboundTime
      ),
  }
}

async function loadLeadMemory(supabase: any, userId: string, contactId: string) {
  const { data } = await supabase
    .from('lead_memories')
    .select('memory')
    .eq('user_id', userId)
    .eq('contact_id', contactId)
    .maybeSingle()

  return data?.memory || null
}

async function loadContactMessages(supabase: any, userId: string, contactId: string) {
  const { data, error } = await supabase
    .from('gmail_messages')
    .select('*')
    .eq('user_id', userId)
    .eq('contact_id', contactId)
    .order('sent_at', { ascending: true, nullsFirst: true })
    .limit(50)

  if (error) throw error
  return (data || []) as GmailMessage[]
}

async function loadRecentActivityContext(supabase: any, userId: string, contactId: string) {
  const { data, error } = await supabase
    .from('activities')
    .select('type, content, metadata, created_at')
    .eq('user_id', userId)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: false })
    .limit(10)

  if (error) throw error

  return (data || [])
    .reverse()
    .map((activity: any) => {
      const createdAt = activity.created_at
        ? new Date(activity.created_at).toLocaleString('it-IT', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })
        : 'data non disponibile'
      const type = String(activity.type || 'attivita')
      const content = String(activity.content || '').replace(/\s+/g, ' ').trim()
      return content ? `- ${type} (${createdAt}): ${content.slice(0, 500)}` : null
    })
    .filter(Boolean)
    .join('\n')
}

async function generateEmail(input: {
  contact: CRMContact
  company?: string | null
  lastActivitySummary?: string | null
  leadMemory?: string | null
  speaqiContext?: string | null
  emailTone?: string | null
  settings?: UserSettings
  note?: string | null
  threadSummary?: string | null
  activitySummary?: string | null
  followupMode?: boolean
  publicResearch?: string | null
}): Promise<GeneratedEmail | null> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null

  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini'
  const segmentGuidance = buildEmailSegmentGuidance(input.contact)

  const system = [
    'Sei un senior sales copywriter che prepara bozze email commerciali per conto del venditore.',
    'Usa come fonte di verita esclusivamente il contesto aziendale, i dati del contatto e la cronologia forniti sotto.',
    'Scrivi nella lingua del contatto quando il campo lingua e valorizzato; altrimenti scrivi in italiano.',
    'Scrivi in prima persona, con tono umano, professionale e concreto.',
    'Apri sempre con un saluto: “Buongiorno Nome,” se il nome e affidabile, altrimenti “Buongiorno,”. Non usare frasi generiche come “spero che tu stia bene”; dopo il saluto vai dritto al punto.',
    'Non inventare dati, prezzi, disponibilita, meeting o promesse non presenti nel contesto.',
    'Non inventare una personalizzazione: se i dati non bastano, usa un motivo del contatto onesto e specifico per il segmento.',
    'Non scrivere mai che il destinatario ha mostrato interesse, aperto, cliccato o risposto a una campagna se questo fatto non compare esplicitamente nello storico email fornito. Non usare “campagna” come aggancio generico.',
    'Non descrivere servizi o capacita che non compaiono nel contesto aziendale.',
    'Non inserire la firma: il CRM la aggiunge dopo, usando la firma Gmail quando disponibile.',
    'Struttura: saluto, apertura rilevante, problema o opportunita osservabile, valore specifico, una sola CTA semplice che chieda un riscontro per una call di 15 minuti con il referente appropriato.',
    'Mantieni il corpo tra 70 e 140 parole, salvo che la cronologia richieda una risposta piu articolata.',
    'Evita autocelebrazioni, buzzword, elenchi di servizi e frasi vaghe come "potrebbe interessarti".',
    'L oggetto deve essere breve, specifico e collegato al caso del destinatario.',
    input.followupMode
      ? 'Stai scrivendo un follow-up su una conversazione gia iniziata. Non ripartire da zero: riprendi un punto concreto dell’ultima email inviata o della risposta ricevuta, usando solo lo storico fornito.'
      : 'Stai scrivendo una prima bozza commerciale o una ripresa iniziale del contatto.',
    buildEmailAiPolicy({
      ...input.settings,
      speaqi_context: input.speaqiContext || input.settings?.speaqi_context,
      email_tone: input.emailTone || input.settings?.email_tone,
    }),
    segmentGuidance ? `\n## Indicazioni specifiche per questo segmento\n${segmentGuidance}` : '',
    input.publicResearch || '',
  ]
    .filter(Boolean)
    .join('\n')

  const contact = input.contact
  const user = [
    '## Destinatario',
    `Nome: ${contact.name}`,
    contact.company ? `Azienda: ${contact.company}` : '',
    contact.category ? `Categoria: ${contact.category}` : '',
    contact.status ? `Stato CRM: ${contact.status}` : '',
    contact.source ? `Origine: ${contact.source}` : '',
    contact.event_tag ? `Evento/tag: ${contact.event_tag}` : '',
    contact.list_name ? `Lista: ${contact.list_name}` : '',
    contact.country ? `Paese: ${contact.country}` : '',
    contact.language ? `Lingua: ${contact.language}` : '',
    contact.responsible ? `Responsabile: ${contact.responsible}` : '',
    `Email: ${contact.email}`,
    contact.note ? `\n## Note scheda contatto\n${contact.note}` : '',
    input.lastActivitySummary ? `\n## Ultimo aggiornamento sul contatto\n${input.lastActivitySummary}` : '',
    input.leadMemory ? `\n## Storia e note sul lead\n${input.leadMemory}` : '',
    input.activitySummary ? `\n## Attivita recenti e note operative\n${input.activitySummary}` : '',
    input.threadSummary ? `\n## Storico email\n${input.threadSummary}` : '',
    input.note ? `\n## Contesto specifico per questa bozza\n${input.note}` : '',
    '\n## Istruzioni',
    input.followupMode
      ? 'Genera un follow-up naturale. Per un Comune o una casella istituzionale apri il primo paragrafo ricordando con tatto che avevamo inviato un’email qualche tempo fa, poi chiedi un breve incontro per spiegare le possibilita di Speaqi e di essere indirizzati al referente competente.'
      : 'Genera una prima email concreta, con apertura personalizzata solo se il contesto lo giustifica.',
    'Oggetto: specifico e breve, senza emoji e senza maiuscole aggressive.',
    'HTML: usa solo tag semplici (<p>, <ul>, <li>, <br>, <strong>) e niente CSS inline complesso.',
    'Rispondi solo in JSON con i campi: subject (stringa), body_text (testo plain), body_html (HTML semplice).',
  ]
    .filter(Boolean)
    .join('\n')

  let correction = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: correction ? `${user}\n\n## Correzioni obbligatorie\n${correction}` : user },
          ],
          max_tokens: 1400,
          temperature: attempt === 0 ? 0.7 : 0.35,
        }),
      })

      if (!response.ok) return null
      const payload = await response.json()
      const text = payload?.choices?.[0]?.message?.content
      if (!text) return null

      const generated = JSON.parse(text) as GeneratedEmail
      const issues = validatePublicOrganizationDraft(input.contact, generated, !!input.followupMode)
      if (!issues.length) return generated
      correction = issues.map((issue) => `- ${issue}`).join('\n')
    } catch {
      return null
    }
  }

  return null
}

export async function createGeneratedContactDraft(
  supabase: any,
  userId: string,
  contact: CRMContact,
  note?: string | null,
  shared?: {
    settings?: UserSettings
    emailSignature?: EmailSignature | null
    forceFollowup?: boolean
  }
) {
  if (!contact.email) {
    return { error: 'Email mancante' as const }
  }

  const [settings, leadMemory, messages, activitySummary, gmailSignature, publicResearch] = await Promise.all([
    shared?.settings
      ? Promise.resolve(shared.settings)
      : loadUserSettings(supabase, userId).catch(() => EMPTY_USER_SETTINGS),
    loadLeadMemory(supabase, userId, contact.id).catch(() => null),
    loadContactMessages(supabase, userId, contact.id).catch(() => []),
    loadRecentActivityContext(supabase, userId, contact.id).catch(() => ''),
    shared && 'emailSignature' in shared
      ? Promise.resolve(shared.emailSignature || null)
      : loadRequiredGmailSignature(supabase, userId),
    researchPublicOrganization(contact).catch(() => null),
  ])

  const threadContext = buildDraftContext(messages)
  const effectiveNote = String(note ?? (contact.email_draft_note || '')).trim() || null
  const followupMode = !!shared?.forceFollowup ||
    (!!threadContext.latestOutbound && !threadContext.hasInboundAfterLatestOutbound)

  const generated = await generateEmail({
    contact,
    lastActivitySummary: contact.last_activity_summary,
    leadMemory,
    speaqiContext: settings.speaqi_context || null,
    emailTone: settings.email_tone || null,
    settings,
    note: effectiveNote,
    activitySummary,
    threadSummary: messages.length ? summarizeThread(threadContext.messages) : null,
    followupMode,
    publicResearch: formatPublicOrganizationResearch(publicResearch),
  })

  if (!generated) {
    return { error: 'Generazione AI fallita' as const }
  }

  try {
    const generatedText = String(generated.body_text || '').trim()
    const generatedHtml = String(generated.body_html || '').trim()
    const signature = gmailSignature
    if (!signature?.html && !signature?.text) {
      return { error: 'Firma Gmail non trovata: configura una firma in Gmail e poi rigenera la bozza.' as const }
    }
    const signed = appendEmailSignature(
      {
        html: generatedHtml || simpleTextToHtml(generatedText),
        text: generatedText || generatedHtml,
      },
      signature
    )
    const draft = await createContactDraft(
      supabase,
      userId,
      {
        email: contact.email,
        name: contact.name,
      },
      {
        subject: generated.subject,
        html: signed.html,
        text: signed.text,
        appendSignature: false,
      }
    )

    if (!draft) {
      return { error: 'Gmail non collegato o scope mancante' as const }
    }

    return {
      draftId: draft.draftId,
      generated,
      context: threadContext,
    }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Errore Gmail',
    }
  }
}

export async function maybeAutoCreateFollowupDraft(
  supabase: any,
  userId: string,
  contact: CRMContact
) {
  const messages = await loadContactMessages(supabase, userId, contact.id)
  const context = buildDraftContext(messages)

  if (!context.latestOutbound) return null
  if (context.hasInboundAfterLatestOutbound) return null

  const priorMessages = context.messages.filter(
    (message) => message.gmail_message_id !== context.latestOutbound?.gmail_message_id
  )

  if (!priorMessages.length) return null

  const result = await createGeneratedContactDraft(supabase, userId, contact)
  if ('error' in result) return null

  return result
}
