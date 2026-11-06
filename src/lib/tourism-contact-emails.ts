/**
 * Recapiti email dai siti pubblici degli enti (DMC, tour operator, agenzie, alloggi...).
 *
 * Puro e senza rete: legge l'HTML che gli passa chi ha già scaricato la pagina, restituisce le
 * email trovate e dice di che tipo sono. Il giudizio sta qui e non nello script, così si prova
 * senza internet.
 *
 * Regola di fondo: si tiene una **casella d'ufficio dell'azienda** (info@, booking@, commerciale@)
 * sul dominio dell'azienda. Le caselle con nome e cognome, le PEC, gli indirizzi di terzi e i
 * segnaposto dei temi non entrano mai. Quello che non si riesce a giudicare («reception» su
 * gmail.com, «romeo@dominio») esce come `review`: si vede, ma non si scrive a freddo da solo.
 */
import { load } from 'cheerio'

export type EmailClass = 'role' | 'review'
export type EmailVia = 'mailto' | 'text' | 'cfemail' | 'jsonld'
export type Rejected = 'junk' | 'pec' | 'foreign' | 'personal'

export type EmailVerdict =
  | { ok: true; class: EmailClass; domainMatch: boolean; freemail: boolean; rank: number }
  | { ok: false; reason: Rejected }

export type FoundEmail = {
  email: string
  class: EmailClass
  domainMatch: boolean
  freemail: boolean
  via: EmailVia
  url: string
  rank: number
}

const SECOND_LEVEL = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'com.au', 'com.br', 'com.tr', 'co.nz', 'co.za', 'com.mx', 'com.ar',
  'co.jp', 'com.pt', 'com.gr', 'com.hr', 'com.mt', 'com.cy', 'co.il', 'com.eg', 'com.sg'
])

/** «www.hotel.casa-rossi.it» → «casa-rossi.it». Basta per confrontare un sito con le sue caselle. */
export function registrableDomain(host: string) {
  const labels = host.toLowerCase().replace(/\.$/, '').replace(/^www\./, '').split('.').filter(Boolean)
  if (labels.length <= 2) return labels.join('.')
  const last2 = labels.slice(-2).join('.')
  return SECOND_LEVEL.has(last2) ? labels.slice(-3).join('.') : last2
}

const FREEMAIL = new Set([
  'gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.it', 'hotmail.co.uk', 'outlook.com', 'outlook.it', 'live.com', 'live.it',
  'msn.com', 'yahoo.com', 'yahoo.it', 'yahoo.co.uk', 'ymail.com', 'libero.it', 'virgilio.it', 'tiscali.it', 'alice.it', 'tin.it',
  'icloud.com', 'me.com', 'mac.com', 'aol.com', 'fastwebnet.it', 'email.it', 'inwind.it', 'iol.it', 'live.it', 'proton.me',
  'protonmail.com', 'gmx.com', 'gmx.net', 'gmx.de', 'web.de', 'mail.com', 'yandex.com', 'tele2.it', 'vodafone.it', 'wind.it',
  'katamail.com', 'supereva.it', 'aruba.it', 'poste.it', 'postemail.it'
])
export const isFreemail = (domain: string) => FREEMAIL.has(domain.toLowerCase())

const PEC_LABELS = new Set([
  'pec', 'legalmail', 'postacert', 'postecert', 'arubapec', 'mailcert', 'pecimprese', 'sicurezzapostale', 'registerpec',
  'cert', 'pecaziendale', 'pecmail', 'lamiapec', 'postacertificata'
])

/** Caselle di servizio che non sono un contatto commerciale: privacy, dati personali, lavoro, legale, amministrazione dei dati. */
const NON_COMMERCIAL = /(privacy|gdpr|dpo|dataprotection|data-protection|legal|abuse|jobs?|career|recruit|lavora|candidature|curriculum|cv|fatture|invoice|amministrazione|billing)/i
const BAD_EXT = /\.(png|jpe?g|gif|webp|svg|avif|ico|css|js|mjs|woff2?|ttf|eot|pdf|map|json|xml)$/i
const BAD_DOMAIN =
  /(^|\.)(example\.(com|org|net)|domain\.(com|tld|it)|yourdomain\.|yoursite\.|email\.com|sentry(-next)?\.|wixpress\.com|godaddy\.com|test\.com|mysite\.com|sitename\.com|tuodominio\.|latuaemail\.|dominio\.(com|it)|nomedominio\.|company\.com|yourcompany\.)/i
