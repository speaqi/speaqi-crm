import { NextRequest, NextResponse } from 'next/server'
import { encryptSecret, exchangeCodeForTokens, fetchGmailProfile, isMissingRelation } from '@/lib/server/gmail'
import { createServiceRoleClient } from '@/lib/server/supabase'

function getAppOrigin(request: NextRequest) {
  const configuredRedirectUri = process.env.GOOGLE_REDIRECT_URI
  if (configuredRedirectUri) {
    try {
      return new URL(configuredRedirectUri).origin
    } catch {}
  }

  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
  const host = forwardedHost || request.headers.get('host') || request.nextUrl.host
  const protocol = forwardedProto || request.nextUrl.protocol.replace(':', '') || 'https'

  return `${protocol}://${host}`
}

const GMAIL_STATE_COOKIE = 'speaqi_gmail_oauth_state'

function redirectToStatus(request: NextRequest, status: 'connected' | 'error', message?: string) {
  const url = new URL('/gmail', getAppOrigin(request))
  url.searchParams.set('gmail', status)
  if (message) url.searchParams.set('message', message)
  const response = NextResponse.redirect(url)
  // Monouso: il cookie viene rimosso su ogni esito.
  response.cookies.set(GMAIL_STATE_COOKIE, '', {
    path: '/api/gmail',
    maxAge: 0,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  })
  return response
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')
  const state = request.nextUrl.searchParams.get('state')
  const oauthError = request.nextUrl.searchParams.get('error')

  if (oauthError) {
    return redirectToStatus(request, 'error', oauthError)
  }

  if (!code || !state) {
    return redirectToStatus(request, 'error', 'Missing Gmail OAuth parameters')
  }

  // Lo state deve essere quello salvato nel cookie HttpOnly di questo browser.
  // Senza questo controllo un attaccante può far autorizzare Gmail alla vittima
  // e collegarlo al proprio account CRM.
  const cookieState = request.cookies.get(GMAIL_STATE_COOKIE)?.value || ''
  if (!cookieState || cookieState !== state) {
    return redirectToStatus(request, 'error', 'OAuth state non valido o scaduto. Riprova il collegamento.')
  }

  try {
    const admin = createServiceRoleClient()
    const { data: stateRows, error: stateError } = await admin
      .from('gmail_oauth_states')
      .delete()
      .eq('state', state)
      .select('*')

    const oauthState = stateRows?.length === 1 ? stateRows[0] : null

    if (stateError || !oauthState) {
      throw stateError || new Error('OAuth state not found')
    }

    const expiresAt = oauthState.expires_at
      ? new Date(oauthState.expires_at).getTime()
      : new Date(oauthState.created_at).getTime() + 10 * 60 * 1000
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      throw new Error('OAuth state scaduto. Riprova il collegamento.')
    }

    // DELETE RETURNING acquisisce e consuma lo state in una sola operazione.
    // Solo il callback che ha ricevuto la riga può scambiare il codice.

    const { data: existingAccount } = await admin
      .from('gmail_accounts')
      .select('*')
      .eq('user_id', oauthState.user_id)
      .maybeSingle()

    const tokens = await exchangeCodeForTokens(code, oauthState.code_verifier || undefined)
    const profile = await fetchGmailProfile(tokens.access_token)

    const encryptedRefreshToken = tokens.refresh_token
      ? encryptSecret(tokens.refresh_token)
      : existingAccount?.refresh_token

    if (!encryptedRefreshToken) {
      throw new Error('Google did not return a refresh token')
    }

    const { error: upsertError } = await admin
      .from('gmail_accounts')
      .upsert(
        {
          user_id: oauthState.user_id,
          email: profile.emailAddress,
          refresh_token: encryptedRefreshToken,
          scope: tokens.scope || existingAccount?.scope || null,
          token_type: tokens.token_type || existingAccount?.token_type || null,
          history_id: profile.historyId || existingAccount?.history_id || null,
        },
        {
          onConflict: 'user_id',
        }
      )

    if (upsertError) throw upsertError

    return redirectToStatus(request, 'connected')
  } catch (error) {
    if (isMissingRelation(error)) {
      return redirectToStatus(
        request,
        'error',
        'Schema Gmail non presente. Applica la migration 20260327154240_gmail_integration.sql.'
      )
    }

    return redirectToStatus(
      request,
      'error',
      error instanceof Error ? error.message : 'Failed to complete Gmail OAuth'
    )
  }
}
