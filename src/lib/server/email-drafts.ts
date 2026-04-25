import {
  appendEmailSignature,
  createContactDraft,
  loadGmailSignature,
  simpleTextToHtml,
  signatureFromPlainText,
  type EmailSignature,
} from '@/lib/server/gmail'
import { loadUserSettings, type UserSettings } from '@/lib/server/user-settings'
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
}): Promise<GeneratedEmail | null> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null

  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini'

  const system = [
    'Sei un assistente commerciale che scrive email per conto di un venditore.',
    'Scrivi email professionali, concrete, in italiano, in prima persona.',
    'NON usare frasi generiche come "spero che tu stia bene". Vai dritto al punto.',
    'Non inventare dati, prezzi, disponibilita, meeting o promesse non presenti nel contesto.',
    'Non inserire la firma: il CRM la aggiunge dopo, usando la firma Gmail quando disponibile.',
    'Struttura richiesta: saluto naturale, motivo del contatto, valore specifico, eventuali 2-3 bullet se aiutano, CTA chiara con una sola prossima azione.',
    'Il corpo deve essere leggibile anche in plain text: paragrafi brevi, niente blocchi lunghi.',
    input.followupMode
      ? 'Stai scrivendo un follow-up su una conversazione gia iniziata. Non ripartire da zero e non sembrare una prima email fredda.'
      : 'Stai scrivendo una prima bozza commerciale o una ripresa iniziale del contatto.',
    input.speaqiContext ? `\n## Contesto prodotto/azienda\n${input.speaqiContext}` : '',
    input.emailTone ? `\n## Tono richiesto\n${input.emailTone}` : '',
    input.settings?.email_target_audience ? `\n## Target ideale\n${input.settings.email_target_audience}` : '',
    input.settings?.email_value_proposition ? `\n## Valore da comunicare\n${input.settings.email_value_proposition}` : '',
    input.settings?.email_offer_details ? `\n## Offerta / proposta\n${input.settings.email_offer_details}` : '',
    input.settings?.email_proof_points ? `\n## Prove, esempi, credibilita\n${input.settings.email_proof_points}` : '',
    input.settings?.email_objection_notes ? `\n## Obiezioni, limiti e cose da evitare\n${input.settings.email_objection_notes}` : '',
    input.settings?.email_call_to_action ? `\n## CTA preferita\n${input.settings.email_call_to_action}` : '',
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
      ? 'Genera un follow-up naturale, coerente con le email gia inviate, con riferimento al punto concreto rimasto aperto.'
      : 'Genera una prima email concreta, con apertura personalizzata solo se il contesto lo giustifica.',
    'Oggetto: specifico e breve, senza emoji e senza maiuscole aggressive.',
    'HTML: usa solo tag semplici (<p>, <ul>, <li>, <br>, <strong>) e niente CSS inline complesso.',
    'Rispondi solo in JSON con i campi: subject (stringa), body_text (testo plain), body_html (HTML semplice).',
  ]
    .filter(Boolean)
    .join('\n')

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
          { role: 'user', content: user },
        ],
        max_tokens: 1400,
        temperature: 0.7,
      }),
    })

    if (!response.ok) return null

    const payload = await response.json()
    const text = payload?.choices?.[0]?.message?.content
    if (!text) return null

    return JSON.parse(text) as GeneratedEmail
  } catch {
    return null
  }
}

export async function createGeneratedContactDraft(
  supabase: any,
  userId: string,
  contact: CRMContact,
  note?: string | null,
  shared?: {
    settings?: UserSettings
    emailSignature?: EmailSignature | null
  }
) {
  if (!contact.email) {
    return { error: 'Email mancante' as const }
  }

  const [settings, leadMemory, messages, activitySummary, gmailSignature] = await Promise.all([
    shared?.settings ? Promise.resolve(shared.settings) : loadUserSettings(supabase, userId),
    loadLeadMemory(supabase, userId, contact.id),
    loadContactMessages(supabase, userId, contact.id),
    loadRecentActivityContext(supabase, userId, contact.id),
    shared && 'emailSignature' in shared
      ? Promise.resolve(shared.emailSignature || null)
      : loadGmailSignature(supabase, userId).catch(() => null),
  ])

  const threadContext = buildDraftContext(messages)
  const effectiveNote = String(note ?? (contact.email_draft_note || '')).trim() || null
  const followupMode = !!threadContext.latestOutbound && !threadContext.hasInboundAfterLatestOutbound

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
  })

  if (!generated) {
    return { error: 'Generazione AI fallita' as const }
  }

  try {
    const generatedText = String(generated.body_text || '').trim()
    const generatedHtml = String(generated.body_html || '').trim()
    const signature = gmailSignature || signatureFromPlainText(settings.email_signature)
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
