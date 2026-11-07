'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'

let cached: { at: number; ids: Set<string> } | null = null
let inflight: Promise<Set<string> | null> | null = null
const TTL_MS = 60_000

function load(): Promise<Set<string> | null> {
  if (cached && Date.now() - cached.at < TTL_MS) return Promise.resolve(cached.ids)
  if (!inflight) {
    inflight = apiFetch<{ ids: string[] }>('/api/contacts/focus-ids')
      .then((r) => {
        cached = { at: Date.now(), ids: new Set(r.ids || []) }
        return cached.ids
      })
      .catch(() => null)
      .finally(() => { inflight = null })
  }
  return inflight
}

/** null = non ancora noto (o non raggiungibile): chi usa l'elenco non deve nascondere niente. */
export function useFocusContactIds(): ReadonlySet<string> | null {
  const [ids, setIds] = useState<ReadonlySet<string> | null>(cached?.ids ?? null)
  useEffect(() => {
    let alive = true
    load().then((next) => { if (alive && next) setIds(next) })
    return () => { alive = false }
  }, [])
  return ids
}
