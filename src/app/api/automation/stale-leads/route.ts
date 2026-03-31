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
    const requestedCategory = body.category ? String(body.category).trim() : ''
    const requestedSource = body.source ? String(body.source).trim() : ''
    const supabase = createServiceRoleClient()

    let query = supabase
      .from('contacts')
      .select('*')
      .eq('contact_scope', 'crm')
      .neq('status', 'Closed')
      .neq('status', 'Lost')
      .or(`last_contact_at.is.null,last_contact_at.lt.${cutoff}`)
      .order('updated_at', { ascending: true })

    if (requestedCategory) {
      query = query.eq('category', requestedCategory)
    }

    if (requestedSource) {
      query = query.eq('source', requestedSource)
    }

    const { data, error } = await query

    if (error) throw error

    const summaryByCategory = Object.entries(
      (data || []).reduce<Record<string, number>>((accumulator, contact: any) => {
        const key = contact.category || 'uncategorized'
        accumulator[key] = (accumulator[key] || 0) + 1
        return accumulator
      }, {})
    ).map(([category, count]) => ({ category, count }))

    return Response.json({
      stale_days: staleDays,
      category: requestedCategory || null,
      source: requestedSource || null,
      summary_by_category: summaryByCategory,
      stale_leads: data || [],
    })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to detect stale leads' },
      { status: 500 }
    )
  }
}
