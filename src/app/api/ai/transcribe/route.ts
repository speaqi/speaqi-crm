import { NextRequest } from 'next/server'
import { errorMessage } from '@/lib/server/http'
import { requireRouteUser } from '@/lib/server/supabase'

const MAX_AUDIO_BYTES = 20 * 1024 * 1024

export async function POST(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return Response.json({ error: 'OPENAI_API_KEY non configurata' }, { status: 500 })
  }

  try {
    const formData = await request.formData()
    const audio = formData.get('audio')

    if (!(audio instanceof File) || audio.size === 0) {
      return Response.json({ error: 'File audio obbligatorio' }, { status: 400 })
    }

    if (audio.size > MAX_AUDIO_BYTES) {
      return Response.json(
        { error: 'Il vocale supera il limite di 20 MB' },
        { status: 413 }
      )
    }

    const openAIForm = new FormData()
    openAIForm.append('file', audio, audio.name || 'contesto-vocale.webm')
    openAIForm.append(
      'model',
      process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe'
    )
    openAIForm.append('language', 'it')
    openAIForm.append('response_format', 'json')
    openAIForm.append(
      'prompt',
      'Contesto commerciale CRM. Trascrivi fedelmente nomi di persone, aziende, luoghi, eventi e indicazioni utili per scrivere una email.'
    )

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: openAIForm,
    })

    if (!response.ok) {
      const details = await response.text().catch(() => '')
      console.error(
        `[transcribe] OpenAI error HTTP ${response.status}: ${details.slice(0, 300)}`
      )
      return Response.json(
        { error: 'Trascrizione del vocale non riuscita' },
        { status: 502 }
      )
    }

    const payload = (await response.json()) as { text?: string }
    const transcript = String(payload.text || '').trim()

    if (!transcript) {
      return Response.json(
        { error: 'Il vocale non contiene testo riconoscibile' },
        { status: 422 }
      )
    }

    return Response.json({ transcript })
  } catch (error) {
    console.error('[transcribe] failed:', error)
    return Response.json(
      { error: errorMessage(error, 'Trascrizione del vocale non riuscita') },
      { status: 500 }
    )
  }
}
