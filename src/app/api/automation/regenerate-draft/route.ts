import { NextRequest } from 'next/server'
import { requireRouteUser } from '@/lib/server/supabase'
import { errorMessage } from '@/lib/server/http'
import { EMPTY_USER_SETTINGS, loadUserSettings } from '@/lib/server/user-settings'
import { buildEmailAiPolicy } from '@/lib/email-ai-framework'
import {
  buildEmailSegmentGuidance,
  formatPublicOrganizationResearch,
  researchPublicOrganization,
  validatePublicOrganizationDraft,
} from '@/lib/server/email-draft-context'
import type { CRMContact, GmailMessage } from '@/types'

// ─── Context loading (shared with orchestrator) ───

async function loadContactContext(supabase: any, contactId: string) {
  const [messagesResult, memoryResult, activitiesResult] = await Promise.all([
    supabase
      .from('gmail_messages')
      .select('*')
      .eq('contact_id', contactId)
      .order('sent_at', { ascending: true, nullsFirst: true })
      .limit(30),
    supabase
      .from('lead_memories')
      .select('memory')
      .eq('contact_id', contactId)
      .maybeSingle(),
    supabase
      .from('activities')
      .select('type, content, created_at')
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false })
      .limit(10),
  ])

  const messages = (messagesResult.data || []) as GmailMessage[]
  const leadMemory = memoryResult.data?.memory || null
  const activities = (activitiesResult.data || []).reverse()

  return { messages, leadMemory, activities }
}

// ─── AI generation (same logic as orchestrator) ───

async function callOpenAI(
  apiKey: string,
  model: string,
  system: string,
  userPrompt: string,
  retries = 2
): Promise<{ subject: string; body_text: string; body_html: string }> {
  let lastError: string | null = null

  for (let attempt = 0; attempt <= retries; attempt++) {
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
            { role: 'user', content: userPrompt },
          ],
          max_tokens: 1400,
          temperature: 0.7,
        }),
      })

      if (!response.ok) {
        const status = response.status
        const body = await response.text().catch(() => '')
        lastError = `HTTP ${status}${body ? ': ' + body.slice(0, 200) : ''}`
        if ((status === 429 || status >= 500) && attempt < retries) {
          await new Promise((r) => setTimeout(r, 1500 * Math.pow(2, attempt)))
          continue
        }
        console.error(`[regenerate-draft] OpenAI error: ${lastError}`)
        throw new Error(lastError)
      }

      const payload = await response.json()
      const text = payload?.choices?.[0]?.message?.content
      if (!text) {
        lastError = 'Empty response from OpenAI'
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, 800 * (attempt + 1)))
          continue
        }
        console.error(`[regenerate-draft] ${lastError}`)
        throw new Error(lastError)
      }

      try {
        return JSON.parse(text) as { subject: string; body_text: string; body_html: string }
      } catch {
        lastError = `Invalid JSON: ${text.slice(0, 150)}`
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, 800 * (attempt + 1)))
          continue
        }
        console.error(`[regenerate-draft] ${lastError}`)
        throw new Error(lastError)
      }
    } catch (err) {
      if (err instanceof Error && err.message === lastError) continue
      if (attempt < retries && !(err instanceof Error && err.message.includes('Invalid JSON'))) {
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)))
        continue
      }
      throw err
    }
  }

  throw new Error(lastError || 'Draft regeneration failed')
}

