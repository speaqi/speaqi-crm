import { NextRequest } from 'next/server'
import { formatActivityDate, syncPendingCallTask, updateContactSummary, createActivities } from '@/lib/server/crm'
import { requireRouteUser } from '@/lib/server/supabase'
import { isCallableDate, isClosedStatus } from '@/lib/data'

type VoiceContactCandidate = {
  id: string
  name: string
  phone?: string | null
  email?: string | null
  legacy_id?: string | null
  status: string
  priority: number
  next_followup_at?: string | null
}

type VoiceIntent = {
  action: 'schedule_followup' | 'unsupported'
  contact_id: string | null
  scheduled_for: string | null
  note: string | null
  reply: string
  confidence: number
}

const VOICE_REFERENCE_STOPWORDS = new Set([
  'adesso',
  'azienda',
  'chiama',
  'chiamare',
  'chiamami',
  'cliente',
  'company',
  'contatta',
  'contattare',
  'contatto',
  'crm',
  'da',
  'devo',
  'di',
  'domani',
  'email',
  'fai',
  'follow',
  'followup',
  'follow-up',
  'il',
  'la',
  'lo',
  'oggi',
  'per',
  'promemoria',
  'promemoriami',
  'promemoriati',
  'ricontatta',
  'ricontattare',
  'ricorda',
  'ricordami',
  'ricordare',
  'richiama',
  'richiamare',
  'su',
  'task',
  'tra',
  'un',
  'una',
])

function normalizeText(value?: string | null) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function digitsOnly(value?: string | null) {
  return String(value || '').replace(/\D+/g, '')
}

function extractTextOutput(payload: any) {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text.trim()
  }

  const output = Array.isArray(payload?.output) ? payload.output : []
  for (const item of output) {
    if (item?.type !== 'message' || !Array.isArray(item.content)) continue
    for (const part of item.content) {
      if (part?.type === 'output_text' && typeof part.text === 'string' && part.text.trim()) {
        return part.text.trim()
      }
    }
  }

  return ''
}

function extractReferenceTokens(transcript: string) {
  const normalized = normalizeText(transcript)
  const tokens = normalized
    .split(/\s+/)
    .filter((token) => token.length >= 2 && !VOICE_REFERENCE_STOPWORDS.has(token))
  const digitTokens = Array.from(new Set((transcript.match(/\d{3,}/g) || []).map((token) => token.trim())))
  return {
    normalized,
    referenceText: tokens.join(' ').trim(),
    tokens,
    digitTokens,
  }
}

function scoreCandidate(transcript: string, candidate: VoiceContactCandidate) {
  const { normalized, referenceText, tokens, digitTokens } = extractReferenceTokens(transcript)
  const candidateName = normalizeText(candidate.name)
  const candidateEmail = normalizeText(candidate.email)
  const candidatePhoneDigits = digitsOnly(candidate.phone)
  const candidateLegacyId = normalizeText(candidate.legacy_id)
  let score = 0

  for (const token of digitTokens) {
    if (candidatePhoneDigits && candidatePhoneDigits.includes(token)) score += 120
    if (candidateLegacyId && candidateLegacyId.includes(token)) score += 140
  }

  if (candidateName && normalized.includes(candidateName)) score += 100
  if (referenceText && candidateName.includes(referenceText)) score += 140
  if (referenceText && referenceText.includes(candidateName)) score += 90

  for (const token of tokens) {
    if (candidateName.includes(token)) score += Math.min(45, token.length * 8)
    if (candidateEmail.includes(token)) score += Math.min(18, token.length * 3)
  }

  if (!isClosedStatus(candidate.status)) score += 4
  score += Math.max(0, Number(candidate.priority || 0))

  return score
}

