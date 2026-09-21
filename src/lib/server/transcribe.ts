/**
 * Trascrizione di un vocale. Un solo posto, perché i vocali entrano nel CRM da
 * due porte diverse — il microfono del browser e il bot Telegram — e la
 * differenza fra le due deve stare nel trasporto, non in come si ascolta.
 */

export const MAX_AUDIO_BYTES = 20 * 1024 * 1024

const DEFAULT_PROMPT =
  'Contesto commerciale CRM. Trascrivi fedelmente nomi di persone, aziende, luoghi, eventi e indicazioni utili per scrivere una email.'

export class TranscriptionError extends Error {
  status: number
  constructor(message: string, status = 502) {
    super(message)
    this.name = 'TranscriptionError'
    this.status = status
  }
}

export async function transcribeAudio(
  audio: Blob,
  options: { fileName?: string; prompt?: string } = {}
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new TranscriptionError('OPENAI_API_KEY non configurata', 500)
  if (!audio || audio.size === 0) throw new TranscriptionError('File audio obbligatorio', 400)
  if (audio.size > MAX_AUDIO_BYTES) throw new TranscriptionError('Il vocale supera il limite di 20 MB', 413)

  const form = new FormData()
  form.append('file', audio, options.fileName || 'vocale.webm')
  form.append('model', process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe')
  form.append('language', 'it')
  form.append('response_format', 'json')
  form.append('prompt', options.prompt || DEFAULT_PROMPT)

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  })

  if (!response.ok) {
    const details = await response.text().catch(() => '')
    console.error(`[transcribe] OpenAI error HTTP ${response.status}: ${details.slice(0, 300)}`)
    throw new TranscriptionError('Trascrizione del vocale non riuscita', 502)
  }

  const payload = (await response.json()) as { text?: string }
  const transcript = String(payload.text || '').trim()
  if (!transcript) throw new TranscriptionError('Il vocale non contiene testo riconoscibile', 422)
  return transcript
}