async function regenerateDraft(
  contact: CRMContact,
  context: Awaited<ReturnType<typeof loadContactContext>>,
  apiKey: string,
  model: string,
  settings?: typeof EMPTY_USER_SETTINGS | null,
  note?: string | null
) {
  const { messages, leadMemory, activities } = context

  const threadSummary = messages
    .slice(-12)
    .map((m: any) => {
      const sentAt = m.sent_at
        ? new Date(m.sent_at).toLocaleString('it-IT', {
            day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
          })
        : 'data non disponibile'
      const subject = m.subject ? `  Oggetto: ${m.subject}` : ''
      const body = String(m.body_text || m.snippet || '').replace(/\s+/g, ' ').trim().slice(0, 650)
      return [
        `- ${m.direction === 'outbound' ? 'Email inviata' : 'Email ricevuta'} (${sentAt})`,
        subject,
        body ? `  Testo: ${body}` : '',
      ].filter(Boolean).join('\n')
    })
    .join('\n')

  const activitySummary = activities
    .map((a: any) => {
      const date = a.created_at
        ? new Date(a.created_at).toLocaleString('it-IT', { day: '2-digit', month: '2-digit' })
        : ''
      const content = String(a.content || '').replace(/\s+/g, ' ').trim()
      return content ? `- ${a.type} (${date}): ${content.slice(0, 400)}` : null
    })
    .filter(Boolean)
    .join('\n')

  const ordered = [...messages].sort(
    (a: any, b: any) => new Date(a.sent_at || a.created_at).getTime() - new Date(b.sent_at || b.created_at).getTime()
  )
  const latestOutbound = [...ordered].reverse().find((m: any) => m.direction === 'outbound') || null
  const latestOutboundTime = latestOutbound ? new Date(latestOutbound.sent_at || latestOutbound.created_at).getTime() : null
  const hasInboundAfterLatestOutbound = latestOutboundTime !== null &&
    ordered.some((m: any) => m.direction === 'inbound' && new Date(m.sent_at || m.created_at).getTime() > latestOutboundTime)
  const followupMode = !!latestOutbound && !hasInboundAfterLatestOutbound
  const previousOutboundCount = ordered.filter((m: any) => m.direction === 'outbound').length
  const previousInboundCount = ordered.filter((m: any) => m.direction === 'inbound').length

  let threadState = ''
  if (followupMode) {
    threadState = `Hai già inviato ${previousOutboundCount} email a questo contatto (l'ultima in data ${latestOutbound ? new Date(latestOutbound.sent_at || latestOutbound.created_at).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'sconosciuta'}). Il contatto non ha ancora risposto. Stai scrivendo un follow-up — NON ripartire da zero, NON sembrare una prima email fredda.`
  } else if (previousInboundCount > 0 && !hasInboundAfterLatestOutbound) {
    threadState = `Il contatto ha inviato ${previousInboundCount} email ma non hai ancora risposto all'ultima. Stai rispondendo al suo messaggio più recente.`
  } else if (previousInboundCount > 0) {
    threadState = `Ci sono ${previousInboundCount} email ricevute e ${previousOutboundCount} inviate in questa conversazione. L'ultima email è inbound: rispondi in modo pertinente.`
  } else if (previousOutboundCount === 0 && previousInboundCount === 0) {
    threadState = 'Non ci sono email precedenti con questo contatto. Stai scrivendo una prima email commerciale.'
  }

  const segmentGuidance = buildEmailSegmentGuidance(contact)
  const publicResearch = formatPublicOrganizationResearch(
    await researchPublicOrganization(contact).catch(() => null)
  )

  const system = [
    'Sei un senior sales copywriter che prepara email commerciali per conto di Speaqi.',
    'Usa come fonte di verita esclusivamente il contesto aziendale, i dati del contatto e la cronologia forniti sotto.',
    'Scrivi nella lingua del contatto quando disponibile; altrimenti in italiano. Scrivi in prima persona, con tono umano e concreto.',
    'Apri sempre con un saluto: “Buongiorno Nome,” se il nome e affidabile, altrimenti “Buongiorno,”. Non usare frasi generiche come “spero che tu stia bene” o “come stai”; dopo il saluto vai dritto al punto con un aggancio personale o contestuale.',
    'Non inventare dati, prezzi, disponibilità, meeting o promesse non presenti nel contesto.',
    'Non inserire la firma: il CRM la aggiungerà dopo, usando la firma Gmail reale.',
    'Non inventare una personalizzazione: se i dati non bastano, usa un motivo del contatto onesto e specifico per il segmento.',
    'Non scrivere mai che il destinatario ha mostrato interesse, aperto, cliccato o risposto a una campagna se questo fatto non compare esplicitamente nello storico email fornito. Non usare “campagna” come aggancio generico.',
    'Non descrivere servizi o capacita che non compaiono nel contesto aziendale.',
    'Struttura: saluto, apertura rilevante, problema o opportunita osservabile, valore specifico, una sola CTA semplice che chieda un riscontro per una call di 15 minuti con il referente appropriato.',
    'Mantieni il corpo tra 70 e 180 parole. Evita buzzword, autocelebrazioni, elenchi di servizi e frasi vaghe.',
    threadState,
    buildEmailAiPolicy(settings),
    segmentGuidance ? `\n## Indicazioni specifiche per questo segmento\n${segmentGuidance}` : '',
    publicResearch,
    note ? `\n## Nota specifica per questa bozza (fornita dall'utente)\n${note}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  const userPrompt = [
    '## Destinatario',
    `Nome: ${contact.name}`,
    contact.company ? `Azienda: ${contact.company}` : '',
    contact.category ? `Categoria: ${contact.category}` : '',
    `Stato CRM: ${contact.status}`,
    contact.source ? `Origine: ${contact.source}` : '',
    contact.event_tag ? `Evento/tag: ${contact.event_tag}` : '',
    contact.country ? `Paese: ${contact.country}` : '',
    contact.responsible ? `Responsabile: ${contact.responsible}` : '',
    `Email: ${contact.email}`,
    contact.note ? `\n## Note scheda contatto\n${contact.note}` : '',
    contact.last_activity_summary ? `\n## Ultimo aggiornamento\n${contact.last_activity_summary}` : '',
    leadMemory ? `\n## Storia e memoria lead\n${leadMemory}` : '',
    activitySummary ? `\n## Attività recenti e note operative\n${activitySummary}` : '',
    threadSummary ? `\n## Storico email completo\n${threadSummary}` : '',
    '\n## Istruzioni per questa bozza',
    followupMode
      ? 'Genera un follow-up naturale. Per un Comune o una casella istituzionale apri il primo paragrafo ricordando con tatto che avevamo inviato un’email qualche tempo fa, poi chiedi un breve incontro per spiegare le possibilita di Speaqi e di essere indirizzati al referente competente. Riprendi un punto concreto dello storico e non inventare interazioni o interesse.'
      : 'Genera una prima email concreta, con apertura personalizzata solo se il contesto la giustifica. Presenta Speaqi in modo naturale, senza autocelebrazioni.',
    'Oggetto: specifico e breve, senza emoji e senza maiuscole aggressive.',
    'HTML: usa solo tag semplici (<p>, <ul>, <li>, <br>, <strong>) e niente CSS inline complesso.',
    'Rispondi solo in JSON con i campi: subject (stringa), body_text (testo plain), body_html (HTML semplice).',
  ].filter(Boolean).join('\n')

  const generated = await callOpenAI(apiKey, model, system, userPrompt)
  const issues = validatePublicOrganizationDraft(contact, generated, followupMode)
  if (!issues.length) return generated

  const corrected = await callOpenAI(
    apiKey,
    model,
    system,
    `${userPrompt}\n\n## Correzioni obbligatorie\n${issues.map((issue) => `- ${issue}`).join('\n')}`
  )
  const remainingIssues = validatePublicOrganizationDraft(contact, corrected, followupMode)
  if (remainingIssues.length) throw new Error(`Bozza istituzionale non conforme: ${remainingIssues.join(' ')}`)
  return corrected
}

