import { NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/server/supabase'
import { errorMessage } from '@/lib/server/http'
import { loadRequiredGmailSignature } from '@/lib/server/gmail'
import type { CRMContact, GmailMessage } from '@/types'

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

  const todayIso = today.toISOString()
  const windowEndIso = windowEnd.toISOString()

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
    .limit(30)

  if (dueError) throw dueError

  // Also include overdue contacts (next_followup_at < today)
  const { data: overdueContacts, error: overdueError } = await supabase
    .from('contacts')
    .select('*')
    .in('contact_scope', ['crm', 'holding', 'partner'])
    .not('status', 'in', '("Closed","Paid","Lost")')
    .not('email', 'is', null)
    .lt('next_followup_at', todayIso)
    .order('next_followup_at', { ascending: true, nullsFirst: false })
    .limit(15)

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

async function generateDraft(
  contact: CRMContact,
  context: Awaited<ReturnType<typeof loadContactContext>>,
  apiKey: string,
  model: string
) {
  const { messages, leadMemory, activities } = context

  // Summarize thread
  const threadSummary = messages
    .slice(-12)
    .map((m) => {
      const sentAt = m.sent_at
        ? new Date(m.sent_at).toLocaleString('it-IT', {
            day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
          })
        : 'data non disponibile'
      const body = String(m.body_text || m.snippet || '').replace(/\s+/g, ' ').trim().slice(0, 500)
      return `- ${m.direction === 'outbound' ? 'Inviata' : 'Ricevuta'} (${sentAt}): ${body}`
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

  // Determine follow-up mode
  const ordered = [...messages].sort(
    (a, b) => new Date(a.sent_at || a.created_at).getTime() - new Date(b.sent_at || b.created_at).getTime()
  )
  const latestOutbound = [...ordered].reverse().find((m) => m.direction === 'outbound') || null
  const latestOutboundTime = latestOutbound ? new Date(latestOutbound.sent_at || latestOutbound.created_at).getTime() : null
  const hasInboundAfterLatestOutbound = latestOutboundTime !== null &&
    ordered.some((m) => m.direction === 'inbound' && new Date(m.sent_at || m.created_at).getTime() > latestOutboundTime)
  const followupMode = !!latestOutbound && !hasInboundAfterLatestOutbound

  const system = [
    'Sei un assistente commerciale che scrive email per conto di un venditore.',
    'Scrivi email professionali, concrete, in italiano, in prima persona.',
    'NON usare frasi generiche come "spero che tu stia bene". Vai dritto al punto.',
    'Non inventare dati, prezzi, disponibilità, meeting o promesse non presenti nel contesto.',
    'Non inserire la firma: il CRM la aggiungerà dopo.',
    'Struttura richiesta: saluto naturale, motivo del contatto, valore specifico, CTA chiara.',
    'Il corpo deve essere leggibile anche in plain text: paragrafi brevi.',
    followupMode
      ? 'Stai scrivendo un follow-up su una conversazione già iniziata. Non ripartire da zero.'
      : 'Stai scrivendo una prima email commerciale.',
  ].join('\n')

  const userPrompt = [
    '## Destinatario',
    `Nome: ${contact.name}`,
    contact.company ? `Azienda: ${contact.company}` : '',
    contact.category ? `Categoria: ${contact.category}` : '',
    `Stato CRM: ${contact.status}`,
    contact.source ? `Origine: ${contact.source}` : '',
    contact.responsible ? `Responsabile: ${contact.responsible}` : '',
    `Email: ${contact.email}`,
    contact.note ? `\n## Note contatto\n${contact.note}` : '',
    leadMemory ? `\n## Storia e memoria lead\n${leadMemory}` : '',
    activitySummary ? `\n## Attività recenti\n${activitySummary}` : '',
    threadSummary ? `\n## Storico email\n${threadSummary}` : '',
    '\n## Istruzioni',
    followupMode
      ? 'Genera un follow-up naturale, riferendoti alla conversazione esistente.'
      : 'Genera una prima email concreta e personalizzata.',
    'Oggetto: specifico e breve, senza emoji.',
    'HTML: solo tag semplici (<p>, <ul>, <li>, <br>, <strong>).',
    'Rispondi solo in JSON con i campi: subject (stringa), body_text (testo plain), body_html (HTML semplice).',
  ].filter(Boolean).join('\n')

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

    if (!response.ok) return null

    const payload = await response.json()
    const text = payload?.choices?.[0]?.message?.content
    if (!text) return null

    return JSON.parse(text) as { subject: string; body_text: string; body_html: string }
  } catch {
    return null
  }
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
    const maxContacts = Math.min(50, Number(body.max_contacts) || 30)
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
    const results: Array<{ contact_id: string; contact_name: string; email: string; draft_id?: string; subject?: string; error?: string }> = []

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

    await runWithConcurrency(limited, 3, async (contact: CRMContact) => {
      try {
        const context = await loadContactContext(supabase, contact.id)

        // Skip contacts that already have a draft pending today
        const todayStart = new Date()
        todayStart.setHours(0, 0, 0, 0)
        const { count } = await supabase
          .from('email_drafts')
          .select('id', { count: 'exact', head: true })
          .eq('contact_id', contact.id)
          .eq('status', 'pending')
          .gte('created_at', todayStart.toISOString())

        if (count && count > 0) {
          return { contact_id: contact.id, contact_name: contact.name, email: contact.email || '', error: 'Draft già esistente per oggi' }
        }

        const generated = await generateDraft(contact, context, apiKey, model)
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

    const generated = results.filter((r) => r.draft_id).length
    const failed = results.filter((r) => r.error).length
    const dryRunNote = dryRun ? ' [DRY RUN — nessun salvataggio]' : ''

    return Response.json({
      scanned: contacts.length,
      processed: limited.length,
      generated,
      failed,
      dry_run: dryRun,
      message: `${generated} bozze generate, ${failed} errori${dryRunNote}`,
      drafts: results,
    })
  } catch (error) {
    console.error('orchestrator failed', error)
    return Response.json({ error: errorMessage(error, 'Orchestrator failed') }, { status: 500 })
  }
}
