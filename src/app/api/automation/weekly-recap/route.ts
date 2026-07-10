import { NextRequest } from 'next/server'
import { isClosedStatus } from '@/lib/data'
import { sendCustomEmail } from '@/lib/email'
import { applyPipelineScope } from '@/lib/server/scope-filters'
import { createServiceRoleClient } from '@/lib/server/supabase'

/**
 * Recap settimanale via email (lunedì mattina, chiamato da n8n):
 * - pipeline aperta per stadio con totali,
 * - trattative vinte/perse e stadi mossi negli ultimi 7 giorni,
 * - chiamate dei prossimi 14 giorni,
 * - contatti "da recuperare" (aperti senza prossimo passo).
 * Solo lettura + una email Resend: nessun task o stato viene modificato.
 */

function validateSecret(request: NextRequest) {
  const secret = process.env.AUTOMATION_SECRET
  return !!secret && request.headers.get('x-automation-secret') === secret
}

function euro(value: number) {
  return value.toLocaleString('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
}

function italianDate(value: string | Date) {
  return new Date(value).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' })
}

export async function POST(request: NextRequest) {
  if (!validateSecret(request)) {
    return Response.json({ error: 'Unauthorized automation' }, { status: 401 })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const recipientEmail = body.email || process.env.REMINDER_EMAIL
    if (!recipientEmail) {
      return Response.json({ error: 'No recipient email configured' }, { status: 400 })
    }
    const dryRun = body.dry_run === true

    const supabase = createServiceRoleClient()
    const now = new Date()
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const twoWeeksAhead = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString()

    const [contactsResult, transitionsResult, tasksResult] = await Promise.all([
      applyPipelineScope(
        supabase.from('contacts').select('id, name, status, value, priority, next_followup_at, last_contact_at')
      ).limit(5000),
      supabase
        .from('stage_transitions')
        .select('to_stage, from_stage, changed_at')
        .gte('changed_at', weekAgo)
        .limit(2000),
      supabase
        .from('tasks')
        .select('due_date, note, contact:contacts(name, contact_scope, hidden)')
        .eq('status', 'pending')
        .in('type', ['follow-up', 'call'])
        .gte('due_date', now.toISOString())
        .lt('due_date', twoWeeksAhead)
        .order('due_date', { ascending: true })
        .limit(200),
    ])

    if (contactsResult.error) throw contactsResult.error

    const contacts = contactsResult.data || []
    const openContacts = contacts.filter((contact: any) => !isClosedStatus(contact.status || ''))

    // Pipeline per stadio
    const byStage = new Map<string, { count: number; value: number }>()
    for (const contact of openContacts) {
      const entry = byStage.get(contact.status) || { count: 0, value: 0 }
      entry.count += 1
      entry.value += Number(contact.value || 0)
      byStage.set(contact.status, entry)
    }

    // Movimenti della settimana
    const transitions = transitionsResult.error ? [] : transitionsResult.data || []
    const wonThisWeek = transitions.filter((t: any) => ['closed', 'paid'].includes(String(t.to_stage || '').toLowerCase())).length
    const lostThisWeek = transitions.filter((t: any) => ['lost', 'not_interested'].includes(String(t.to_stage || '').toLowerCase())).length

    // Chiamate prossimi 14 giorni (solo contatti pipeline)
    const upcomingCalls = (tasksResult.error ? [] : tasksResult.data || []).filter((task: any) => {
      const contact = Array.isArray(task.contact) ? task.contact[0] : task.contact
      if (!contact) return false
      const scope = contact.contact_scope || 'crm'
      return scope === 'crm' && !contact.hidden
    })

    // Da recuperare: aperti senza prossimo passo (o con richiamo scaduto)
    const toRecover = openContacts.filter((contact: any) => {
      const followup = contact.next_followup_at ? new Date(contact.next_followup_at).getTime() : null
      return !followup || followup < now.getTime()
    })

    const totalOpenValue = openContacts.reduce((sum: number, c: any) => sum + Number(c.value || 0), 0)

    const stageRows = Array.from(byStage.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .map(
        ([stage, entry]) =>
          `<tr><td style="padding:6px 10px">${stage}</td><td style="padding:6px 10px;text-align:right">${entry.count}</td><td style="padding:6px 10px;text-align:right">${entry.value ? euro(entry.value) : '—'}</td></tr>`
      )
      .join('')

    const callRows = upcomingCalls
      .slice(0, 20)
      .map((task: any) => {
        const contact = Array.isArray(task.contact) ? task.contact[0] : task.contact
        return `<li style="margin-bottom:4px"><strong>${contact?.name || 'Contatto'}</strong> — ${italianDate(task.due_date)}${task.note ? ` · ${task.note}` : ''}</li>`
      })
      .join('')

    const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:640px;margin:0 auto">
        <div style="background:#16192e;padding:20px;border-radius:8px 8px 0 0">
          <h1 style="color:white;margin:0;font-size:20px">📊 Speaqi CRM — Recap settimanale</h1>
        </div>
        <div style="background:#ffffff;padding:24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;color:#374151">
          <p><strong>${openContacts.length}</strong> trattative aperte per un valore di <strong>${euro(totalOpenValue)}</strong>.
          Questa settimana: <strong style="color:#059669">${wonThisWeek} vinte</strong> · <strong style="color:#ef4444">${lostThisWeek} perse</strong> · ${transitions.length} movimenti di stadio.</p>

          <h2 style="font-size:15px;margin:18px 0 6px">Pipeline per stadio</h2>
          <table style="border-collapse:collapse;width:100%;font-size:13px;background:#f9fafb;border-radius:6px">
            ${stageRows || '<tr><td style="padding:6px 10px">Pipeline vuota</td></tr>'}
          </table>

          <h2 style="font-size:15px;margin:18px 0 6px">📞 Prossimi 14 giorni (${upcomingCalls.length} chiamate)</h2>
          <ul style="padding-left:18px;font-size:13px">${callRows || '<li>Nessuna chiamata pianificata: apri il CRM e riempi la settimana.</li>'}</ul>

          ${
            toRecover.length
              ? `<p style="background:#fef3c7;padding:10px 12px;border-radius:6px;font-size:13px">🛟 <strong>${toRecover.length} contatti da recuperare</strong> (aperti senza prossimo passo o con richiamo scaduto): trovali nella sezione "Da recuperare" della dashboard.</p>`
              : ''
          }
          <p style="color:#9ca3af;font-size:12px;margin-top:18px">Email automatica del lunedì · Speaqi CRM</p>
        </div>
      </div>
    `

    if (!dryRun) {
      await sendCustomEmail(
        recipientEmail,
        `📊 Recap settimanale — ${openContacts.length} trattative aperte, ${upcomingCalls.length} chiamate in agenda`,
        html
      )
    }

    return Response.json({
      success: true,
      dry_run: dryRun,
      open_contacts: openContacts.length,
      open_value: totalOpenValue,
      won_this_week: wonThisWeek,
      lost_this_week: lostThisWeek,
      upcoming_calls: upcomingCalls.length,
      to_recover: toRecover.length,
    })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Weekly recap failed' },
      { status: 500 }
    )
  }
}
