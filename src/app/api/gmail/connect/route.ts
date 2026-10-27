import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { buildGmailConnectUrl, isMissingRelation } from '@/lib/server/gmail'
import { requireRouteUser, requireArea } from '@/lib/server/supabase'

const GMAIL_MIGRATION_ERROR =
  'Schema Gmail non presente. Applica la migration 20260327154240_gmail_integration.sql.'

export async function POST(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error
  const areaError = requireArea(auth, 'email')
  if (areaError) return areaError

  try {
    const state = crypto.randomBytes(24).toString('base64url')
    const codeVerifier = crypto.randomBytes(32).toString('base64url')
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url')

    // Un solo state attivo per utente: annulla eventuali tentativi precedenti.
    await auth.supabase
      .from('gmail_oauth_states')
      .delete()
      .eq('user_id', auth.user.id)

    const { error } = await auth.supabase
      .from('gmail_oauth_states')
      .insert({
        state,
        user_id: auth.user.id,
        code_verifier: codeVerifier,
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      })

    if (error) throw error

    const response = NextResponse.json({
      url: buildGmailConnectUrl(state, codeChallenge),
    })
    // Lo state deve tornare dallo stesso browser che ha iniziato il flusso:
    // senza questo cookie un link di consenso può collegare il Gmail di un
    // altro utente al workspace dell'attaccante (OAuth CSRF).
    response.cookies.set('speaqi_gmail_oauth_state', state, {
      path: '/api/gmail',
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 600,
    })
    return response
  } catch (error) {
    if (isMissingRelation(error)) {
      return Response.json({ error: GMAIL_MIGRATION_ERROR }, { status: 500 })
    }

    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to start Gmail OAuth' },
      { status: 500 }
    )
  }
}
