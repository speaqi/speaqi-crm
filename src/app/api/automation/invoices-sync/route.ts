import { NextRequest } from 'next/server'
import { validateAutomationSecret } from '@/lib/server/automation-auth'
import { errorMessage } from '@/lib/server/http'
import { syncInvoiceStatuses } from '@/lib/server/invoices'
import { createServiceRoleClient } from '@/lib/server/supabase'

/** Stato SDI delle fatture inviate: consegnata, scartata, non consegnata. Lo lancia il pianificatore. */
export async function POST(request: NextRequest) {
  if (!validateAutomationSecret(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const body = await request.json().catch(() => ({}))
    const limit = Math.min(15, Math.max(1, Number(body.limit) || 8))
    const result = await syncInvoiceStatuses(createServiceRoleClient(), limit)
    return Response.json(result)
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Sincronizzazione fatture non riuscita') }, { status: 500 })
  }
}
