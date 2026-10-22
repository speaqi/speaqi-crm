import { NextRequest } from 'next/server'
import { agencyBody, agencyRoute, getSettings, saveSettings } from '@/lib/server/agency'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  return agencyRoute(request, async (auth) => ({ settings: await getSettings(auth.supabase, auth.user.id) }))
}

export async function PUT(request: NextRequest) {
  return agencyRoute(request, async (auth) => ({ settings: await saveSettings(auth.supabase, auth.user.id, await agencyBody(request)) }))
}
