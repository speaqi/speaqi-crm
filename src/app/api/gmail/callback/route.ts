import { NextRequest, NextResponse } from 'next/server'
import { encryptSecret, exchangeCodeForTokens, fetchGmailProfile, isMissingRelation } from '@/lib/server/gmail'
import { GMAIL_OAUTH_STATE_COOKIE, checkGmailOAuthState, gmailOAuthCookieOptions } from '@/lib/server/gmail-oauth-state'
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

function redirectToStatus(request: NextRequest, status: 'connected' | 'error', message?: string) {
  const url = new URL('/gmail', getAppOrigin(request))
  url.searchParams.set('gmail', status)
  if (message) url.searchParams.set('message', message)
  const response = NextResponse.redirect(url)
  // Lo state si usa una volta sola: il cookie se ne va con qualunque esito.
  response.cookies.set(GMAIL_OAUTH_STATE_COOKIE, '', { ...gmailOAuthCookieOptions(), maxAge: 0 })
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

  try {
    const admin = createServiceRoleClient()
    // Letto e cancellato insieme: due ritorni con lo stesso state non collegano due volte.
    const { data: oauthState, error: stateError } = await admin
      .from('gmail_oauth_states')
      .delete()
      .eq('state', state)
      .select('*')
      .maybeSingle()

    if (stateError) throw stateError
    if (!oauthState) {
      return redirectToStatus(request, 'error', 'Collegamento non valido o già usato: riprova')
    }
    const check = checkGmailOAuthState({
      state,
      cookieState: request.cookies.get(GMAIL_OAUTH_STATE_COOKIE)?.value,
      createdAt: oauthState.created_at,
    })
    if (!check.ok) return redirectToStatus(request, 'error', check.reason)

    const { data: existingAccount } = await admin
      .from('gmail_accounts')
      .select('*')
      .eq('user_id', oauthState.user_id)
      .maybeSingle()

    const tokens = await exchangeCodeForTokens(code)
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
