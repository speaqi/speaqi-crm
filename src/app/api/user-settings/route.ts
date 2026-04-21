import { NextRequest } from 'next/server'
import { errorMessage } from '@/lib/server/http'
import { requireRouteUser } from '@/lib/server/supabase'

export async function GET(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const { data } = await auth.supabase
      .from('user_settings')
      .select('speaqi_context, email_tone, email_signature')
      .eq('user_id', auth.user.id)
      .maybeSingle()

    return Response.json({
      settings: data ?? { speaqi_context: null, email_tone: null, email_signature: null },
    })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Failed to load settings') }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const body = await request.json()
    const payload = {
      user_id: auth.user.id,
      speaqi_context: body.speaqi_context ?? null,
      email_tone: body.email_tone ?? null,
      email_signature: body.email_signature ?? null,
      updated_at: new Date().toISOString(),
    }

    const { error } = await auth.supabase
      .from('user_settings')
      .upsert(payload, { onConflict: 'user_id' })

    if (error) throw error

    return Response.json({ ok: true })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Failed to save settings') }, { status: 500 })
  }
}
