'use client'

import { apiFetch } from '@/lib/api'
import { createClient } from '@/lib/supabase'
import type { presentationView, projectView } from '@/lib/server/agency'

export type ProjectView = Awaited<ReturnType<typeof projectView>>
export type PresentationView = Awaited<ReturnType<typeof presentationView>>

export const post = <T,>(url: string, body: unknown, method = 'POST') =>
  apiFetch<T>(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

/** PDF e PPTX sono dietro il login: si scaricano con il token e si salvano come file. */
export async function download(url: string, fallback: string) {
  const { data } = await createClient().auth.getSession()
  const res = await fetch(url, { headers: { Authorization: `Bearer ${data.session?.access_token ?? ''}` }, cache: 'no-store' })
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || 'File non generato')
  const blob = URL.createObjectURL(await res.blob())
  const a = document.createElement('a')
  a.href = blob
  a.download = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || fallback
  a.click()
  setTimeout(() => URL.revokeObjectURL(blob), 10_000)
}

export const errorText = (err: unknown, fallback = 'Operazione non riuscita') => (err instanceof Error ? err.message : fallback)

export const day = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' }) : '—')
