import { NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/server/supabase'
import { errorMessage } from '@/lib/server/http'
import { runDatabaseBackup } from '@/lib/server/backup'
import { validateAutomationSecret } from '@/lib/server/automation-auth'

// Il dump viene costruito in memoria: niente cache, niente prerender.
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(request: NextRequest) {
  if (!validateAutomationSecret(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const keep = Number.isFinite(Number(body.keep)) ? Number(body.keep) : undefined
    const result = await runDatabaseBackup(createServiceRoleClient(), {
      keep,
      email: typeof body.email === 'string' ? body.email : undefined,
      // send_email:false serve per verificare dump e Storage senza spedire nulla.
      sendEmail: body.send_email === false ? false : undefined,
    })

    // Storage o email falliti non sono un successo: n8n deve poterlo vedere.
    const degraded =
      result.storage !== 'ok' ||
      !['ok', 'not_configured', 'disabled'].includes(result.email)

    return Response.json({ ok: !degraded, ...result }, { status: degraded ? 500 : 200 })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Backup non riuscito') }, { status: 500 })
  }
}
