import { NextRequest } from 'next/server'
import { sendContactEmail, simpleTextToHtml } from '@/lib/server/gmail'
import { requireRouteUser } from '@/lib/server/supabase'

type RouteContext = {
  params: Promise<{ id: string }>
}

async function getContact(supabase: any, userId: string, id: string) {
  const { data, error } = await supabase
    .from('contacts')
    .select('*')
    .eq('user_id', userId)
    .eq('id', id)
    .single()

  if (error) throw error
  return data
}

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const { id } = await context.params
    const body = await request.json()
    const subject = String(body.subject || '').trim()
    const text = String(body.body || '').trim()
    const followupAt = body.followup_at ? String(body.followup_at) : null

    if (!subject) {
      return Response.json({ error: 'Oggetto email obbligatorio' }, { status: 400 })
    }

    if (!text) {
      return Response.json({ error: 'Corpo email obbligatorio' }, { status: 400 })
    }

    const contact = await getContact(auth.supabase, auth.user.id, id)
    const result = await sendContactEmail(auth.supabase, auth.user.id, contact, {
      subject,
      text,
      html: simpleTextToHtml(text),
      followupAt,
    })

    return Response.json({
      message: result.message,
      gmail: {
        connected: true,
        email: result.account.email,
      },
    })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to send Gmail email' },
      { status: 500 }
    )
  }
}
