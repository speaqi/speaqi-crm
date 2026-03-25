import { NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/server/supabase'

function validateSecret(request: NextRequest) {
  const secret = process.env.AUTOMATION_SECRET
  return !!secret && request.headers.get('x-automation-secret') === secret
}

export async function POST(request: NextRequest) {
  if (!validateSecret(request)) {
    return Response.json({ error: 'Unauthorized automation' }, { status: 401 })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const staleDays = Math.max(1, Number(body.stale_days || 5))
    const cutoff = new Date(Date.now() - staleDays * 24 * 60 * 60 * 1000).toISOString()
    const supabase = createServiceRoleClient()

    const { data, error } = await supabase
      .from('contacts')
      .select('*')
      .neq('status', 'Closed')
      .or(`last_contact_at.is.null,last_contact_at.lt.${cutoff}`)
      .order('updated_at', { ascending: true })

    if (error) throw error

    return Response.json({
      stale_days: staleDays,
      stale_leads: data || [],
    })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to detect stale leads' },
      { status: 500 }
    )
  }
}
