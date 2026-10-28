/** Errore del bridge con lo stato HTTP di StudioMap: 400 vuol dire rifiutata prima di spendere. */
export class OfficeStudioError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

/** Il bridge parla soltanto con l'origine configurata, mai con URL della coda. */
export async function officeStudioRequest(path: '/api/office/mymaps/run' | '/api/office/quality/read' | '/api/office/event-sources/research',
  body: unknown, timeoutMs = 120_000) {
  const secret = process.env.OFFICE_BRIDGE_SECRET
  if (!secret || secret.length < 32) throw new Error('OFFICE_BRIDGE_SECRET mancante o troppo corto')
  const base = new URL(process.env.OFFICE_STUDIOMAP_URL || 'https://studiomap.speaqi.com')
  if (base.protocol !== 'https:' || base.username || base.password) throw new Error('OFFICE_STUDIOMAP_URL deve essere una origine HTTPS')
  const response = await fetch(new URL(path,base.origin),{method:'POST',headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json'},
    body:JSON.stringify(body),signal:AbortSignal.timeout(timeoutMs),redirect:'error',cache:'no-store'})
  if (!response.ok) {
    // Il motivo di StudioMap serve a capire cosa correggere (fonte mancante, mappa ambigua…).
    const payload = await response.json().catch(() => null)
    const reason = String(payload?.error || payload?.message || '').replace(/\s+/g, ' ').trim().slice(0, 300)
    throw new OfficeStudioError(`StudioMap HTTP ${response.status}${reason ? ` — ${reason}` : ''}: esito da verificare prima di riprovare`, response.status)
  }
  return response.json()
}
