import type { CRMContact } from '@/types'

type PublicOrganizationResearch = {
  summary: string
  personalizationAngle: string
  sources: string[]
}

type DraftLike = {
  subject?: string | null
  body_text?: string | null
  body_html?: string | null
}

function extractResponseText(payload: any) {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text.trim()
  }

  for (const item of Array.isArray(payload?.output) ? payload.output : []) {
    if (item?.type !== 'message') continue
    for (const part of Array.isArray(item.content) ? item.content : []) {
      if (part?.type === 'output_text' && typeof part.text === 'string' && part.text.trim()) {
        return part.text.trim()
      }
    }
  }

  return ''
}

function extractWebSources(payload: any) {
  const urls = new Set<string>()
  for (const item of Array.isArray(payload?.output) ? payload.output : []) {
    if (item?.type === 'web_search_call') {
      const sources = Array.isArray(item?.action?.sources) ? item.action.sources : []
      for (const source of sources) {
        if (typeof source?.url === 'string' && source.url.startsWith('http')) urls.add(source.url)
      }
    }
    if (item?.type === 'message') {
      for (const part of Array.isArray(item.content) ? item.content : []) {
        for (const annotation of Array.isArray(part?.annotations) ? part.annotations : []) {
          if (annotation?.type === 'url_citation' && typeof annotation.url === 'string') {
            urls.add(annotation.url)
          }
        }
      }
    }
  }
  return [...urls].slice(0, 5)
}

export function isPublicOrganizationContact(contact: CRMContact) {
  const company = String(contact.company || '').toLowerCase()
  const category = String(contact.category || '').toLowerCase()
  const email = String(contact.email || '').toLowerCase()
  const notes = String(contact.note || '').toLowerCase()

  return (
    company.includes('comune') ||
    company.includes('regione') ||
    company.includes('provincia') ||
    category.includes('comune') ||
    category.includes('ente pubblico') ||
    email.includes('@comune.') ||
    email.includes('.gov.') ||
    email.startsWith('sindaco@') ||
    notes.includes('regione:')
  )
}

export async function researchPublicOrganization(contact: CRMContact): Promise<PublicOrganizationResearch | null> {
  if (!isPublicOrganizationContact(contact)) return null
  if (process.env.OPENAI_EMAIL_WEB_RESEARCH === 'false') return null

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null

  const organization = String(contact.company || contact.name || '').trim()
  const emailDomain = String(contact.email || '').split('@')[1] || ''
  const location = [contact.country, contact.note].filter(Boolean).join(' | ').slice(0, 500)
  const model = process.env.OPENAI_EMAIL_RESEARCH_MODEL || 'gpt-5-mini'

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        tools: [{ type: 'web_search', search_context_size: 'low' }],
        tool_choice: 'required',
        include: ['web_search_call.action.sources'],
        text: {
          format: {
            type: 'json_schema',
            name: 'public_organization_research',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                found: { type: 'boolean' },
                summary: { type: 'string' },
                personalization_angle: { type: 'string' },
              },
              required: ['found', 'summary', 'personalization_angle'],
            },
          },
        },
        input: [
          {
            role: 'system',
            content: [{
              type: 'input_text',
              text: 'Fai una ricerca breve e prudente su un ente pubblico italiano. Dai priorita al sito istituzionale e a fonti pubbliche affidabili. Cerca soltanto elementi utili e attuali su turismo, cultura, territorio, accessibilita, servizi informativi, eventi o comunicazione multilingua. Non dedurre progetti, bisogni o priorita non dichiarati. Se non trovi un elemento concreto e verificabile, restituisci found=false. Rispondi in italiano.',
            }],
          },
          {
            role: 'user',
            content: [{
              type: 'input_text',
              text: `Ente: ${organization || 'non specificato'}\nDominio email: ${emailDomain || 'non disponibile'}\nAltri dati: ${location || 'nessuno'}\n\nRestituisci un riassunto fattuale di massimo 60 parole e un solo possibile aggancio commerciale, senza scrivere l'email.`,
            }],
          },
        ],
      }),
    })

    if (!response.ok) return null
    const payload = await response.json()
    const text = extractResponseText(payload)
    if (!text) return null

    const parsed = JSON.parse(text) as {
      found?: boolean
      summary?: string
      personalization_angle?: string
    }
    const sources = extractWebSources(payload)
    if (!parsed.found || !sources.length) return null

    return {
      summary: String(parsed.summary || '').trim().slice(0, 700),
      personalizationAngle: String(parsed.personalization_angle || '').trim().slice(0, 500),
      sources,
    }
  } catch {
    return null
  }
}

