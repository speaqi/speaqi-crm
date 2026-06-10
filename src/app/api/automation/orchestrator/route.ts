import { NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/server/supabase'
import { errorMessage } from '@/lib/server/http'
import type { CRMContact, GmailMessage } from '@/types'
import { EMPTY_USER_SETTINGS, loadUserSettings, type UserSettings } from '@/lib/server/user-settings'

function validateSecret(request: NextRequest) {
  const secret = process.env.AUTOMATION_SECRET
  return !!secret && request.headers.get('x-automation-secret') === secret
}

// ─── Scanner: find contacts needing follow-up ───

async function scanContacts(supabase: any, daysAhead: number) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const windowEnd = new Date(today)
  windowEnd.setDate(windowEnd.getDate() + daysAhead)
  windowEnd.setHours(23, 59, 59, 999)

  // Overdue lookback: only contacts overdue by max 14 days (not years-old stale ones)
  const overdueLookback = new Date(today)
  overdueLookback.setDate(overdueLookback.getDate() - 14)

  const todayIso = today.toISOString()
  const windowEndIso = windowEnd.toISOString()
  const overdueLookbackIso = overdueLookback.toISOString()

  // Contacts with follow-up due in the rolling window
  const { data: dueContacts, error: dueError } = await supabase
    .from('contacts')
    .select('*')
    .in('contact_scope', ['crm', 'holding', 'partner'])
    .not('status', 'in', '("Closed","Paid","Lost")')
    .not('email', 'is', null)
    .gte('next_followup_at', todayIso)
    .lte('next_followup_at', windowEndIso)
    .order('next_followup_at', { ascending: true, nullsFirst: false })
    .limit(40)

  if (dueError) throw dueError

  // Also include overdue contacts (overdue by up to 14 days)
  const { data: overdueContacts, error: overdueError } = await supabase
    .from('contacts')
    .select('*')
    .in('contact_scope', ['crm', 'holding', 'partner'])
    .not('status', 'in', '("Closed","Paid","Lost")')
    .not('email', 'is', null)
    .lt('next_followup_at', todayIso)
    .gte('next_followup_at', overdueLookbackIso)
    .order('next_followup_at', { ascending: true, nullsFirst: false })
    .limit(30)

  if (overdueError) throw overdueError

  // Merge — overdue first, then due
  const allContacts = [...(overdueContacts || []), ...(dueContacts || [])]

  // Deduplicate by id
  const seen = new Set<string>()
  return allContacts.filter((c: CRMContact) => {
    if (seen.has(c.id)) return false
    seen.add(c.id)
    return true
  })
}

// ─── Analyzer: load context per contact ───

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

// ─── Drafter: generate AI email ───

type DraftError = {
  reason: 'rate_limited' | 'api_error' | 'bad_response' | 'invalid_json' | 'network_error' | 'unknown'
  detail: string
}

async function callOpenAI(
  apiKey: string,
  model: string,
  system: string,
  userPrompt: string,
  retries = 2
): Promise<{ subject: string; body_text: string; body_html: string }> {
  let lastError: DraftError | null = null

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
        lastError = {
          reason: status === 429 ? 'rate_limited' : 'api_error',
          detail: `HTTP ${status}${body ? ': ' + body.slice(0, 200) : ''}`,
        }
        if (status === 429 && attempt < retries) {
          // Exponential backoff: 1.5s, 3s
          await new Promise((r) => setTimeout(r, 1500 * Math.pow(2, attempt)))
          continue
        }
        if (status >= 500 && attempt < retries) {
          await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)))
          continue
        }
        console.error(`[orchestrator] OpenAI API error: ${lastError.detail}`)
        throw new Error(lastError.detail)
      }

      const payload = await response.json()
      const text = payload?.choices?.[0]?.message?.content
      if (!text) {
        lastError = { reason: 'bad_response', detail: 'Empty content in OpenAI response' }
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, 800 * (attempt + 1)))
          continue
        }
        console.error(`[orchestrator] OpenAI empty response`)
        throw new Error('Empty OpenAI response')
      }

      try {
        return JSON.parse(text) as { subject: string; body_text: string; body_html: string }
      } catch {
        lastError = { reason: 'invalid_json', detail: `Unparseable JSON: ${text.slice(0, 150)}` }
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, 800 * (attempt + 1)))
          continue
        }
        console.error(`[orchestrator] OpenAI invalid JSON: ${text.slice(0, 200)}`)
        throw new Error('Invalid JSON from OpenAI')
      }
    } catch (err) {
      if ((err as Error)?.message?.includes(lastError?.detail || '')) {
        // Already logged above
      } else if (err instanceof Error && err.message !== lastError?.detail) {
        lastError = { reason: 'network_error', detail: err.message }
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)))
          continue
        }
        console.error(`[orchestrator] Network error: ${err.message}`)
      }
    }
  }

  // All retries exhausted
  const reason = lastError?.reason || 'unknown'
  console.error(`[orchestrator] Draft generation failed after ${retries + 1} attempts: ${reason} — ${lastError?.detail || 'no detail'}`)
  throw new Error(lastError?.detail || 'Draft generation failed')
}

