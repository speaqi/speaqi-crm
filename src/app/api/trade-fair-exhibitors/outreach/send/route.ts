import { NextRequest } from 'next/server'
import { errorMessage } from '@/lib/server/http'
import { requireArea, requireRouteUser } from '@/lib/server/supabase'
import { getConnectedGmailAddress, sendPlainEmail } from '@/lib/server/gmail'
import { newNote, type FairExhibitor } from '@/lib/trade-fair'
import { DAILY_OUTREACH_CAP, outreachHasFooter, OutreachState } from '@/lib/trade-fair-outreach'

/**
 * Invio del mailing fiere dall'account Gmail collegato.
 *  - mode "test": manda fino a 3 email preparate al TUO indirizzo (oggetto [TEST]), niente cambia in CRM.
 *  - mode "send": manda le email selezionate agli espositori, con conferma esplicita, al massimo
 *    20 per richiesta e DAILY_OUTREACH_CAP al giorno. L'espositore passa a "Contattato" con follow-up.
 */

const MAX_PER_REQUEST = 20
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function dayOf(date: Date) {
  return date.toISOString().slice(0, 10)
}

export async function POST(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error
  const areaError = requireArea(auth, 'fiere')
  if (areaError) return areaError

  try {
    const body = await request.json().catch(() => ({}))
    const fair = String(body.fair || 'ttg-2026').trim().toLowerCase()
    const mode = body.mode === 'send' ? 'send' : 'test'
    const ids: string[] | null = Array.isArray(body.ids) ? body.ids.map(String) : null
    if (mode === 'send' && body.confirm !== true) {
      return Response.json({ error: 'Conferma esplicita mancante' }, { status: 400 })
    }

    const rows: FairExhibitor[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await auth.supabase
        .from('trade_fair_exhibitors').select('*')
        .eq('user_id', auth.workspaceUserId).eq('fair', fair)
        .order('id', { ascending: true }).range(from, from + 999)
      if (error) throw error
      rows.push(...((data || []) as FairExhibitor[]))
      if (!data || data.length < 1000) break
    }

    const prepared = rows
      .filter((row) => {
        const o = (row.outreach || {}) as OutreachState
        return Boolean(o.subject && o.body) && (!ids || ids.includes(row.id))
      })
      .sort((a, b) => (b.ttg_priority_score ?? b.score) - (a.ttg_priority_score ?? a.score))

    if (mode === 'test') {
      const me = await getConnectedGmailAddress(auth.supabase, auth.workspaceUserId)
      if (!me) return Response.json({ error: 'Gmail non collegato' }, { status: 409 })
      const picks = (ids ? prepared : prepared.filter((r) => (r.outreach as OutreachState).selected)).slice(0, 3)
      if (!picks.length) return Response.json({ error: 'Nessuna email preparata: premi prima «Prepara le email»' }, { status: 400 })
      let sent = 0
      for (const row of picks) {
        const o = row.outreach as OutreachState
        const text = `[ANTEPRIMA — in invio reale questa email andrebbe a ${row.email} (${row.name})]\n\n${o.body}`
        await sendPlainEmail(auth.supabase, auth.workspaceUserId, { to: me, subject: `[TEST] ${o.subject}`, text })
        await auth.supabase.from('trade_fair_exhibitors')
          .update({ outreach: { ...o, test_sent_at: new Date().toISOString() } })
          .eq('user_id', auth.workspaceUserId).eq('id', row.id)
        sent += 1
        await sleep(800)
      }
      return Response.json({ mode, sent, to: me })
    }

    // Invio reale
    const today = dayOf(new Date())
    const sentToday = rows.filter((row) => String((row.outreach as OutreachState)?.sent_at || '').startsWith(today)).length
    const room = Math.max(0, DAILY_OUTREACH_CAP - sentToday)
    const queue = prepared.filter((row) => {
      const o = row.outreach as OutreachState
      return o.selected && !o.sent_at && row.status === 'new' && Boolean(row.email) && !row.contact_id
    })
    const batch = queue.slice(0, Math.min(MAX_PER_REQUEST, room))
    if (!room) return Response.json({ error: `Tetto giornaliero raggiunto (${DAILY_OUTREACH_CAP}). Riprova domani.`, sent: 0 }, { status: 429 })
    if (!batch.length) return Response.json({ error: 'Nessuna email selezionata da inviare', sent: 0 }, { status: 400 })

    let sent = 0
    let failed = 0
    let consecutive = 0
    const errors: string[] = []
    for (const row of batch) {
      const o = row.outreach as OutreachState
      const now = new Date()
      try {
        if (!outreachHasFooter(o.body || '')) throw new Error('manca il footer Speaqi nel testo')
        const result = await sendPlainEmail(auth.supabase, auth.workspaceUserId, { to: row.email as string, subject: o.subject as string, text: o.body as string })
        const note = newNote(`Email inviata (mailing fiera): ${o.subject}`, now)
        const followup = new Date(now.getTime() + 4 * 24 * 3600 * 1000)
        const notes = Array.isArray(row.notes) ? row.notes : []
        await auth.supabase.from('trade_fair_exhibitors').update({
          status: 'contacted',
          contacted_at: row.contacted_at || now.toISOString(),
          next_followup_at: row.next_followup_at || dayOf(followup),
          notes: note ? [note, ...notes].slice(0, 200) : notes,
          outreach: { ...o, selected: false, sent_at: now.toISOString(), sent_to: row.email, message_id: result.message_id, error: null },
          updated_at: now.toISOString(),
        }).eq('user_id', auth.workspaceUserId).eq('id', row.id)
        sent += 1
        consecutive = 0
      } catch (error) {
        failed += 1
        consecutive += 1
        const message = errorMessage(error, 'Invio non riuscito')
        errors.push(`${row.name}: ${message}`)
        await auth.supabase.from('trade_fair_exhibitors')
          .update({ outreach: { ...o, error: message } })
          .eq('user_id', auth.workspaceUserId).eq('id', row.id)
        if (consecutive >= 3) break
      }
      await sleep(1200)
    }
    return Response.json({ mode, sent, failed, errors: errors.slice(0, 5), remaining_today: Math.max(0, room - sent), queued: queue.length - sent })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Impossibile inviare le email') }, { status: 500 })
  }
}
