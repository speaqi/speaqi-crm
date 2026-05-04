import crypto from 'crypto'
import { createActivities, syncPendingCallTask, updateContactSummary } from '@/lib/server/crm'
import { applyReplyOutcome, logAiDecision, logLeadActivity } from '@/lib/server/ai-ready'
import type { CRMContact, GmailAccountStatus, GmailMessage } from '@/types'

type GmailAccountRecord = {
  id: string
  user_id: string
  email: string
  refresh_token: string
  scope?: string | null
  token_type?: string | null
  history_id?: string | null
  last_sync_at?: string | null
}

type GoogleTokenResponse = {
  access_token: string
  expires_in?: number
  refresh_token?: string
  scope?: string
  token_type?: string
}

type GmailMessageRef = {
  id: string
  threadId?: string
}

type GmailHeader = {
  name?: string
  value?: string
}

type GmailPayload = {
  mimeType?: string
  body?: {
    data?: string
  }
  headers?: GmailHeader[]
  parts?: GmailPayload[]
}

type GmailApiMessage = {
  id: string
  threadId?: string
  snippet?: string
  internalDate?: string
  payload?: GmailPayload
}

type GmailSendAs = {
  sendAsEmail?: string
  displayName?: string
  isDefault?: boolean
  signature?: string
  verificationStatus?: string
}

export type EmailSignature = {
  html: string
  text: string
  source: 'gmail' | 'settings'
}

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GMAIL_API_BASE_URL = 'https://gmail.googleapis.com/gmail/v1'
const GMAIL_SIGNATURE_SCOPE = 'https://www.googleapis.com/auth/gmail.settings.basic'
const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
  GMAIL_SIGNATURE_SCOPE,
  'https://www.googleapis.com/auth/calendar.events',
]

export const GMAIL_CONFIG_KEYS = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REDIRECT_URI',
  'GMAIL_TOKEN_ENCRYPTION_KEY',
] as const

type GmailConfigKey = (typeof GMAIL_CONFIG_KEYS)[number]

export function getGmailConfigStatus() {
  const values: Record<GmailConfigKey, string | undefined> = {
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI,
    GMAIL_TOKEN_ENCRYPTION_KEY: process.env.GMAIL_TOKEN_ENCRYPTION_KEY,
  }

  const present = Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, !!value])
  ) as Record<GmailConfigKey, boolean>

  const missing = GMAIL_CONFIG_KEYS.filter((key) => !present[key])

  return {
    configured: missing.length === 0,
    present,
    missing,
  }
}

export function formatMissingGmailConfigMessage(missing: readonly string[]) {
  if (!missing.length) return null
  return `Config Gmail incompleta nel runtime del deploy: mancano ${missing.join(', ')}.`
}

function getGoogleConfig() {
  const { present } = getGmailConfigStatus()
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const redirectUri = process.env.GOOGLE_REDIRECT_URI
  const encryptionKey = process.env.GMAIL_TOKEN_ENCRYPTION_KEY

  if (!present.GOOGLE_CLIENT_ID) throw new Error('GOOGLE_CLIENT_ID is required')
  if (!present.GOOGLE_CLIENT_SECRET) throw new Error('GOOGLE_CLIENT_SECRET is required')
  if (!present.GOOGLE_REDIRECT_URI) throw new Error('GOOGLE_REDIRECT_URI is required')
  if (!present.GMAIL_TOKEN_ENCRYPTION_KEY) throw new Error('GMAIL_TOKEN_ENCRYPTION_KEY is required')

  return {
    clientId: clientId!,
    clientSecret: clientSecret!,
    redirectUri: redirectUri!,
    encryptionKey: encryptionKey!,
  }
}

function getSymmetricKey() {
  return crypto.createHash('sha256').update(getGoogleConfig().encryptionKey).digest()
}

export function encryptSecret(value: string) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', getSymmetricKey(), iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return [iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join('.')
}

function decryptSecret(value: string) {
  const [ivBase64, tagBase64, payloadBase64] = String(value || '').split('.')
  if (!ivBase64 || !tagBase64 || !payloadBase64) {
    throw new Error('Invalid encrypted token format')
  }

  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    getSymmetricKey(),
    Buffer.from(ivBase64, 'base64url')
  )
  decipher.setAuthTag(Buffer.from(tagBase64, 'base64url'))

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payloadBase64, 'base64url')),
    decipher.final(),
  ])

  return decrypted.toString('utf8')
}