// ─── Route handler ───

export async function POST(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return Response.json({ error: 'OPENAI_API_KEY not configured' }, { status: 500 })
  }

  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini'

  try {
    const body = await request.json()
    const draftId = String(body.draft_id || '').trim()
    const note = String(body.note || '').trim() || null

    if (!draftId) {
      return Response.json({ error: 'draft_id obbligatorio' }, { status: 400 })
    }

    // Load the existing draft
    const { data: draft, error: draftError } = await auth.supabase
      .from('email_drafts')
      .select('*')
      .eq('id', draftId)
      .eq('user_id', auth.workspaceUserId)
      .single()

    if (draftError || !draft) {
      return Response.json({ error: 'Bozza non trovata' }, { status: 404 })
    }

    if (draft.status !== 'pending') {
      return Response.json({
        error: `Bozza già ${draft.status === 'sent' ? 'inviata' : 'archiviata'}`,
      }, { status: 409 })
    }

    // Load the contact
    const { data: contact, error: contactError } = await auth.supabase
      .from('contacts')
      .select('*')
      .eq('id', draft.contact_id)
      .single()

    if (contactError || !contact) {
      return Response.json({ error: 'Contatto non trovato' }, { status: 404 })
    }

    // Load context, settings, and regenerate
    const [context, settings] = await Promise.all([
      loadContactContext(auth.supabase, contact.id),
      loadUserSettings(auth.supabase, auth.workspaceUserId).catch(() => EMPTY_USER_SETTINGS),
    ])

    const generated = await regenerateDraft(
      contact as CRMContact,
      context,
      apiKey,
      model,
      settings,
      note
    )

    // Update the draft in place
    const { data: updated, error: updateError } = await auth.supabase
      .from('email_drafts')
      .update({
        subject: generated.subject,
        body_text: generated.body_text,
        body_html: generated.body_html,
        // If there was a note passed, store it in the note field if it exists
        ...(note ? { note } : {}),
      })
      .eq('id', draftId)
      .select('*')
      .single()

    if (updateError) {
      console.error('[regenerate-draft] DB update error:', updateError)
      return Response.json({ error: 'Errore aggiornamento bozza' }, { status: 500 })
    }

    const contactSummary = {
      id: contact.id,
      name: contact.name,
      email: contact.email,
      company: contact.company,
      status: contact.status,
      score: contact.score,
      priority: contact.priority,
      next_followup_at: contact.next_followup_at,
    }

    return Response.json({
      draft: {
        ...updated,
        contact: contactSummary,
      },
      regenerated: true,
    })
  } catch (error) {
    console.error('[regenerate-draft] failed:', error)
    return Response.json(
      { error: errorMessage(error, 'Rigenerazione fallita') },
      { status: 500 }
    )
  }
}
