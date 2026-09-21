import { NextRequest } from 'next/server'
import { errorMessage } from '@/lib/server/http'
import { requireRouteUser } from '@/lib/server/supabase'
import { TranscriptionError, transcribeAudio } from '@/lib/server/transcribe'

export async function POST(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const formData = await request.formData()
    const audio = formData.get('audio')

    if (!(audio instanceof File)) {
      return Response.json({ error: 'File audio obbligatorio' }, { status: 400 })
    }

    const transcript = await transcribeAudio(audio, { fileName: audio.name || 'contesto-vocale.webm' })
    return Response.json({ transcript })
  } catch (error) {
    if (error instanceof TranscriptionError) {
      return Response.json({ error: error.message }, { status: error.status })
    }
    console.error('[transcribe] failed:', error)
    return Response.json(
      { error: errorMessage(error, 'Trascrizione del vocale non riuscita') },
      { status: 500 }
    )
  }
}
