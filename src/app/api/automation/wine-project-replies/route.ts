import { NextRequest } from 'next/server'
import { validateAutomationSecret } from '@/lib/server/automation-auth'
import { syncContactGmailMessages } from '@/lib/server/gmail'
import { errorMessage } from '@/lib/server/http'
import { createServiceRoleClient } from '@/lib/server/supabase'

export async function POST(request: NextRequest) {
  if (!validateAutomationSecret(request)) return Response.json({ error: 'Unauthorized automation' }, { status: 401 })
  try {
    const supabase = createServiceRoleClient()
    const { data: contacts, error } = await supabase
      .from('contacts')
      .select('*')
      .eq('event_tag', 'wine-project')
      .is('email_unsubscribed_at', null)
      .not('status', 'in', '(Closed,Paid,Lost)')
      .not('email', 'is', null)
      .limit(100)
    if (error) throw error
    let synced = 0
    let failures = 0
    for (const contact of contacts || []) {
      try {
        const result = await syncContactGmailMessages(supabase, contact.user_id, contact, 20)
        synced += result.synced
      } catch {
        failures += 1
      }
    }
    return Response.json({ ok: failures === 0, checked: contacts?.length || 0, messages_synced: synced, failures })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Wine Project reply sync failed') }, { status: 500 })
  }
}
