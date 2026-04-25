import { NextRequest } from 'next/server'
import { errorMessage } from '@/lib/server/http'
import { requireRouteUser } from '@/lib/server/supabase'
import { EMPTY_USER_SETTINGS, loadUserSettings, saveUserSettings } from '@/lib/server/user-settings'

export async function GET(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const settings = await loadUserSettings(auth.supabase, auth.workspaceUserId)

    return Response.json({
      settings: settings ?? EMPTY_USER_SETTINGS,
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
    await saveUserSettings(auth.supabase, auth.workspaceUserId, body)

    return Response.json({ ok: true })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Failed to save settings') }, { status: 500 })
  }
}
