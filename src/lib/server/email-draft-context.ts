import type { CRMContact } from '@/types'
import { withEmailAiFramework, type EmailAiFrameworkSettings } from '@/lib/email-ai-framework'
import {
  formatWineEmailTemplateGuidance,
  getWineEmailTemplates,
  pickWineEmailTemplate,
} from '@/lib/email-wine-templates'

export const SPEAQI_COMUNI_URL = 'https://speaqi.com/comuni'
export const SPEAQI_RAI3_URL = 'https://www.youtube.com/watch?v=HMb5XQEY4cM'

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

function plainDraftText(draft: DraftLike) {
  return String(draft.body_text || draft.body_html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function hasUrl(text: string, url: string) {
  const normalized = text.toLowerCase()
  const target = url.toLowerCase()
  if (normalized.includes(target)) return true
  // Accept the short YouTube form without query params.
  if (url.includes('youtube.com/watch')) {
    const id = url.split('v=')[1]?.split('&')[0]
    if (id && (normalized.includes(`youtu.be/${id.toLowerCase()}`) || normalized.includes(id.toLowerCase()))) {
      return true
    }
  }
  return false
}

export function isPublicOrganizationContact(contact: CRMContact) {
  const company = String(contact.company || '').toLowerCase()
  const category = String(contact.category || '').toLowerCase()
  const email = String(contact.email || '').toLowerCase()
  const emailLocalPart = email.split('@')[0] || ''
  const notes = String(contact.note || '').toLowerCase()

  return (
    company.includes('comune') ||
    company.includes('regione') ||
    company.includes('provincia') ||
    category.includes('comune') ||
    category.includes('ente pubblico') ||
    emailLocalPart.includes('comune') ||
    email.includes('@comune.') ||
    email.includes('.gov.') ||
    email.startsWith('sindaco@') ||
    notes.includes('regione:')
  )
}

/** True only for municipalities — not Regioni/Province/other PA. */
export function isMunicipalityContact(contact: CRMContact) {
  const company = String(contact.company || '').toLowerCase()
  const category = String(contact.category || '').toLowerCase()
  const email = String(contact.email || '').toLowerCase()
  const emailLocalPart = email.split('@')[0] || ''
  const name = String(contact.name || '').toLowerCase()

  return (
    company.includes('comune') ||
    category.includes('comune') ||
    emailLocalPart.includes('comune') ||
    email.includes('@comune.') ||
    email.startsWith('sindaco@') ||
    name.includes('comune')
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
              text: [
                'Fai una ricerca breve e prudente su un ente pubblico italiano.',
                'Dai priorita al sito istituzionale e a fonti pubbliche affidabili.',
                'Cerca SOLO elementi evergreen: vocazione turistica, patrimonio culturale, accessibilita del territorio, servizi al cittadino, comunicazione istituzionale.',
                'VIETATO usare come aggancio: eventi, feste, sagre, calendari estivi/invernali, mostre temporanee, date, programmi stagionali o iniziative puntuali che possono essere gia passate.',
                'Non dedurre progetti, bisogni o priorita non dichiarati.',
                'Se non trovi un elemento evergreen concreto e verificabile, restituisci found=false.',
                'Rispondi in italiano.',
              ].join(' '),
            }],
          },
          {
            role: 'user',
            content: [{
              type: 'input_text',
              text: `Ente: ${organization || 'non specificato'}\nDominio email: ${emailDomain || 'non disponibile'}\nAltri dati: ${location || 'nessuno'}\n\nRestituisci un riassunto fattuale di massimo 60 parole e un solo possibile aggancio commerciale evergreen (mai eventi o date), senza scrivere l'email.`,
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
    research.personalizationAngle ? `Possibile aggancio evergreen: ${research.personalizationAngle}` : '',
    `Fonti consultate (non inserirle nell'email): ${research.sources.join(', ')}`,
    'Usa al massimo un dettaglio pertinente e evergreen sul territorio.',
    'NON citare eventi, feste, sagre, calendari stagionali o iniziative temporanee: se la ricerca li menziona, ignorali.',
    'Non attribuire all’ente esigenze non dichiarate.',
  ].filter(Boolean).join('\n')
}

const RAI3_FOOTER_TEXT =
  `Speaqi è stato raccontato anche da Rai 3 (Mezzogiorno Italia):\n${SPEAQI_RAI3_URL}`

const RAI3_FOOTER_HTML =
  `<p>Speaqi è stato raccontato anche da Rai 3 (Mezzogiorno Italia):<br><a href="${SPEAQI_RAI3_URL}">${SPEAQI_RAI3_URL}</a></p>`

/**
 * Ensures required assets after AI generation:
 * - Rai 3 footer for every draft
 * - speaqi.com/comuni link only for municipality contacts
 */
export function ensureDraftRequiredAssets(contact: CRMContact, draft: DraftLike): DraftLike {
  let bodyText = String(draft.body_text || '').trim()
  let bodyHtml = String(draft.body_html || '').trim()

  if (isMunicipalityContact(contact)) {
    if (!hasUrl(`${bodyText}\n${bodyHtml}`, SPEAQI_COMUNI_URL)) {
      const comuniSentence =
        `Trova tutte le informazioni su Speaqi per i Comuni qui: ${SPEAQI_COMUNI_URL}`
      const comuniHtml =
        `<p>Trova tutte le informazioni su Speaqi per i Comuni qui: <a href="${SPEAQI_COMUNI_URL}">${SPEAQI_COMUNI_URL}</a></p>`
      bodyText = bodyText ? `${bodyText}\n\n${comuniSentence}` : comuniSentence
      bodyHtml = bodyHtml ? `${bodyHtml}\n${comuniHtml}` : comuniHtml
    }
  }

  if (!hasUrl(`${bodyText}\n${bodyHtml}`, SPEAQI_RAI3_URL)) {
    bodyText = bodyText ? `${bodyText}\n\n${RAI3_FOOTER_TEXT}` : RAI3_FOOTER_TEXT
    bodyHtml = bodyHtml ? `${bodyHtml}\n${RAI3_FOOTER_HTML}` : RAI3_FOOTER_HTML
  }

  return {
    ...draft,
    body_text: bodyText,
    body_html: bodyHtml,
  }
}

export function validatePublicOrganizationDraft(
  contact: CRMContact,
  draft: DraftLike,
  followupMode: boolean
) {
  if (!isPublicOrganizationContact(contact)) return []

  const text = plainDraftText(draft)
  const raw = `${draft.body_text || ''}\n${draft.body_html || ''}`
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
  if (/(?:ho|abbiamo)\s+notato.{0,80}\binteresse\b|mostrato\s+interesse|interesse\s+per\s+le\s+soluzioni/i.test(text)) {
    issues.push('Non attribuire interesse al Comune se non e presente nello storico email.')
  }
  if (/\b(eventi?\s+(?:estiv|invernali|in programma)|calendario\s+estiv|arrivo dell['’]?estate|festa|feste|sagra|sagre|manifestazione\s+in corso)\b/i.test(text)) {
    issues.push('Non agganciare l’email a eventi stagionali, feste o sagre: usa un pitch evergreen sul territorio.')
  }
  if (isMunicipalityContact(contact) && !hasUrl(raw, SPEAQI_COMUNI_URL)) {
    issues.push(`Inserisci nel corpo il link ${SPEAQI_COMUNI_URL}.`)
  }
  if (!hasUrl(raw, SPEAQI_RAI3_URL)) {
    issues.push(`Dopo il ringraziamento/chiusura inserisci il riferimento Rai 3 con il link ${SPEAQI_RAI3_URL}.`)
  }

  return issues
}

/** Wine / event vertical: the master Wine positioning applies to these contacts. */
export function isWineSegmentContact(contact: CRMContact) {
  const source = String(contact.source || '').toLowerCase()
  const category = String(contact.category || '').toLowerCase()
  const listName = String(contact.list_name || '').toLowerCase()
  const company = String(contact.company || '').toLowerCase()

  return (
    source.includes('vinitaly') ||
    source.includes('vino') ||
    category.includes('vitigno') ||
    category.includes('vino') ||
    listName.includes('vinitaly') ||
    listName.includes('vitigno') ||
    listName.includes('vino') ||
    company.includes('cantina') ||
    company.includes('vitivinicol') ||
    company.includes('vigneti')
  )
}

/**
 * All quality checks for a generated draft.
 * `blocking` = institutional rules (a non-compliant PA draft must not be kept);
 * `all` = blocking + Wine guardrails, used to build the correction pass.
 */
export function validateGeneratedDraft(contact: CRMContact, draft: DraftLike, followupMode: boolean) {
  const blocking = validatePublicOrganizationDraft(contact, draft, followupMode)
  return {
    blocking,
    all: [
      ...blocking,
      ...validateWineDraft(contact, draft),
      ...validatePublicSectorNarrative(contact, draft),
    ],
  }
}

/**
 * Guardrails on the public sector master message. Non blocking, like the Wine
 * ones: catch the drifts that make an email interchangeable with any vendor's.
 */
export function validatePublicSectorNarrative(contact: CRMContact, draft: DraftLike) {
  if (!isPublicOrganizationContact(contact)) return []

  const text = plainDraftText(draft)
  const issues: string[] = []

  if (/\bho notato che\b|\bavendo notato\b|\bho visto che (il|la|il vostro|la vostra)\b/i.test(text)) {
    issues.push(
      'Elimina l’apertura “Ho notato che...”: e la formula che qualunque fornitore scrive a qualunque Comune. Apri dal risultato per il territorio o dallo scenario del visitatore straniero.'
    )
  }
  if (/\b(la nostra|il nostro) (piattaforma|sistema|soluzione|servizio|software|strumento)\b/i.test(text)) {
    issues.push(
      'Non descrivere “la nostra piattaforma”: racconta cosa succede a chi arriva sul territorio, non cosa fa il prodotto.'
    )
  }
  if (/esigenze comunicative|potreste beneficiare|potrebbe beneficiare|soluzion[ei] innovativ|comunicazione digitale del (vostro )?comune/i.test(text)) {
    issues.push(
      'Elimina il linguaggio generico da fornitore (“esigenze comunicative”, “potreste beneficiare”, “soluzioni innovative”): usa parole concrete sul territorio e su chi lo visita.'
    )
  }
  if (/potrebbe avere senso approfondire|se fosse di (vostro |suo )?interesse.{0,40}approfondire/i.test(text)) {
    issues.push(
      'Togli la richiesta vaga di “approfondire”: resta una sola CTA, la call di 15 minuti con il referente competente.'
    )
  }
  if (/(piattaforma|servizio|sistema|soluzione|strumento)\s+(di\s+)?(traduzion|intelligenza artificiale|qr)/i.test(text)) {
    issues.push(
      'Speaqi non e una piattaforma di traduzione ne un generatore di QR: il valore e un’unica fonte ufficiale aggiornabile, distribuibile in ogni lingua e su ogni canale.'
    )
  }

  return issues
}

/**
 * Guardrails on the Wine master message. Only negative checks: they catch the
 * drifts that break the concept (selling the QR/translation, canned openers)
 * without forcing a specific wording on the AI.
 */
export function validateWineDraft(contact: CRMContact, draft: DraftLike) {
  if (!isWineSegmentContact(contact)) return []

  const text = plainDraftText(draft)
  const issues: string[] = []

  if (/(piattaforma|servizio|sistema|soluzione|tool|strumento)\s+(di\s+)?(traduzion|intelligenza artificiale|qr)/i.test(text) || /piattaforma\s+(ai|a\.i\.)\b/i.test(text)) {
    issues.push(
      'Non presentare Speaqi come piattaforma di traduzione, generatore di QR code o piattaforma AI: il valore e un’unica fonte di conoscenza da cui distribuire tutto il racconto della cantina in ogni lingua.'
    )
  }
  if (/ho notato che (siete|sei|e|è)|potreste beneficiare|potrebbe beneficiare|soluzion[ei] innovativ|nel settore (vinicolo|del vino) come il vostro/i.test(text)) {
    issues.push(
      'Elimina le formule artificiali (“Ho notato che siete attivi nel settore vinicolo”, “potreste beneficiare di”, “soluzioni innovative”): parti dal risultato per la cantina.'
    )
  }
  if (/(ho|abbiamo) (visto|notato) che (hai|ha|avete) (aperto|cliccato|letto)|(hai|ha|avete) (aperto|cliccato) (la|le|il|una|il nostro)/i.test(text)) {
    issues.push('Non dire mai di aver tracciato aperture, click o letture delle comunicazioni precedenti.')
  }
  if (/\b(le nostre funzionalit|include:|offriamo:|ecco cosa (offriamo|include))/i.test(text)) {
    issues.push('Non aprire ne costruire l’email su un elenco di funzionalita: usa uno scenario concreto (la bottiglia, il QR, il cliente straniero).')
  }

  return issues
}

/**
 * Variante wine da salvare sulla bozza (`email_drafts.wine_template`).
 * `null` per i contatti fuori dal segmento vino.
 */
export function resolveWineTemplateId(
  contact: CRMContact,
  settings?: EmailAiFrameworkSettings | null,
  explicitId?: string | null
) {
  if (!isWineSegmentContact(contact)) return null
  const templates = getWineEmailTemplates(withEmailAiFramework(settings).email_wine_templates)
  return pickWineEmailTemplate(contact, explicitId, templates).id
}

export type EmailSegmentGuidanceOptions = {
  /** C'e gia una email inviata a questo contatto: sblocca i modelli di ripresa contatto. */
  followupMode?: boolean
  /** Variante wine scelta a mano dalla UI; senza scelta si usa la rotazione per contatto. */
  wineTemplateId?: string | null
}

export function buildEmailSegmentGuidance(
  contact: CRMContact,
  settings?: EmailAiFrameworkSettings | null,
  options: EmailSegmentGuidanceOptions = {}
) {
  const company = String(contact.company || '').toLowerCase()
  const email = String(contact.email || '').toLowerCase()
  const emailLocalPart = email.split('@')[0] || ''
  const category = String(contact.category || '').toLowerCase()
  const name = String(contact.name || '').trim()
  const notes = String(contact.note || '').toLowerCase()

  const guidance: string[] = []

  const isWineOrEventSegment = isWineSegmentContact(contact)

  const openCount = Number(contact.email_open_count || 0)
  const clickCount = Number(contact.email_click_count || 0)
  const isHighInterestContact = clickCount > 0 || openCount >= 2

  if (isWineOrEventSegment) {
    const framework = withEmailAiFramework(settings)

    // The master Wine positioning applies to every wine draft: cold and high interest.
    guidance.push(
      `Messaggio centrale del settore vino (vale per ogni email a una cantina, prima o follow-up):\n${framework.email_wine_core_message}`
    )

    if (isHighInterestContact) {
      guidance.push(`Segmento contatti ad alto interesse:\n${framework.email_high_interest_segment}`)
    } else {
      guidance.push(
        'Primo contatto con la cantina: parti dal risultato per la cantina, poi rendi concreto il concetto con lo scenario della bottiglia. Non elencare funzionalita e non vendere QR, traduzioni, video o AI come prodotti separati.',
        'Non dire che il destinatario ha aperto o cliccato una precedente email e non fingere di averlo incontrato in fiera o a un evento.'
      )
    }

    // I modelli wine chiudono il segmento: sono l'ultima parola su struttura e CTA.
    const template = pickWineEmailTemplate(
      contact,
      options.wineTemplateId,
      getWineEmailTemplates(framework.email_wine_templates)
    )
    guidance.push(
      formatWineEmailTemplateGuidance(template, {
        hasPreviousContact: !!options.followupMode || isHighInterestContact,
      })
    )
  }

  const isPa =
    company.includes('comune') ||
    emailLocalPart.includes('comune') ||
    email.includes('.gov.') ||
    email.includes('comune.') ||
    email.startsWith('sindaco@') ||
    notes.includes('regione:') ||
    category.includes('ente pubblico') ||
    company.includes('regione') ||
    company.includes('provincia')

  if (isPa) {
    guidance.push(
      `Messaggio centrale del settore pubblico (vale per ogni email a un Comune o ente, prima o follow-up):\n${withEmailAiFramework(settings).email_public_sector_core_message}`,
      'Ente pubblico o destinazione: usa sempre una forma istituzionale (Lei, Le, vostro Comune/ente). Non usare mai tu, ti o tuo.',
      'Evita tono da vendita aggressiva e non attribuire progetti o priorita specifiche non presenti nei dati.',
      'Se il contatto e un Comune, un ente o una casella istituzionale senza un referente personale certo, apri con “Buongiorno,” senza inventare un nome. Non presumere che chi legge sia il decisore: chiedi cortesemente di essere indirizzato al referente che segue turismo, cultura, comunicazione o accessibilita e proponi con quella persona un incontro di 15 minuti.',
      'Nei follow-up ricorda esplicitamente e con tatto l’email precedente, per esempio: “Le avevamo scritto qualche tempo fa in merito a…” oppure “Avevamo inviato una breve presentazione di Speaqi e volevamo capire se fosse possibile approfondire”.',
      `Dopo il ringraziamento/chiusura (prima della firma, che viene aggiunta dal CRM) inserisci sempre questo footer: “Speaqi è stato raccontato anche da Rai 3 (Mezzogiorno Italia): ${SPEAQI_RAI3_URL}”.`
    )
  }

  if (isMunicipalityContact(contact)) {
    guidance.push(
      'Comune: non agganciare l’email a eventi specifici, feste, sagre o calendari stagionali (rischio che siano gia passati).',
      'Rendi concreto il messaggio centrale con lo scenario del visitatore straniero davanti alla targa o al punto panoramico, invece di descrivere la piattaforma.',
      `Nel corpo inserisci sempre il riferimento alla pagina dedicata: ${SPEAQI_COMUNI_URL} (Programma Pilota Comuni, come funziona, esempi).`,
      'Oggetto: orientato a territorio/accessibilita/informazioni multilingua, non a un evento o a una stagione.'
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

  // Rai 3 footer for every draft (including non-PA).
  if (!isPa) {
    guidance.push(
      `Dopo il ringraziamento/chiusura (prima della firma, che viene aggiunta dal CRM) inserisci sempre questo footer: “Speaqi è stato raccontato anche da Rai 3 (Mezzogiorno Italia): ${SPEAQI_RAI3_URL}”.`
    )
  }

  return guidance.join('\n')
}
