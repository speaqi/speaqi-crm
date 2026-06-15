import { NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/server/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// 1x1 fully transparent GIF.
const TRACKING_PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
)

// Some mail clients (notably Gmail) proxy and pre-fetch remote images shortly
// after delivery. Opens registered within this window are ignored to limit
// false positives from prefetching rather than a real human open.
const PREFETCH_GUARD_MS = 5_000

function pixelResponse() {
  return new Response(new Uint8Array(TRACKING_PIXEL), {
    status: 200,
    headers: {
      'Content-Type': 'image/gif',
      'Content-Length': String(TRACKING_PIXEL.length),
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
      Pragma: 'no-cache',
      Expires: '0',
    },
  })
}

async function recordOpen(token: string) {
  const supabase = createServiceRoleClient()

  const { data: message, error } = await supabase
    .from('gmail_messages')
    .select('id, user_id, contact_id, subject, sent_at, opened_at, open_count')
    .eq('tracking_token', token)
    .maybeSingle()

  if (error || !message) return

  const now = Date.now()
  const sentAt = message.sent_at ? new Date(message.sent_at).getTime() : 0
  if (sentAt && now - sentAt < PREFETCH_GUARD_MS) return

  const nowIso = new Date(now).toISOString()
  const isFirstOpen = !message.opened_at

  await supabase
    .from('gmail_messages')
    .update({
      open_count: Number(message.open_count || 0) + 1,
      last_opened_at: nowIso,
      opened_at: message.opened_at || nowIso,
    })
    .eq('id', message.id)

  if (!message.contact_id || !message.user_id) return

  const { data: contact } = await supabase
    .from('contacts')
    .select('email_open_count')
    .eq('id', message.contact_id)
    .maybeSingle()

  await supabase
    .from('contacts')
    .update({
      email_open_count: Number(contact?.email_open_count || 0) + 1,
      last_email_open_at: nowIso,
    })
    .eq('id', message.contact_id)

  // Log a single timeline entry on the first open to avoid flooding the
  // activity feed when the recipient re-opens the same email.
  if (isFirstOpen) {
    await supabase.from('activities').insert({
      user_id: message.user_id,
      contact_id: message.contact_id,
      type: 'email_open',
      content: `Email aperta dal destinatario: ${message.subject || 'senza oggetto'}`,
      metadata: {
        source: 'email_open_tracking',
        gmail_message_id: message.id,
        opened_at: nowIso,
      },
    })
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token: rawToken } = await params
    const token = String(rawToken || '')
      .replace(/\.(png|gif|jpe?g)$/i, '')
      .trim()
    if (token) {
      await recordOpen(token)
    }
  } catch {
    // Never let tracking failures prevent the pixel from rendering.
  }

  return pixelResponse()
}
