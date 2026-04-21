import { createContactDraft } from '@/lib/server/gmail'
import type { CRMContact, GmailMessage } from '@/types'

type GeneratedEmail = {
  subject: string
  body_text: string
  body_html: string
}

type DraftSettings = {
  speaqi_context?: string | null
  email_tone?: string | null
  email_signature?: string | null
}

type DraftContext = {
  messages: GmailMessage[]
  previousOutboundCount: number
  previousInboundCount: number
  latestOutbound: GmailMessage | null
  hasInboundAfterLatestOutbound: boolean
}

function summarizeMessageBody(message: GmailMessage) {
  return String(message.body_text || message.snippet || '').replace(/\s+/g, ' ').trim().slice(0, 220)
}

function summarizeThread(messages: GmailMessage[]) {
  return messages
    .slice(-6)
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

async function loadDraftSettings(supabase: any, userId: string): Promise<DraftSettings> {
  const { data } = await supabase
    .from('user_settings')
    .select('speaqi_context, email_tone, email_signature')
    .eq('user_id', userId)
    .maybeSingle()

  return data ?? {}
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
    .limit(20)

  if (error) throw error
  return (data || []) as GmailMessage[]
}

async function generateEmail(input: {
  contactName: string
  contactEmail: string
  company?: string | null
  lastActivitySummary?: string | null
  leadMemory?: string | null
  speaqiContext?: string | null
  emailTone?: string | null
  emailSignature?: string | null
  note?: string | null
  threadSummary?: string | null
  followupMode?: boolean
}): Promise<GeneratedEmail | null> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null

  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini'

  const system = [
    'Sei un assistente commerciale che scrive email per conto di un venditore.',
    'Scrivi email professionali, concise, in italiano, in prima persona.',
    'NON usare frasi generiche come "spero che tu stia bene". Vai dritto al punto.',
    input.followupMode
      ? 'Stai scrivendo un follow-up su una conversazione gia iniziata. Non ripartire da zero e non sembrare una prima email fredda.'
      : 'Stai scrivendo una prima bozza commerciale o una ripresa iniziale del contatto.',
    input.speaqiContext ? `\n## Contesto prodotto/azienda\n${input.speaqiContext}` : '',
    input.emailTone ? `\n## Tono richiesto\n${input.emailTone}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  const user = [
    '## Destinatario',
    `Nome: ${input.contactName}`,
    input.company ? `Azienda: ${input.company}` : '',
    `Email: ${input.contactEmail}`,
    input.lastActivitySummary ? `\n## Ultimo aggiornamento sul contatto\n${input.lastActivitySummary}` : '',
    input.leadMemory ? `\n## Storia e note sul lead\n${input.leadMemory}` : '',
    input.threadSummary ? `\n## Storico email\n${input.threadSummary}` : '',
    input.note ? `\n## Messaggio chiave da tenere in questa email\n${input.note}` : '',
    input.emailSignature ? `\n## Firma da usare\n${input.emailSignature}` : '',
    '\n## Istruzioni',
    input.followupMode
      ? 'Genera un follow-up breve e naturale, coerente con le email gia inviate e senza inventare fatti non presenti nello storico.'
      : 'Genera una prima email breve e concreta.',
    'Rispondi in JSON con i campi: subject (stringa), body_text (testo plain), body_html (HTML semplice).',
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
        max_tokens: 800,
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
  note?: string | null
) {
  if (!contact.email) {
    return { error: 'Email mancante' as const }
  }

  const [settings, leadMemory, messages] = await Promise.all([
    loadDraftSettings(supabase, userId),
    loadLeadMemory(supabase, userId, contact.id),
    loadContactMessages(supabase, userId, contact.id),
  ])

  const threadContext = buildDraftContext(messages)
  const effectiveNote = String(note ?? (contact.email_draft_note || '')).trim() || null
  const followupMode = !!threadContext.latestOutbound && !threadContext.hasInboundAfterLatestOutbound

  const generated = await generateEmail({
    contactName: contact.name,
    contactEmail: contact.email,
    company: contact.company,
    lastActivitySummary: contact.last_activity_summary,
    leadMemory,
    speaqiContext: settings.speaqi_context || null,
    emailTone: settings.email_tone || null,
    emailSignature: settings.email_signature || null,
    note: effectiveNote,
    threadSummary: messages.length ? summarizeThread(threadContext.messages) : null,
    followupMode,
  })

  if (!generated) {
    return { error: 'Generazione AI fallita' as const }
  }

  try {
    const draft = await createContactDraft(
      supabase,
      userId,
      {
        email: contact.email,
        name: contact.name,
      },
      {
      subject: generated.subject,
      html: generated.body_html,
      text: generated.body_text,
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