const BAD_LOCAL = new Set([
  'you', 'your', 'name', 'nome', 'email', 'user', 'username', 'test', 'example', 'esempio', 'indirizzo', 'tuonome', 'tuaemail',
  'nomecognome', 'johndoe', 'john', 'jane', 'someone', 'xxx', 'xyz', 'noreply', 'no-reply', 'donotreply', 'do-not-reply',
  'mailer-daemon', 'postmaster', 'webmaster', 'abuse', 'privacy', 'dpo', 'gdpr', 'unsubscribe', 'disiscrizione', 'nome.cognome',
  'cognome', 'tuamail', 'yourname', 'youremail', 'support-wix', 'wordpress', 'admin'
])

/** Parole che indicano una casella dell'azienda e non di una persona. */
const ROLE = new Set([
  'info', 'infos', 'informazioni', 'informazione', 'information', 'contact', 'contacts', 'contatti', 'contatto', 'contacto', 'kontakt',
  'booking', 'bookings', 'book', 'prenotazioni', 'prenotazione', 'prenota', 'reservations', 'reservation', 'reserve', 'reservas',
  'reception', 'frontdesk', 'hello', 'ciao', 'hola', 'welcome', 'benvenuti', 'office', 'ufficio', 'uffici', 'segreteria',
  'commerciale', 'commerciali', 'sales', 'vendite', 'marketing', 'incoming', 'outgoing', 'groups', 'gruppi', 'group',
  'agenzia', 'agency', 'tours', 'tour', 'travel', 'viaggi', 'turismo', 'tourism', 'mail', 'post', 'posta', 'enquiries',
  'inquiries', 'enquiry', 'request', 'requests', 'richieste', 'direzione', 'management', 'team', 'desk', 'assistenza',
  'support', 'events', 'eventi', 'stampa', 'press', 'partner', 'partners', 'trade', 'b2b', 'dmc', 'operations', 'operativo',
  'quotes', 'preventivi', 'quotazioni', 'quotation', 'accoglienza', 'concierge', 'guests', 'clienti', 'customer', 'service',
  'servizio', 'servizi', 'rooms', 'camere', 'hotel', 'resort', 'booking-online', 'prenotazioniweb', 'content'
])
const isRole = (t: string) => ROLE.has(t) || (t.length >= 6 && [...ROLE].some((r) => r.length >= 6 && t.startsWith(r)))

/** Ordine di preferenza fra caselle d'ufficio: la più generica vince. */
const PREFERRED = ['info', 'contatti', 'contact', 'booking', 'prenotazioni', 'reservations', 'commerciale', 'sales', 'incoming', 'agenzia', 'office', 'ufficio']
const localPreference = (local: string) => {
  const first = local.split(/[._\-+]+/)[0]
  const i = PREFERRED.indexOf(first)
  return i === -1 ? PREFERRED.length : i
}

/** Aggiusta le forme che i siti usano per nascondere l'email ai robot. */
export function deobfuscate(text: string) {
  return text
    .replace(/&#0*64;|&#x0*40;|&commat;/gi, '@')
    .replace(/\s*[[({<]\s*(?:at|chiocciola|arroba|@)\s*[\])}>]\s*/gi, '@')
    .replace(/\s*[[({<]\s*(?:dot|punto|point)\s*[\])}>]\s*/gi, '.')
}

/** Protezione email di Cloudflare: il primo byte è la chiave, gli altri sono messi in XOR. */
export function decodeCfEmail(hex: string) {
  if (!/^[0-9a-f]{4,}$/i.test(hex) || hex.length % 2) return ''
  const key = parseInt(hex.slice(0, 2), 16)
  let out = ''
  for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key)
  try { return decodeURIComponent(escape(out)) } catch { return out }
}

