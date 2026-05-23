import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'

const AUTH_STORAGE_KEY = 'speaqi-crm-auth'

let browserClient: SupabaseClient | null = null

function getSupabaseUrl() {
  return process.env.NEXT_PUBLIC_SUPABASE_URL!
}

function getSupabaseAnonKey() {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
}

export function createClient() {
  if (!browserClient) {
    browserClient = createSupabaseClient(getSupabaseUrl(), getSupabaseAnonKey(), {
      auth: {
        storageKey: AUTH_STORAGE_KEY,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  }
  return browserClient
}

export function getSupabaseConfig() {
  return {
    url: getSupabaseUrl(),
    anonKey: getSupabaseAnonKey(),
  }
}
