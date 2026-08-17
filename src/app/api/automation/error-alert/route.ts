import { NextRequest } from 'next/server'
import { sendCustomEmail } from '@/lib/email'
import { validateAutomationSecret } from '@/lib/server/automation-auth'
import { errorMessage } from '@/lib/server/http'

function escapeHtml(value: unknown) {
  return String(value || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;')
}

export async function POST(request: NextRequest) {
  if (!validateAutomationSecret(request)) {
    return Response.json({ ok: false, error: 'Unauthorized automation' }, { status: 401 })
  }
  try {
    const body = await request.json().catch(() => ({}))
    const recipient = String(process.env.REMINDER_EMAIL || '').trim()
    if (!recipient) return Response.json({ ok: false, error: 'REMINDER_EMAIL not configured' }, { status: 503 })
    const workflow = String(body.workflow || 'Workflow sconosciuto').slice(0, 200)
    const rows = [
      ['Workflow', workflow], ['Execution', body.execution_id], ['Nodo', body.node],
      ['Errore', body.message], ['Timestamp', body.timestamp], ['URL', body.url],
    ]
    const html = `<h2>Errore automazione SPEAQI</h2><table>${rows.map(([label, value]) =>
      `<tr><th style="text-align:left;padding:4px 12px 4px 0">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`
    ).join('')}</table>`
    await sendCustomEmail(recipient, `SPEAQI automation failed: ${workflow}`, html)
    return Response.json({ ok: true })
  } catch (error) {
    return Response.json({ ok: false, error: errorMessage(error, 'Alert delivery failed') }, { status: 500 })
  }
}
