import { NextRequest } from 'next/server'
import { errorMessage } from '@/lib/server/http'
import { createContactDraft } from '@/lib/server/gmail'
import { requireRouteUser } from '@/lib/server/supabase'

type DraftRequest = {
  contact_id: string
  note?: string
}

type GeneratedEmail = {
  subject: string
  body_text: string
  body_html: string
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
}): Promise<GeneratedEmail | null> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null

  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini'

  const system = [
    'Sei un assistente commerciale che scrive email di follow-up per conto di un venditore.',
    'Scrivi email professionali, concise, in italiano, in prima persona.',
    'NON usare frasi generiche come "spero che tu stia bene". Vai dritto al punto.',
    input.speaqiContext ? `\n## Contesto prodotto/azienda\n${input.speaqiContext}` : '',
    input.emailTone ? `\n## Tono richiesto\n${input.emailTone}` : '',
  ].filter(Boolean).join('\n')

  const user = [
    `## Destinatario`,
    `Nome: ${input.contactName}`,
    input.company ? `Azienda: ${input.company}` : '',
    `Email: ${input.contactEmail}`,
    input.lastActivitySummary ? `\n## Ultimo aggiornamento sul contatto\n${input.lastActivitySummary}` : '',
    input.leadMemory ? `\n## Storia e note sul lead\n${input.leadMemory}` : '',
    input.note ? `\n## Cosa vuole comunicare il venditore in questa email\n${input.note}` : '',
    input.emailSignature ? `\n## Firma da usare\n${input.emailSignature}` : '',
    `\n## Istruzioni`,
    'Genera un oggetto email e il corpo del messaggio.',
    'Rispondi in JSON con i campi: subject (stringa), body_text (testo plain), body_html (HTML semplice).',
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

export async function POST(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const body = await request.json()
    const drafts: DraftRequest[] = Array.isArray(body.drafts) ? body.drafts : []

    if (!drafts.length) {
      return Response.json({ error: 'Nessun contatto fornito' }, { status: 400 })
    }

    const { data: settingsRow } = await auth.supabase
      .from('user_settings')
      .select('speaqi_context, email_tone, email_signature')
      .eq('user_id', auth.user.id)
      .maybeSingle()

    const settings: { speaqi_context?: string | null; email_tone?: string | null; email_signature?: string | null } = settingsRow ?? {}

    const contactIds = drafts.map((d) => d.contact_id)
    const { data: contacts } = await auth.supabase
      .from('contacts')
      .select('id, name, email, company, last_activity_summary')
      .eq('user_id', auth.user.id)
      .in('id', contactIds)

    const { data: memories } = await auth.supabase
      .from('lead_memories')
      .select('contact_id, memory')
      .eq('user_id', auth.user.id)
      .in('contact_id', contactIds)

    const memoryMap = new Map<string, string>(
      (memories || []).map((m: { contact_id: string; memory: string }) => [m.contact_id, m.memory])
    )

    const contactMap = new Map(
      (contacts || []).map((c: any) => [c.id, c])
    )

    const results: { contact_id: string; draft_id?: string; error?: string }[] = []

    for (const item of drafts) {
      const contact = contactMap.get(item.contact_id)
      if (!contact) {
        results.push({ contact_id: item.contact_id, error: 'Contatto non trovato' })
        continue
      }

      if (!contact.email) {
        results.push({ contact_id: item.contact_id, error: 'Email mancante' })
        continue
      }

      const generated = await generateEmail({
        contactName: contact.name,
        contactEmail: contact.email,
        company: contact.company,
        lastActivitySummary: contact.last_activity_summary,
        leadMemory: memoryMap.get(item.contact_id) || null,
        speaqiContext: settings.speaqi_context || null,
        emailTone: settings.email_tone || null,
        emailSignature: settings.email_signature || null,
        note: item.note || null,
      })

      if (!generated) {
        results.push({ contact_id: item.contact_id, error: 'Generazione AI fallita' })
        continue
      }

      let draft: { draftId: string } | null = null
      try {
        draft = await createContactDraft(auth.supabase, auth.user.id, contact, {
          subject: generated.subject,
          html: generated.body_html,
          text: generated.body_text,
        })
      } catch (draftError) {
        const msg = draftError instanceof Error ? draftError.message : 'Errore Gmail'
        results.push({ contact_id: item.contact_id, error: msg })
        continue
      }

      if (!draft) {
        results.push({ contact_id: item.contact_id, error: 'Gmail non collegato o scope mancante' })
        continue
      }

      results.push({ contact_id: item.contact_id, draft_id: draft.draftId })
    }

    const created = results.filter((r) => r.draft_id).length
    const failed = results.filter((r) => r.error).length

    return Response.json({ results, created, failed })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Failed to generate drafts') }, { status: 500 })
  }
}