export function formatPublicOrganizationResearch(research?: PublicOrganizationResearch | null) {
  if (!research) return ''
  return [
    '## Ricerca pubblica verificata sul destinatario',
    research.summary,
    research.personalizationAngle ? `Possibile aggancio: ${research.personalizationAngle}` : '',
    `Fonti consultate (non inserirle nell'email): ${research.sources.join(', ')}`,
    'Usa al massimo un dettaglio pertinente. Non trasformare la ricerca in un elenco e non attribuire all’ente esigenze non dichiarate.',
  ].filter(Boolean).join('\n')
}

export function validatePublicOrganizationDraft(
  contact: CRMContact,
  draft: DraftLike,
  followupMode: boolean
) {
  if (!isPublicOrganizationContact(contact)) return []

  const text = String(draft.body_text || draft.body_html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const issues: string[] = []

  if (!/^buongiorno\b/i.test(text)) issues.push('La prima parola deve essere “Buongiorno”.')
  if (/\b(tu|ti|tuo|tua|tuoi|tue|faccio vedere|ti va)\b/i.test(text)) {
    issues.push('Usa una forma istituzionale e impersonale; non usare tu, ti o tuo.')
  }
  if (!/15\s*minut/i.test(text)) issues.push('Proponi esplicitamente un incontro o una call di 15 minuti.')
  if (!/referent|persona\s+(?:che|competente)|ufficio\s+(?:che|competente|piu adatto)|chi\s+segue/i.test(text)) {
    issues.push('Chiedi di essere indirizzato alla persona o all’ufficio competente.')
  }
  if (followupMode && !/(avevamo|abbiamo)\s+(?:gia\s+)?(?:scritto|inviato)|email\s+(?:precedente|inviata)|messaggio\s+(?:precedente|inviato)|qualche tempo fa/i.test(text)) {
    issues.push('Ricorda con tatto che era gia stata inviata un’email qualche tempo fa.')
  }

  return issues
}

export function buildEmailSegmentGuidance(contact: CRMContact) {
  const source = String(contact.source || '').toLowerCase()
  const category = String(contact.category || '').toLowerCase()
  const listName = String(contact.list_name || '').toLowerCase()
  const company = String(contact.company || '').toLowerCase()
  const email = String(contact.email || '').toLowerCase()
  const name = String(contact.name || '').trim()
  const notes = String(contact.note || '').toLowerCase()

  const guidance: string[] = []

  if (
    source.includes('vinitaly') ||
    category.includes('vitigno') ||
    listName.includes('vinitaly') ||
    listName.includes('vitigno')
  ) {
    guidance.push(
      'Segmento vino/eventi: collega Speaqi a un caso d uso concreto come QR o link multilingua per schede prodotto, degustazioni, materiali fiera, export o visite in cantina.',
      'Non dire che il destinatario ha aperto o cliccato una precedente email e non fingere di averlo incontrato in fiera.'
    )
  }

  if (
    company.includes('comune') ||
    email.includes('.gov.') ||
    email.includes('comune.') ||
    email.startsWith('sindaco@') ||
    notes.includes('regione:')
  ) {
    guidance.push(
      'Ente pubblico o destinazione: usa sempre una forma istituzionale (Lei, Le, vostro Comune). Non usare mai tu, ti o tuo. Collega Speaqi a informazioni turistiche, culturali o di servizio accessibili in piu lingue.',
      'Evita tono da vendita aggressiva e non attribuire progetti o priorita specifiche non presenti nei dati.',
      'Se il contatto e un Comune, un ente o una casella istituzionale senza un referente personale certo, apri con “Buongiorno,” senza inventare un nome. Non presumere che chi legge sia il decisore: chiedi cortesemente di essere indirizzato al referente che segue turismo, cultura, comunicazione o accessibilita e proponi con quella persona un incontro di 15 minuti.',
      'Nei follow-up ricorda esplicitamente e con tatto l’email precedente, per esempio: “Le avevamo scritto qualche tempo fa in merito a…” oppure “Avevamo inviato una breve presentazione di Speaqi e volevamo capire se fosse possibile approfondire”.'
    )
  }

  if (notes.includes('sales & marketing') || notes.includes('marketing manager')) {
    guidance.push(
      'Ruolo marketing/commerciale: concentra il messaggio sulla distribuzione internazionale di contenuti e materiali commerciali senza duplicare versioni e link.'
    )
  }

  if (/^[^\s]{18,}$/.test(name) || !name.includes(' ')) {
    guidance.push(
      'Il nome potrebbe essere concatenato, incompleto o aziendale: evita di usarlo nel saluto se non sei certo del nome proprio.'
    )
  }

  if (!contact.company && !contact.category && !contact.event_tag && !contact.email_draft_note) {
    guidance.push(
      'Il contesto e limitato: non simulare una personalizzazione. Usa il segmento o la provenienza disponibile e proponi un esempio concreto da valutare.'
    )
  }

  return guidance.join('\n')
}