export function isMissingRelation(error: unknown) {
  return !!error && typeof error === 'object' && 'code' in error && String((error as { code?: unknown }).code) === '42P01'
}

function normalizeEmail(value?: string | null) {
  return String(value || '').trim().toLowerCase()
}

function uniqueEmails(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      values
        .flatMap((value) => extractEmailAddresses(value))
        .map((item) => item.toLowerCase())
        .filter(Boolean)
    )
  )
}

function extractEmailAddresses(value?: string | null) {
  if (!value) return []
  const matches = String(value).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)
  return matches ? Array.from(new Set(matches.map((item) => item.toLowerCase()))) : []
}

function decodeBase64Url(value?: string) {
  if (!value) return ''
  return Buffer.from(value, 'base64url').toString('utf8')
}

function stripHtml(html: string) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeScopeList(scope?: string | null) {
  return String(scope || '')
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

export function gmailAccountHasSignatureScope(account: { scope?: string | null } | null | undefined) {
  return normalizeScopeList(account?.scope).includes(GMAIL_SIGNATURE_SCOPE)
}

function collectBodies(payload?: GmailPayload | null, bucket = { plain: [] as string[], html: [] as string[] }) {
  if (!payload) return bucket

  const body = decodeBase64Url(payload.body?.data)
  if (payload.mimeType === 'text/plain' && body) bucket.plain.push(body)
  if (payload.mimeType === 'text/html' && body) bucket.html.push(body)

  for (const part of payload.parts || []) {
    collectBodies(part, bucket)
  }

  return bucket
}

function getHeader(headers: GmailHeader[] | undefined, name: string) {
  return headers?.find((header) => String(header.name || '').toLowerCase() === name.toLowerCase())?.value || ''
}

function getMessageTimestamp(message: GmailApiMessage, headers: GmailHeader[] | undefined) {
  const internalDate = Number(message.internalDate || 0)
  if (Number.isFinite(internalDate) && internalDate > 0) {
    return new Date(internalDate).toISOString()
  }

  const parsedDate = Date.parse(getHeader(headers, 'date'))
  if (Number.isFinite(parsedDate)) {
    return new Date(parsedDate).toISOString()
  }

  return new Date().toISOString()
}

function encodeMimeHeader(value: string) {
  return /[^\x20-\x7E]/.test(value)
    ? `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`
    : value
}

function encodeMessageBody(subject: string, to: string, html: string, text: string) {
  const boundary = `crm-${crypto.randomUUID()}`
  const raw = [
    `To: ${to}`,
    `Subject: ${encodeMimeHeader(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    text,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    html,
    '',
    `--${boundary}--`,
    '',
  ].join('\r\n')

  return Buffer.from(raw, 'utf8').toString('base64url')
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function simpleTextToHtml(value: string) {
  const escaped = escapeHtml(String(value || '').trim())
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.55;color:#111827">${escaped.replace(/\n/g, '<br />')}</div>`
}

export function signatureFromPlainText(value?: string | null): EmailSignature | null {
  const text = String(value || '').trim()
  if (!text) return null

  return {
    source: 'settings',
    text,
    html: simpleTextToHtml(text),
  }
}

function signatureAlreadyIncluded(messageText: string, signatureText: string) {
  const normalizedMessage = String(messageText || '').replace(/\s+/g, ' ').trim().toLowerCase()
  const normalizedSignature = String(signatureText || '').replace(/\s+/g, ' ').trim().toLowerCase()
  if (!normalizedMessage || !normalizedSignature) return false
  return normalizedMessage.includes(normalizedSignature.slice(0, Math.min(80, normalizedSignature.length)))
}

export function appendEmailSignature(
  input: { html: string; text: string },
  signature: EmailSignature | null
) {
  if (!signature?.text && !signature?.html) return input
  if (signature.text && signatureAlreadyIncluded(input.text, signature.text)) return input

  const text = [String(input.text || '').trim(), signature.text].filter(Boolean).join('\n\n')
  const html = [
    String(input.html || '').trim() || simpleTextToHtml(input.text || ''),
    '<br />',
    signature.html || simpleTextToHtml(signature.text || ''),
  ]
    .filter(Boolean)
    .join('\n')

  return { html, text }
}

async function parseResponse<T>(response: Response, fallback: string) {
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(payload?.error?.message || payload?.error || fallback)
  }
  return payload as T
}

async function gmailApiRequest<T>(accessToken: string, path: string, init: RequestInit = {}) {
  const response = await fetch(`${GMAIL_API_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
    cache: 'no-store',
  })

  return parseResponse<T>(response, 'Gmail API request failed')
}

async function listGmailSendAs(accessToken: string) {
  return gmailApiRequest<{ sendAs?: GmailSendAs[] }>(
    accessToken,
    '/users/me/settings/sendAs'
  )
}

async function loadGmailSignatureForAccount(account: GmailAccountRecord | null): Promise<EmailSignature | null> {
  if (!account || !gmailAccountHasSignatureScope(account)) return null

  try {
    const accessToken = await refreshAccessToken(account)
    const payload = await listGmailSendAs(accessToken)
    const accountEmail = normalizeEmail(account.email)
    const candidates = payload.sendAs || []
    const selected =
      candidates.find((item) => item.isDefault && normalizeEmail(item.sendAsEmail) === accountEmail) ||
      candidates.find((item) => normalizeEmail(item.sendAsEmail) === accountEmail) ||
      candidates.find((item) => item.isDefault) ||
      candidates[0]

    const html = String(selected?.signature || '').trim()
    if (!html) return null

    return {
      source: 'gmail',
      html,
      text: stripHtml(html),
    }
  } catch {
    return null
  }
}

export async function loadGmailSignature(supabase: any, userId: string): Promise<EmailSignature | null> {
  const account = await getGmailAccount(supabase, userId)
  return loadGmailSignatureForAccount(account)
}

export async function loadRequiredGmailSignature(supabase: any, userId: string): Promise<EmailSignature> {
  const account = await getGmailAccount(supabase, userId)
  if (!account) {
    throw new Error('Gmail non collegato: collega Gmail prima di creare bozze email.')
  }
  if (!gmailAccountHasSignatureScope(account)) {
    throw new Error('Firma Gmail non autorizzata: ricollega Gmail dalla pagina Gmail per consentire la lettura della firma.')
  }

  const signature = await loadGmailSignatureForAccount(account)
  if (!signature?.html && !signature?.text) {
    throw new Error('Firma Gmail non trovata: configura una firma in Gmail e poi rigenera la bozza.')
  }

  return signature
}

export function buildGmailConnectUrl(state: string) {
  const { clientId, redirectUri } = getGoogleConfig()
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    scope: GMAIL_SCOPES.join(' '),
    state,
  })

  return `${GOOGLE_AUTH_URL}?${params.toString()}`
}

export async function exchangeCodeForTokens(code: string) {
  const { clientId, clientSecret, redirectUri } = getGoogleConfig()
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code,
      grant_type: 'authorization_code',
    }),
    cache: 'no-store',
  })

  return parseResponse<GoogleTokenResponse>(response, 'Failed to exchange Google authorization code')
}

export async function refreshAccessToken(account: GmailAccountRecord) {
  const { clientId, clientSecret } = getGoogleConfig()
  const refreshToken = decryptSecret(account.refresh_token)

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
    cache: 'no-store',
  })

  const payload = await parseResponse<GoogleTokenResponse>(response, 'Failed to refresh Gmail access token')
  return payload.access_token
}

export async function fetchGmailProfile(accessToken: string) {
  return gmailApiRequest<{ emailAddress: string; historyId?: string }>(
    accessToken,
    '/users/me/profile'
  )
}

export async function getGmailAccount(
  supabase: any,
  userId: string,
  options: { tolerateMissingRelation?: boolean } = {}
) {
  try {
    const { data, error } = await supabase
      .from('gmail_accounts')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()

    if (error) throw error
    return (data || null) as GmailAccountRecord | null
  } catch (error) {
    if (options.tolerateMissingRelation && isMissingRelation(error)) return null
    throw error
  }
}

export function gmailStatus(account: GmailAccountRecord | null): GmailAccountStatus {
  if (!account) return { connected: false }

  return {
    connected: true,
    email: account.email,
    last_sync_at: account.last_sync_at || null,
    signature_readable: gmailAccountHasSignatureScope(account),
    needs_reconnect_for_signature: !gmailAccountHasSignatureScope(account),
  }
}

async function listMessages(accessToken: string, query: string, maxResults = 20) {
  const params = new URLSearchParams({
    q: query,
    maxResults: String(maxResults),
    includeSpamTrash: 'true',
  })

  return gmailApiRequest<{ messages?: GmailMessageRef[] }>(
    accessToken,
    `/users/me/messages?${params.toString()}`
  )
}

async function getMessage(accessToken: string, messageId: string) {
  return gmailApiRequest<GmailApiMessage>(
    accessToken,
    `/users/me/messages/${messageId}?format=full`
  )
}

function normalizeMessageRecord(
  account: GmailAccountRecord,
  message: GmailApiMessage,
  userId: string,
  contactId: string
) {
  const headers = message.payload?.headers || []
  const bodies = collectBodies(message.payload)
  const plain = bodies.plain.join('\n\n').trim()
  const html = bodies.html.join('\n\n').trim()
  const fromEmail = uniqueEmails([getHeader(headers, 'from')])[0] || null
  const toEmails = uniqueEmails([getHeader(headers, 'to')])
  const ccEmails = uniqueEmails([getHeader(headers, 'cc')])
  const accountEmail = normalizeEmail(account.email)
  const direction = normalizeEmail(fromEmail) === accountEmail ? 'outbound' : 'inbound'
  const subject = getHeader(headers, 'subject') || null

  return {
    user_id: userId,
    gmail_account_id: account.id,
    contact_id: contactId,
    gmail_message_id: message.id,
    gmail_thread_id: message.threadId || null,
    direction,
    subject,
    from_email: fromEmail,
    to_emails: toEmails,
    cc_emails: ccEmails,
    snippet: message.snippet || plain.slice(0, 220) || stripHtml(html).slice(0, 220) || null,
    body_text: plain || stripHtml(html) || null,
    body_html: html || null,
    sent_at: getMessageTimestamp(message, headers),
    synced_at: new Date().toISOString(),
  } satisfies Omit<GmailMessage, 'id' | 'created_at'>
}

async function updateAccountSyncMarker(supabase: any, accountId: string, historyId?: string) {
  await supabase
    .from('gmail_accounts')
    .update({
      history_id: historyId || null,
      last_sync_at: new Date().toISOString(),
    })
    .eq('id', accountId)
}

async function fetchKnownMessageIds(
  supabase: any,
  userId: string,
  contactId: string,
  messageIds: string[]
) {
  if (!messageIds.length) return new Set<string>()

  const { data, error } = await supabase
    .from('gmail_messages')
    .select('gmail_message_id')
    .eq('user_id', userId)
    .eq('contact_id', contactId)
    .in('gmail_message_id', messageIds)

  if (error) throw error
  return new Set((data || []).map((row: any) => String(row.gmail_message_id || '')).filter(Boolean))
}

async function handleInboundReplies(
  supabase: any,
  userId: string,
  contact: CRMContact,
  messages: Array<Omit<GmailMessage, 'id' | 'created_at'>>
) {
  const inboundMessages = messages
    .filter((message) => message.direction === 'inbound')
    .sort((left, right) => new Date(left.sent_at || 0).getTime() - new Date(right.sent_at || 0).getTime())
  if (!inboundMessages.length) return

  for (const message of inboundMessages) {
    const replyText = String(message.body_text || message.snippet || message.subject || 'Risposta email ricevuta').trim()
    if (!replyText) continue

    await logLeadActivity(supabase, userId, {
      leadId: contact.id,
      type: 'email_reply',
      content: replyText,
      metadata: {
        gmail_message_id: message.gmail_message_id,
        gmail_thread_id: message.gmail_thread_id,
        direction: message.direction,
        subject: message.subject,
        source: 'gmail_sync',
      },
    })
  }

  const latestMessage = inboundMessages[inboundMessages.length - 1]
  const latestReplyText = String(
    latestMessage.body_text || latestMessage.snippet || latestMessage.subject || 'Risposta email ricevuta'
  ).trim()
  if (!latestReplyText) return

  const outcome = await applyReplyOutcome(supabase, userId, contact.id, latestReplyText)
  const promoted = (contact.contact_scope || 'crm') === 'holding'

  if (promoted) {
    const promotedAt = new Date().toISOString()
    const { error: promotionError } = await supabase
      .from('contacts')
      .update({
        contact_scope: 'crm',
        promoted_at: promotedAt,
        updated_at: promotedAt,
      })
      .eq('user_id', userId)
      .eq('id', contact.id)

    if (promotionError) throw promotionError

    await createActivities(supabase, [
      {
        user_id: userId,
        contact_id: contact.id,
        type: 'system',
        content: 'Lead promosso automaticamente dalla lista separata dopo reply email.',
        metadata: {
          source: 'gmail_sync',
          gmail_message_id: latestMessage.gmail_message_id,
        },
      },
    ])
  }

  await logAiDecision(
    supabase,
    userId,
    'gmail_reply_sync',
    {
      gmail_message_id: latestMessage.gmail_message_id,
      subject: latestMessage.subject,
      promoted,
      inbound_messages_logged: inboundMessages.length,
    },
    {
      classification: outcome.classification,
      next_action: outcome.next_action,
      score: outcome.score,
    },
    contact.id
  )
}

async function refreshContactEmailSummary(supabase: any, contact: CRMContact, emails: Array<{ direction: string; subject?: string | null; sent_at?: string | null }>) {
  const latest = [...emails]
    .filter((item) => item.sent_at)
    .sort((left, right) => new Date(right.sent_at || 0).getTime() - new Date(left.sent_at || 0).getTime())[0]

  if (!latest?.sent_at) return

  const currentLastContact = contact.last_contact_at ? new Date(contact.last_contact_at).getTime() : 0
  const latestTimestamp = new Date(latest.sent_at).getTime()
  if (!Number.isFinite(latestTimestamp) || latestTimestamp <= currentLastContact) return

  const summaryPrefix = latest.direction === 'outbound' ? 'Email inviata' : 'Email ricevuta'
  const summary = `${summaryPrefix}: ${latest.subject || 'senza oggetto'}`

  const { error } = await supabase
    .from('contacts')
    .update({
      last_contact_at: latest.sent_at,
      last_activity_summary: summary,
      updated_at: new Date().toISOString(),
    })
    .eq('id', contact.id)
    .eq('user_id', contact.user_id)

  if (error) throw error
}

export async function syncContactGmailMessages(
  supabase: any,
  userId: string,
  contact: CRMContact,
  maxResults = 20
) {
  if (!contact.email) {
    return {
      account: null,
      messages: [] as GmailMessage[],
      synced: 0,
    }
  }

  const account = await getGmailAccount(supabase, userId)
  if (!account) {
    return {
      account: null,
      messages: [] as GmailMessage[],
      synced: 0,
    }
  }

  const accessToken = await refreshAccessToken(account)
  const gmailEmailQuery = `(from:"${contact.email}" OR to:"${contact.email}" OR cc:"${contact.email}" OR bcc:"${contact.email}") in:anywhere`
  const list = await listMessages(accessToken, gmailEmailQuery, maxResults)
  const fetchedMessages: GmailApiMessage[] = []

  for (const item of list.messages || []) {
    fetchedMessages.push(await getMessage(accessToken, item.id))
  }

  const normalized = fetchedMessages.map((message) =>
    normalizeMessageRecord(account, message, userId, contact.id)
  )

  let stored: GmailMessage[] = []
  if (normalized.length) {
    const knownMessageIds = await fetchKnownMessageIds(
      supabase,
      userId,
      contact.id,
      normalized.map((message) => message.gmail_message_id)
    )

    const { data, error } = await supabase
      .from('gmail_messages')
      .upsert(normalized, {
        onConflict: 'gmail_account_id,gmail_message_id',
      })
      .select('*')

    if (error) throw error
    stored = (data || []) as GmailMessage[]

    await handleInboundReplies(
      supabase,
      userId,
      contact,
      normalized.filter((message) => !knownMessageIds.has(message.gmail_message_id))
    )
  }

  const profile = await fetchGmailProfile(accessToken).catch(() => null)
  await updateAccountSyncMarker(supabase, account.id, profile?.historyId)
  await refreshContactEmailSummary(supabase, contact, normalized)

  return {
    account,
    messages: stored,
    synced: normalized.length,
  }
}

export async function sendContactEmail(
  supabase: any,
  userId: string,
  contact: CRMContact,
  input: {
    subject: string
    html: string
    text: string
    followupAt?: string | null
    appendSignature?: boolean
  }
) {
  if (!contact.email) {
    throw new Error('Il contatto non ha un indirizzo email')
  }

  const account = await getGmailAccount(supabase, userId)
  if (!account) {
    throw new Error('Gmail non collegato')
  }

  const accessToken = await refreshAccessToken(account)
  const signature = input.appendSignature === false ? null : await loadGmailSignatureForAccount(account)
  const signedInput = appendEmailSignature(
    { html: input.html, text: input.text },
    signature
  )
  const raw = encodeMessageBody(input.subject, contact.email, signedInput.html, signedInput.text)
  const effectiveFollowupAt = (contact.contact_scope || 'crm') === 'holding' ? null : (input.followupAt || null)

  const sendResult = await gmailApiRequest<{ id: string; threadId?: string }>(
    accessToken,
    '/users/me/messages/send',
    {
      method: 'POST',
      body: JSON.stringify({ raw }),
    }
  )

  const fullMessage = await getMessage(accessToken, sendResult.id)
  const normalized = normalizeMessageRecord(account, fullMessage, userId, contact.id)

  const { data: storedMessage, error: messageError } = await supabase
    .from('gmail_messages')
    .upsert(normalized, {
      onConflict: 'gmail_account_id,gmail_message_id',
    })
    .select('*')
    .single()

  if (messageError) throw messageError

  await createActivities(supabase, [
    {
      user_id: userId,
      contact_id: contact.id,
      type: 'email_sent',
      content: `Email inviata: ${input.subject}`,
      metadata: {
        source: 'gmail_send',
        gmail_message_id: normalized.gmail_message_id,
        gmail_thread_id: normalized.gmail_thread_id,
        subject: input.subject,
        to: contact.email,
      },
    },
  ])

  await updateContactSummary(supabase, contact.id, `Email inviata: ${input.subject}`, {
    nextFollowupAt: effectiveFollowupAt,
    touchLastContactAt: true,
  })

  if (effectiveFollowupAt) {
    await syncPendingCallTask(supabase, userId, contact.id, effectiveFollowupAt, {
      type: 'follow-up',
      priority: Number(contact.priority || 0) >= 3 ? 'high' : Number(contact.priority || 0) >= 2 ? 'medium' : 'low',
      note: `Follow-up dopo email: ${input.subject}`,
      overwriteNote: true,
    })
  }

  const { error: logError } = await supabase
    .from('email_logs')
    .insert({
      user_id: userId,
      to: contact.email,
      subject: input.subject,
      type: 'gmail',
      status: 'sent',
    })

  if (logError) {
    // Do not fail the send flow if the secondary log insert is unavailable.
  }

  const profile = await fetchGmailProfile(accessToken).catch(() => null)
  await updateAccountSyncMarker(supabase, account.id, profile?.historyId)

  return {
    account,
    message: storedMessage as GmailMessage,
  }
}

export async function createContactDraft(
  supabase: any,
  userId: string,
  contact: { email: string; name: string },
  input: { subject: string; html: string; text: string; appendSignature?: boolean }
): Promise<{ draftId: string } | null> {
  const account = await getGmailAccount(supabase, userId)
  if (!account) return null

  const accessToken = await refreshAccessToken(account)
  const signature = input.appendSignature === false ? null : await loadGmailSignatureForAccount(account)
  const signedInput = appendEmailSignature(
    { html: input.html, text: input.text },
    signature
  )
  const raw = encodeMessageBody(input.subject, contact.email, signedInput.html, signedInput.text)

  const result = await gmailApiRequest<{ id: string; message: { id: string } }>(
    accessToken,
    '/users/me/drafts',
    { method: 'POST', body: JSON.stringify({ message: { raw } }) }
  )

  return { draftId: result.id }
}