async function generateDraft(
  contact: CRMContact,
  context: Awaited<ReturnType<typeof loadContactContext>>,
  apiKey: string,
  model: string,
  settings?: UserSettings | null
) {
  const { messages, leadMemory, activities } = context

  // Summarize thread with full context — include subject, direction, date, and body
  const threadSummary = messages
    .slice(-12)
    .map((m) => {
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

  // Determine follow-up mode and thread context
  const ordered = [...messages].sort(
    (a, b) => new Date(a.sent_at || a.created_at).getTime() - new Date(b.sent_at || b.created_at).getTime()
  )
  const latestOutbound = [...ordered].reverse().find((m) => m.direction === 'outbound') || null
  const latestOutboundTime = latestOutbound ? new Date(latestOutbound.sent_at || latestOutbound.created_at).getTime() : null
  const hasInboundAfterLatestOutbound = latestOutboundTime !== null &&
    ordered.some((m) => m.direction === 'inbound' && new Date(m.sent_at || m.created_at).getTime() > latestOutboundTime)
  const followupMode = !!latestOutbound && !hasInboundAfterLatestOutbound
  const previousOutboundCount = ordered.filter((m) => m.direction === 'outbound').length
  const previousInboundCount = ordered.filter((m) => m.direction === 'inbound').length

  // Determine thread state description
  let threadState = ''
  if (followupMode) {
    threadState = `Hai già inviato ${previousOutboundCount} email a questo contatto (l'ultima in data ${latestOutbound ? new Date(latestOutbound.sent_at || latestOutbound.created_at).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'sconosciuta'}). Il contatto non ha ancora risposto. Stai scrivendo un follow-up — NON ripartire da zero, NON sembrare una prima email fredda. Riferisciti alla conversazione già avviata, riprendi il filo del discorso.`
  } else if (previousInboundCount > 0 && !hasInboundAfterLatestOutbound) {
    threadState = `Il contatto ha inviato ${previousInboundCount} email ma non hai ancora risposto all'ultima. Stai rispondendo al suo messaggio più recente.`
  } else if (previousInboundCount > 0) {
    threadState = `Ci sono ${previousInboundCount} email ricevute e ${previousOutboundCount} inviate in questa conversazione. L'ultima email è inbound: rispondi in modo pertinente.`
  } else if (previousOutboundCount === 0 && previousInboundCount === 0) {
    threadState = 'Non ci sono email precedenti con questo contatto. Stai scrivendo una prima email commerciale.'
  }

  const hasSettings = !!(settings?.speaqi_context || settings?.email_target_audience || settings?.email_value_proposition)

  const system = [
    'Sei un assistente commerciale che scrive email per conto di Speaqi, agenzia di comunicazione e marketing digitale.',
    'Speaqi aiuta aziende a crescere con strategie digitali, siti web, advertising, e automazione.',
    'Scrivi email professionali, concrete, in italiano, in prima persona.',
    'NON usare frasi generiche come "spero che tu stia bene", "come stai", "buongiorno/buonasera" vuoti. Vai dritto al punto con un aggancio personale o contestuale.',
    'Non inventare dati, prezzi, disponibilità, meeting o promesse non presenti nel contesto.',
    'Non inserire la firma: il CRM la aggiungerà dopo, usando la firma Gmail reale.',
    'Struttura richiesta: saluto naturale, motivo del contatto, valore specifico, eventuali 2-3 bullet se aiutano, CTA chiara con una sola prossima azione.',
    'Il corpo deve essere leggibile anche in plain text: paragrafi brevi, niente blocchi lunghi.',
    threadState,
    settings?.speaqi_context ? `\n## Contesto Speaqi / prodotto\n${settings.speaqi_context}` : '',
    settings?.email_tone ? `\n## Tono richiesto\n${settings.email_tone}` : '',
    settings?.email_target_audience ? `\n## Target ideale\n${settings.email_target_audience}` : '',
    settings?.email_value_proposition ? `\n## Valore da comunicare\n${settings.email_value_proposition}` : '',
    settings?.email_offer_details ? `\n## Offerta / proposta\n${settings.email_offer_details}` : '',
    settings?.email_proof_points ? `\n## Prove, esempi, credibilità\n${settings.email_proof_points}` : '',
    settings?.email_objection_notes ? `\n## Obiezioni e cose da evitare\n${settings.email_objection_notes}` : '',
    settings?.email_call_to_action ? `\n## CTA preferita\n${settings.email_call_to_action}` : '',
    // When settings are missing, nudge the AI to be more generic but still useful
    !hasSettings ? '\n## Nota importante\nNon hai contesto aziendale specifico nelle impostazioni. Basati ESCLUSIVAMENTE sui dati del contatto e sulla cronologia disponibile. Sii concreto ma non inventare dettagli su Speaqi che non conosci.' : '',
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
    contact.email_draft_note ? `\n## Note specifiche per email\n${contact.email_draft_note}` : '',
    contact.last_activity_summary ? `\n## Ultimo aggiornamento\n${contact.last_activity_summary}` : '',
    leadMemory ? `\n## Storia e memoria lead\n${leadMemory}` : '',
    activitySummary ? `\n## Attività recenti e note operative\n${activitySummary}` : '',
    threadSummary ? `\n## Storico email completo\n${threadSummary}` : '',
    '\n## Istruzioni per questa bozza',
    followupMode
      ? 'Genera un follow-up naturale, coerente con le email già inviate, con riferimento al punto concreto rimasto aperto. NON sembrare una prima email — il contatto sa già chi siamo.'
      : 'Genera una prima email concreta, con apertura personalizzata solo se il contesto la giustifica. Presenta Speaqi in modo naturale, senza autocelebrazioni.',
    'Oggetto: specifico e breve, senza emoji e senza maiuscole aggressive.',
    'HTML: usa solo tag semplici (<p>, <ul>, <li>, <br>, <strong>) e niente CSS inline complesso.',
    'Rispondi solo in JSON con i campi: subject (stringa), body_text (testo plain), body_html (HTML semplice).',
  ].filter(Boolean).join('\n')

  return callOpenAI(apiKey, model, system, userPrompt)
}

// ─── Route handler ───

export async function POST(request: NextRequest) {
  if (!validateSecret(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return Response.json({ error: 'OPENAI_API_KEY not configured' }, { status: 500 })
  }

  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini'

  try {
    const body = await request.json().catch(() => ({}))
    const daysAhead = Math.min(7, Math.max(1, Number(body.days_ahead) || 3))
    const dryRun = body.dry_run === true
    const maxContacts = Math.min(80, Number(body.max_contacts) || 50)
    const supabase = createServiceRoleClient()

    // ─── Step 1: Scan ───
    const contacts = await scanContacts(supabase, daysAhead)
    const limited = contacts.slice(0, maxContacts)

    if (!limited.length) {
      return Response.json({
        scanned: contacts.length,
        generated: 0,
        saved: 0,
        message: 'Nessun contatto da processare',
        drafts: [],
      })
    }

    // ─── Step 2: For each contact, analyze & draft ───

    // Pre-load user settings per unique user_id (many contacts share the same user)
    const userIds = [...new Set(limited.map((c: CRMContact) => c.user_id).filter((uid): uid is string => !!uid))]
    const settingsMap = new Map<string, UserSettings>()

    // Also try to load a "global" fallback from the first admin user, for contacts without user_id
    let globalFallbackSettings: UserSettings = EMPTY_USER_SETTINGS
    if (userIds.length === 0) {
      // Try to find any user with settings
      const { data: anyUser } = await supabase
        .from('user_settings')
        .select('user_id')
        .limit(1)
        .maybeSingle()
      if (anyUser?.user_id) {
        try {
          globalFallbackSettings = await loadUserSettings(supabase, anyUser.user_id)
        } catch { /* keep EMPTY */ }
      }
    }

    await Promise.all(
      userIds.map(async (uid: string) => {
        try {
          const s = await loadUserSettings(supabase, uid)
          settingsMap.set(uid, s)
        } catch {
          settingsMap.set(uid, EMPTY_USER_SETTINGS)
        }
      })
    )

    // Fallback: if no user-specific settings loaded, use the first available
    if (settingsMap.size === 0) {
      const firstUserId = userIds[0]
      if (firstUserId) globalFallbackSettings = settingsMap.get(firstUserId) || EMPTY_USER_SETTINGS
    }

    // Process with concurrency limit of 3
    async function runWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>) {
      const out = new Array<R>(items.length)
      let next = 0
      async function runner() {
        while (next < items.length) {
          const i = next++
          out[i] = await worker(items[i])
        }
      }
      await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => runner()))
      return out
    }

    const draftResults = await runWithConcurrency(limited, 3, async (contact: CRMContact) => {
      try {
        const context = await loadContactContext(supabase, contact.id)
        const settings = settingsMap.get(contact.user_id || '') || globalFallbackSettings

        // Skip contacts that already have a pending draft created in the last 8 hours
        // (prevents duplicates if orchestrator runs multiple times, but allows next-day regeneration)
        const recentWindow = new Date(Date.now() - 8 * 60 * 60 * 1000)
        const { count } = await supabase
          .from('email_drafts')
          .select('id', { count: 'exact', head: true })
          .eq('contact_id', contact.id)
          .eq('status', 'pending')
          .gte('created_at', recentWindow.toISOString())

        if (count && count > 0) {
          return { contact_id: contact.id, contact_name: contact.name, email: contact.email || '', error: 'Draft già esistente (ultime 8 ore)' }
        }

        const generated = await generateDraft(contact, context, apiKey, model, settings)
        if (!generated) {
          return { contact_id: contact.id, contact_name: contact.name, email: contact.email || '', error: 'Generazione AI fallita' }
        }

        if (dryRun) {
          return { contact_id: contact.id, contact_name: contact.name, email: contact.email || '', subject: generated.subject }
        }

        // Save to email_drafts table
        const { data: draft, error: insertError } = await supabase
          .from('email_drafts')
          .insert({
            user_id: contact.user_id,
            contact_id: contact.id,
            subject: generated.subject,
            body_text: generated.body_text,
            body_html: generated.body_html,
            source: 'auto',
            status: 'pending',
          })
          .select('id')
          .single()

        if (insertError) {
          return { contact_id: contact.id, contact_name: contact.name, email: contact.email || '', error: `DB insert: ${insertError.message}` }
        }

        return { contact_id: contact.id, contact_name: contact.name, email: contact.email || '', draft_id: draft.id, subject: generated.subject }
      } catch (err) {
        return { contact_id: contact.id, contact_name: contact.name, email: contact.email || '', error: errorMessage(err, 'Errore') }
      }
    })

    const generated = draftResults.filter((r) => r.draft_id).length
    const failed = draftResults.filter((r) => r.error).length
    const dryRunNote = dryRun ? ' [DRY RUN — nessun salvataggio]' : ''

    return Response.json({
      scanned: contacts.length,
      processed: limited.length,
      generated,
      failed,
      dry_run: dryRun,
      message: `${generated} bozze generate, ${failed} errori${dryRunNote}`,
      drafts: draftResults,
    })
  } catch (error) {
    console.error('orchestrator failed', error)
    return Response.json({ error: errorMessage(error, 'Orchestrator failed') }, { status: 500 })
  }
}