const EMAIL_RE = /[a-z0-9][a-z0-9._%+-]*@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,24}/gi

function cleanEmail(raw: string) {
  const email = raw.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')
  const at = email.lastIndexOf('@')
  if (at < 1 || email.length > 80) return null
  return email
}

export function scanEmails(raw: string) {
  const found: string[] = []
  for (const m of deobfuscate(raw).matchAll(EMAIL_RE)) {
    const email = cleanEmail(m[0])
    if (email && !found.includes(email)) found.push(email)
  }
  return found
}

const localTokens = (local: string) => local.split(/[._\-+]+/).map((t) => t.replace(/^\d+|\d+$/g, '')).filter(Boolean)

/** Cos'è questo indirizzo, rispetto al sito da cui viene? */
export function classifyEmail(email: string, siteDomains: string[]): EmailVerdict {
  const at = email.lastIndexOf('@')
  const local = email.slice(0, at)
  const domain = email.slice(at + 1)
  if (!local || !domain || BAD_EXT.test(email) || BAD_DOMAIN.test(domain) || BAD_LOCAL.has(local) || /%/.test(email)) return { ok: false, reason: 'junk' }
  // Un numero di telefono attaccato all'indirizzo («0039info@», «040-9720020info@») o una casella che parla di
  // dati personali, lavoro o legale non è un recapito commerciale.
  if (/^[0-9+(]/.test(local) || /\d{3}[.\-]\d{2}/.test(local) || NON_COMMERCIAL.test(local)) return { ok: false, reason: 'junk' }
  if (domain.split('.').some((l) => PEC_LABELS.has(l) || /^pec\d*$/.test(l) || /legalmail|postacert|arubapec|pecimprese/.test(l))) return { ok: false, reason: 'pec' }

  const registrable = registrableDomain(domain)
  const freemail = isFreemail(registrable)
  const domainMatch = !freemail && siteDomains.includes(registrable)
  if (!freemail && !domainMatch) return { ok: false, reason: 'foreign' }

  const tokens = localTokens(local)
  const roles = tokens.filter(isRole)
  const others = tokens.filter((t) => !isRole(t))
  const brand = registrable.split('.')[0].replace(/-/g, '')
  // Il nome dell'azienda per intero (o l'inizio, se è lungo): «medmar@medmargroup.it». Una parola del nome
  // non basta: in «Hotel Rossi» anche mario.rossi@ conterrebbe «rossi».
  const joined = tokens.join('')
  const isBrand = !freemail && joined.length >= 6 && brand.startsWith(joined)
  const rank = localPreference(local)

  if (roles.length > 0 && others.length <= 1) return { ok: true, class: freemail ? 'review' : 'role', domainMatch, freemail, rank }
  if (isBrand) return { ok: true, class: 'role', domainMatch, freemail, rank: PREFERRED.length }
  // Una parola sola, senza ruolo: può essere l'azienda o un nome di battesimo. Si vede, ma non si manda da soli.
  if (tokens.length === 1 && tokens[0].length >= 3) return { ok: true, class: 'review', domainMatch, freemail, rank: PREFERRED.length + 1 }
  return { ok: false, reason: 'personal' }
}

function mailtoAddresses(href: string) {
  let value = href.replace(/^mailto:/i, '')
  try { value = decodeURIComponent(value) } catch { /* Un href storto non ferma la pagina. */ }
  return value.split('?')[0].split(/[,;]/).map((s) => s.trim()).filter(Boolean)
}

/** Tutte le email grezze di una pagina, con il modo in cui sono state trovate. */
export function extractRawEmails(html: string) {
  const $ = load(html)
  const out = new Map<string, EmailVia>()
  const add = (raw: string, via: EmailVia) => { for (const e of scanEmails(raw)) if (!out.has(e)) out.set(e, via) }

  $('a[href]').each((_, a) => {
    const href = String($(a).attr('href') || '')
    if (/^mailto:/i.test(href)) mailtoAddresses(href).forEach((v) => add(v, 'mailto'))
    const cf = /\/cdn-cgi\/l\/email-protection#([0-9a-f]+)/i.exec(href)
    if (cf) add(decodeCfEmail(cf[1]), 'cfemail')
  })
  $('[data-cfemail]').each((_, el) => add(decodeCfEmail(String($(el).attr('data-cfemail') || '')), 'cfemail'))
  $('script[type="application/ld+json"]').each((_, el) => add($(el).text(), 'jsonld'))
  $('script,style,noscript,svg,template').remove()
  add($('body').text(), 'text')
  return out
}

/** Le email di una pagina, già giudicate rispetto ai domini del sito. */
export function extractEmails(html: string, pageUrl: string, siteDomains: string[]) {
  const found: FoundEmail[] = []
  const rejected: Record<Rejected, number> = { junk: 0, pec: 0, foreign: 0, personal: 0 }
  for (const [email, via] of extractRawEmails(html)) {
    const verdict = classifyEmail(email, siteDomains)
    if (!verdict.ok) { rejected[verdict.reason]++; continue }
    found.push({ email, class: verdict.class, domainMatch: verdict.domainMatch, freemail: verdict.freemail, via, url: pageUrl, rank: verdict.rank })
  }
  return { found, rejected }
}

/** Fra più email trovate: prima le d'ufficio sul dominio dell'ente, poi la più generica. */
export function pickBestEmail(candidates: FoundEmail[]) {
  const seen = new Map<string, FoundEmail>()
  for (const c of candidates) if (!seen.has(c.email)) seen.set(c.email, c)
  const sorted = [...seen.values()].sort((a, b) =>
    Number(b.class === 'role') - Number(a.class === 'role') || Number(b.domainMatch) - Number(a.domainMatch)
    || a.rank - b.rank || a.email.localeCompare(b.email))
  return { best: sorted[0] || null, alternatives: sorted.slice(1, 4) }
}

const CONTACT_PATH = /(contatt|contact|kontakt|contacto|contatta|chi-?siamo|about|azienda|company|who-we-are|dove-siamo|impressum|note-?legali|legal|privacy|team|staff|agenzia)/i

/** Le pagine in cui un'azienda scrive il proprio recapito: prima i contatti, poi chi siamo, poi il legale. */
export function contactPageCandidates(base: string, links: Array<{ href: string; text: string }>, limit = 3) {
  let origin: URL
  try { origin = new URL(base) } catch { return [] }
  const site = registrableDomain(origin.hostname)
  const seen = new Set([origin.href.replace(/#.*$/, '')])
  const scored: Array<{ url: string; score: number }> = []
  for (const { href, text } of links) {
    let url: URL
    try { url = new URL(href, base) } catch { continue }
    if (!/^https?:$/.test(url.protocol) || registrableDomain(url.hostname) !== site) continue
    url.hash = ''
    if (url.pathname.match(/\.(pdf|jpe?g|png|webp|zip|docx?)$/i) || seen.has(url.href)) continue
    const label = `${url.pathname} ${text}`
    if (!CONTACT_PATH.test(label)) continue
    seen.add(url.href)
    const score = /(contatt|contact|kontakt|contacto)/i.test(label) ? 0 : /(chi-?siamo|about|azienda|company|dove-siamo|who-we-are)/i.test(label) ? 1 : 2
    scored.push({ url: url.href, score })
  }
  return scored.sort((a, b) => a.score - b.score || a.url.length - b.url.length).slice(0, limit).map((s) => s.url)
}

export const GUESSED_CONTACT_PATHS = ['/contatti', '/contatti/', '/contact', '/contacts', '/contact-us', '/contattaci', '/chi-siamo']

export function pageLinks(html: string) {
  const $ = load(html)
  return $('a[href]').map((_, a) => ({ href: String($(a).attr('href') || ''), text: $(a).text().replace(/\s+/g, ' ').trim() })).get()
}
