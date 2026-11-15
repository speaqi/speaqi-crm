const CONTACT_URL = 'https://crm.speaqi.com/contacts/'
const ID = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i

export function directorContactRequest(text: string, today: string): { day: string; limit: number } | null {
  const words = text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').trim()
  if (/\b(?:ricordam[ei]|segnam[ei]|segna|crea|aggiungi|pianifica|programma|promemoria|calendario|manda(?:re|mi)?|invia(?:re|mi)?|prenota|fissa)\b/.test(words)) return null
  if (!/\b(?:chi|qual[ie]|mi (?:dai|dici|indichi|suggerisci|consigli|elenc[ha]i)|dimmi|indicami|elencami|suggeriscimi|consigliami|fammi una lista)\b/.test(words)
    || !/\b(?:ricontattar\w*|contattar\w*|chiamar\w*|scrivere|sentire)\b/.test(words)) return null
  if (!/\b(?:chi|qual[ie]|contatti|persone|nomi|clienti|referenti|lead)\b/.test(words)) return null
  const count = words.match(/\b(\d+|uno|una|due|tre|quattro|cinque)\s+(?:contatti|persone|nomi|clienti|referenti|lead)\b/)?.[1]
  const named: Record<string, number> = { uno: 1, una: 1, due: 2, tre: 3, quattro: 4, cinque: 5 }
  const date = new Date(today + 'T00:00:00Z')
  if (/\b(?:dopo\s*domani|dopodomani)\b/.test(words)) date.setUTCDate(date.getUTCDate() + 2)
  else if (/\bdomani\b/.test(words)) date.setUTCDate(date.getUTCDate() + 1)
  return { day: date.toISOString().slice(0, 10), limit: Math.max(1, Math.min(5, count ? named[count] || Number(count) : 5)) }
}

export type DueTourismContact = {
  title: string; stage: string; segment: string | null; due_on: string; website: string | null; next_action: string | null
}
export type DirectorCrmContact = {
  id: string; name: string | null; company: string | null; email: string | null; phone: string | null;
  hidden: boolean | null; status: string | null; email_unsubscribed_at: string | null;
}
type Pick = { id: string; name: string; company: string; action: string; priority: number; due: string }

export function linkedDirectorContactId(url: string | null): string | null {
  if (!url?.startsWith(CONTACT_URL)) return null
  const id = url.slice(CONTACT_URL.length)
  return ID.test(id) ? id : null
}

function shortLine(value: string | null | undefined, length: number) {
  return (value || '').replace(/\s+/g, ' ').trim().slice(0, length)
}

const normalized = (value: string) => value.normalize('NFD').replace(/[^\p{L}\p{N}]+/gu, '').toLowerCase()
const person = (value: string) => /^[\p{L}.'’\-]+(?:\s+[\p{L}.'’\-]+){1,5}$/u.test(value)
  && !/\b(?:srl|spa|ltd|group|associazione|comune|tourism|hotel|ufficio|info|regione|tour|direzione)\b/iu.test(value)

export function rankDirectorContacts(
  request: { day: string; limit: number }, work: DueTourismContact[], contacts: DirectorCrmContact[],
): Pick[] {
  const byId = new Map(contacts.map(contact => [contact.id, contact]))
  const candidates: (Pick & { email: string })[] = []
  for (const item of work) {
    if (!item.due_on || item.due_on > request.day || !['contact', 'contacted', 'proposal'].includes(item.stage)) continue
    const id = linkedDirectorContactId(item.website)
    const crm = id ? byId.get(id) : undefined
    if (!crm || crm.hidden || crm.email_unsubscribed_at || /^(?:lost|perso|archived|archiviato|do.not.contact)$/i.test(crm.status?.trim() || '')) continue
    const email = (crm.email || '').trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && (crm.phone || '').replace(/\D/g, '').length < 6) continue
    const [heading, namedPerson, ...extra] = item.title.split(/\s+·\s+/)
    const company = shortLine(crm.company || (namedPerson ? heading : ''), 110)
    const cardName = shortLine(crm.name, 90)
    const named = shortLine(namedPerson, 90)
    const cardHasPerson = !!company && person(cardName) && normalized(cardName) !== normalized(company)
    const name = cardHasPerson ? cardName : !extra.length && person(named) ? named : ''
    const action = shortLine(item.next_action, 250)
    if (!name || !action || /\b(?:non (?:ricontattare|sollecitare|interessat\w*)|recapito da verificare)\b/i.test(item.segment + ' ' + action)) continue
    const segment = item.segment || ''
    const priority = /ha risposto|relazione esistente/i.test(segment) ? 30
      : /bozza pronta|navigazione/i.test(segment) ? 20 : item.stage === 'contacted' ? 10 : 0
    candidates.push({ id: crm.id, name, company, action, priority, due: item.due_on, email })
  }
  const seen = new Set<string>()
  return candidates.sort((a, b) => Number(b.due === request.day) - Number(a.due === request.day)
    || b.priority - a.priority || a.due.localeCompare(b.due) || a.name.localeCompare(b.name, 'it') || a.id.localeCompare(b.id))
    .filter(candidate => {
      const keys = [candidate.id, normalized(candidate.company), candidate.email].filter(Boolean)
      if (keys.some(key => seen.has(key))) return false
      for (const key of keys) seen.add(key)
      return true
    }).slice(0, request.limit).map(({ email: _email, ...pick }) => pick)
}

export function directorContactReply(day: string, picks: Pick[]) {
  const date = new Intl.DateTimeFormat('it-IT', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' })
    .format(new Date(day + 'T00:00:00Z'))
  if (!picks.length) return `Per ${date} non ho trovato nel CRM nominativi con un recapito e un prossimo passo in agenda.`
  return [`Dal CRM, per ${date}:`, ...picks.map((pick, i) =>
    `${i + 1}. ${pick.name}${pick.company ? ' — ' + pick.company : ''}\n${pick.action}\n${CONTACT_URL}${pick.id}`)].join('\n\n')
}