function buildCandidateList(transcript: string, contacts: VoiceContactCandidate[]) {
  const ranked = contacts
    .map((contact) => ({ contact, score: scoreCandidate(transcript, contact) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 12)

  if (ranked.length > 0) {
    return ranked.map((item) => item.contact)
  }

  return []
}

function moveToCallableDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null

  if (/^\d{4}-\d{2}-\d{2}$/.test(value) || (date.getHours() === 0 && date.getMinutes() === 0)) {
    date.setHours(10, 0, 0, 0)
  }

  while (!isCallableDate(date)) {
    date.setDate(date.getDate() + 1)
  }

  return date.toISOString()
}

async function interpretVoiceCommand(transcript: string, candidates: VoiceContactCandidate[]) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY non configurata')
  }

  const model = process.env.OPENAI_MODEL || 'gpt-5-mini'
  const nowInRome = new Intl.DateTimeFormat('sv-SE', {
    dateStyle: 'short',
    timeStyle: 'medium',
    timeZone: 'Europe/Rome',
  }).format(new Date())

  const candidateSummary = candidates
    .map((candidate) =>
      [
        `id=${candidate.id}`,
        `name=${candidate.name}`,
        candidate.phone ? `phone=${candidate.phone}` : null,
        candidate.email ? `email=${candidate.email}` : null,
        candidate.legacy_id ? `legacy_id=${candidate.legacy_id}` : null,
        `status=${candidate.status}`,
        `priority=${candidate.priority}`,
      ]
        .filter(Boolean)
        .join(' | ')
    )
    .join('\n')

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      reasoning: { effort: 'minimal' },
      text: {
        format: {
          type: 'json_schema',
          name: 'crm_voice_command',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              action: {
                type: 'string',
                enum: ['schedule_followup', 'unsupported'],
              },
              contact_id: {
                type: ['string', 'null'],
              },
              scheduled_for: {
                type: ['string', 'null'],
              },
              note: {
                type: ['string', 'null'],
              },
              reply: {
                type: 'string',
              },
              confidence: {
                type: 'number',
                minimum: 0,
                maximum: 1,
              },
            },
            required: ['action', 'contact_id', 'scheduled_for', 'note', 'reply', 'confidence'],
          },
        },
      },
      input: [
        {
          role: 'system',
          content: [
            {
              type: 'input_text',
              text:
                'Interpreti comandi vocali CRM in italiano. Devi supportare solo la pianificazione di una chiamata o follow-up. ' +
                'Scegli action=schedule_followup solo se l\'utente chiede chiaramente di ricordare, chiamare, richiamare o fare follow-up. ' +
                'Il contatto puo essere nominato come persona, ente, azienda o organizzazione. ' +
                'Puoi usare solo i contact_id presenti nei candidati. Se il match non e affidabile o la richiesta non e supportata, usa action=unsupported e contact_id=null. ' +
                'Quando manca l\'orario usa le 10:00 nel fuso Europe/Rome. Restituisci scheduled_for in ISO 8601 completo con fuso orario. ' +
                'Rispondi in italiano con un reply breve e operativo.',
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text:
                `Data e ora correnti Europe/Rome: ${nowInRome}\n` +
                `Trascrizione: ${transcript}\n\n` +
                `Candidati contatto:\n${candidateSummary || 'Nessun candidato disponibile.'}`,
            },
          ],
        },
      ],
    }),
  })

  const payload = await response.json()
  if (!response.ok) {
    throw new Error(payload?.error?.message || 'OpenAI request failed')
  }

  const text = extractTextOutput(payload)
  if (!text) {
    throw new Error('Risposta OpenAI vuota')
  }

  return JSON.parse(text) as VoiceIntent
}

export async function POST(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const body = await request.json()
    const transcript = String(body.transcript || '').trim()

    if (!transcript) {
      return Response.json({ error: 'La trascrizione e obbligatoria' }, { status: 400 })
    }

    const workspaceUserId = auth.workspaceUserId

    const { data: contacts, error: contactsError } = await auth.supabase
      .from('contacts')
      .select('id, name, phone, email, legacy_id, status, priority, next_followup_at')
      .eq('user_id', workspaceUserId)
      .order('updated_at', { ascending: false })

    if (contactsError) throw contactsError

    const candidateList = buildCandidateList(transcript, (contacts || []) as VoiceContactCandidate[])
    if (candidateList.length === 0) {
      return Response.json({
        executed: false,
        reply: 'Non trovo nessuna scheda compatibile con il comando vocale. Prova con un nome, un telefono o un ID piu preciso.',
        confidence: 0,
        candidates: [],
      })
    }

    const intent = await interpretVoiceCommand(transcript, candidateList)

    if (intent.action !== 'schedule_followup' || !intent.contact_id || !intent.scheduled_for) {
      return Response.json({
        executed: false,
        reply: intent.reply || 'Non sono riuscito a capire quale contatto aggiornare.',
        confidence: intent.confidence || 0,
        candidates: candidateList,
      })
    }

    const selectedContact = candidateList.find((candidate) => candidate.id === intent.contact_id)
    if (!selectedContact) {
      return Response.json({
        executed: false,
        reply: 'Il comando e stato capito, ma il contatto non e tra i candidati affidabili.',
        confidence: intent.confidence || 0,
        candidates: candidateList,
      })
    }

    if (isClosedStatus(selectedContact.status)) {
      return Response.json({
        executed: false,
        reply: `Il contatto ${selectedContact.name} risulta chiuso. Riaprilo prima di pianificare un nuovo follow-up.`,
        confidence: intent.confidence || 0,
      })
    }

    const scheduledFor = moveToCallableDate(intent.scheduled_for)
    if (!scheduledFor) {
      return Response.json({
        executed: false,
        reply: 'Non sono riuscito a interpretare la data del promemoria.',
        confidence: intent.confidence || 0,
      })
    }

    const taskNote = intent.note?.trim() || `Comando vocale: ${transcript}`
    const task = await syncPendingCallTask(auth.supabase, workspaceUserId, selectedContact.id, scheduledFor, {
      type: 'follow-up',
      note: taskNote,
      overwriteNote: true,
    })

    const activityContent = `Comando vocale: "${transcript}". Follow-up pianificato per ${formatActivityDate(scheduledFor)}.`

    await createActivities(auth.supabase, [
      {
        user_id: workspaceUserId,
        contact_id: selectedContact.id,
        type: 'system',
        content: activityContent,
      },
    ])

    await updateContactSummary(auth.supabase, selectedContact.id, activityContent, {
      nextFollowupAt: scheduledFor,
    })

    const { data: contact, error: contactError } = await auth.supabase
      .from('contacts')
      .select('*')
      .eq('user_id', workspaceUserId)
      .eq('id', selectedContact.id)
      .single()

    if (contactError) throw contactError

    return Response.json({
      executed: true,
      reply: intent.reply || `Promemoria impostato per ${contact.name}.`,
      confidence: intent.confidence || 0,
      contact,
      task,
      scheduled_for: scheduledFor,
    })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Voice command failed' },
      { status: 500 }
    )
  }
}
