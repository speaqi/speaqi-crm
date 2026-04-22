import { NextRequest } from 'next/server'
import { stringifyCsvRows } from '@/lib/csv-import'
import { requireRouteUser } from '@/lib/server/supabase'

type OcrExtractedContact = {
  full_name: string | null
  first_name: string | null
  last_name: string | null
  company: string | null
  role: string | null
  email: string | null
  phone: string | null
  country: string | null
  province: string | null
  note: string | null
}

type OcrExtractionResult = {
  contacts: OcrExtractedContact[]
}

const MAX_FILES = 12
const MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024
const OCR_MODEL = process.env.OPENAI_VISION_MODEL || process.env.OPENAI_MODEL || 'gpt-5-mini'

function normalizeText(value: unknown) {
  const normalized = String(value || '').trim()
  return normalized || null
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object') {
    if ('message' in error && (error as { message?: unknown }).message) {
      return String((error as { message?: unknown }).message)
    }
    if ('details' in error && (error as { details?: unknown }).details) {
      return String((error as { details?: unknown }).details)
    }
  }
  return fallback
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

async function fileToDataUrl(file: File) {
  const arrayBuffer = await file.arrayBuffer()
  const base64 = Buffer.from(arrayBuffer).toString('base64')
  return `data:${file.type || 'application/octet-stream'};base64,${base64}`
}

async function extractContactsFromImage(file: File): Promise<OcrExtractedContact[]> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY non configurata')
  }

  const imageUrl = await fileToDataUrl(file)
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OCR_MODEL,
      reasoning: { effort: 'minimal' },
      text: {
        format: {
          type: 'json_schema',
          name: 'crm_contact_ocr',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              contacts: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    full_name: { type: ['string', 'null'] },
                    first_name: { type: ['string', 'null'] },
                    last_name: { type: ['string', 'null'] },
                    company: { type: ['string', 'null'] },
                    role: { type: ['string', 'null'] },
                    email: { type: ['string', 'null'] },
                    phone: { type: ['string', 'null'] },
                    country: { type: ['string', 'null'] },
                    province: { type: ['string', 'null'] },
                    note: { type: ['string', 'null'] },
                  },
                  required: [
                    'full_name',
                    'first_name',
                    'last_name',
                    'company',
                    'role',
                    'email',
                    'phone',
                    'country',
                    'province',
                    'note',
                  ],
                },
              },
            },
            required: ['contacts'],
          },
        },
      },
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text:
                'Leggi questa immagine di biglietto da visita o contatto fiera e restituisci solo i dati chiaramente presenti. ' +
                'Se un campo non e leggibile o non esiste, usa null. ' +
                'Se trovi una sola persona, restituisci un array con un solo elemento. ' +
                'Non inventare email, telefono, nome o azienda. ' +
                'Metti in note solo dettagli testuali utili non mappabili altrove, per esempio indirizzo, sito web, padiglione, stand o note manoscritte.',
            },
            {
              type: 'input_image',
              image_url: imageUrl,
              detail: 'high',
            },
          ],
        },
      ],
    }),
  })

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(payload?.error?.message || 'OCR OpenAI fallito')
  }

  const text = extractTextOutput(payload)
  if (!text) {
    throw new Error(`Nessun testo OCR estratto da ${file.name}`)
  }

  const parsed = JSON.parse(text) as OcrExtractionResult
  return Array.isArray(parsed.contacts) ? parsed.contacts : []
}

export async function POST(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const formData = await request.formData()
    const rawFiles = formData.getAll('files')
    const files = rawFiles.filter((entry): entry is File => entry instanceof File && entry.size > 0)

    if (!files.length) {
      return Response.json({ error: 'Carica almeno un’immagine' }, { status: 400 })
    }

    if (files.length > MAX_FILES) {
      return Response.json({ error: `Puoi caricare al massimo ${MAX_FILES} immagini per volta` }, { status: 400 })
    }

    for (const file of files) {
      if (!file.type.startsWith('image/')) {
        return Response.json({ error: `Formato non supportato: ${file.name}` }, { status: 400 })
      }
      if (file.size > MAX_FILE_SIZE_BYTES) {
        return Response.json({ error: `${file.name} supera il limite di 8MB` }, { status: 400 })
      }
    }

    const extractedPerFile = await Promise.all(
      files.map(async (file) => ({
        file,
        contacts: await extractContactsFromImage(file),
      }))
    )

    const rows = extractedPerFile.flatMap(({ file, contacts }) =>
      contacts
        .map((contact) => {
          const firstName = normalizeText(contact.first_name)
          const lastName = normalizeText(contact.last_name)
          const fullName =
            normalizeText(contact.full_name) ||
            normalizeText([firstName, lastName].filter(Boolean).join(' ')) ||
            normalizeText(contact.company)

          if (!fullName) return null

          const extraNotes = [
            normalizeText(contact.note),
            `OCR file: ${file.name}`,
          ]
            .filter(Boolean)
            .join(' · ')

          return {
            name: fullName,
            first_name: firstName || '',
            last_name: lastName || '',
            company: normalizeText(contact.company) || '',
            role: normalizeText(contact.role) || '',
            email: normalizeText(contact.email) || '',
            phone: normalizeText(contact.phone) || '',
            country: normalizeText(contact.country) || '',
            province: normalizeText(contact.province) || '',
            note: extraNotes,
            source: 'ocr',
          }
        })
        .filter(Boolean) as Array<Record<string, string>>
    )

    if (!rows.length) {
      return Response.json({ error: 'Nessun contatto leggibile trovato nelle immagini caricate' }, { status: 422 })
    }

    const headers = ['name', 'first_name', 'last_name', 'company', 'role', 'email', 'phone', 'country', 'province', 'note', 'source']

    return Response.json({
      files_processed: files.length,
      extracted_contacts: rows.length,
      csv_text: stringifyCsvRows(rows, headers),
      rows,
    })
  } catch (error) {
    return Response.json(
      { error: errorMessage(error, 'OCR import failed') },
      { status: 500 }
    )
  }
}
