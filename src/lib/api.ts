'use client'

import { createClient } from '@/lib/supabase'

export class APIError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'APIError'
    this.status = status
  }
}

// Le richieste all'avvio partono insieme: una sola operazione rinnova il token
// e tutte le altre aspettano lo stesso risultato, senza invalidarsi a vicenda.
let refreshing: Promise<string | null> | null = null

async function refreshedToken() {
  if (!refreshing) {
    refreshing = createClient().auth.refreshSession()
      .then(({ data, error }) => error ? null : data.session?.access_token || null)
      .catch(() => null)
      .finally(() => { refreshing = null })
  }
  return refreshing
}

export async function apiFetch<T>(input: string, init: RequestInit = {}): Promise<T> {
  const supabase = createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()

  const request = (token?: string | null) => {
    const headers = new Headers(init.headers)
    if (token) headers.set('Authorization', `Bearer ${token}`)
    return fetch(input, { ...init, headers, cache: 'no-store' })
  }
  let response = await request(session?.access_token)
  if (response.status === 401) {
    const latest = await supabase.auth.getSession()
    const latestToken = latest.data.session?.access_token
    const token = latestToken && latestToken !== session?.access_token ? latestToken : await refreshedToken()
    if (token) response = await request(token)
  }

  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    throw new APIError(response.status === 401 ? 'Sessione scaduta: accedi nuovamente al CRM.' : payload?.error || 'Request failed', response.status)
  }

  return payload as T
}
