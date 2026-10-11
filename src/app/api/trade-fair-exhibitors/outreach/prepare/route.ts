import { NextRequest } from 'next/server'
import { errorMessage } from '@/lib/server/http'
import { requireArea, requireRouteUser } from '@/lib/server/supabase'
import type { FairExhibitor } from '@/lib/trade-fair'
import { buildOutreach, OutreachState, planOutreach } from '@/lib/trade-fair-outreach'

/**
 * Prepara l'email di ogni espositore in linea con Speaqi (tipologia, email, ancora da
 * contattare). Non invia nulla. Le email gia' riscritte a mano o gia' inviate non si toccano.
 * `dry_run` conta senza scrivere.
 */
export async function POST(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error
  const areaError = requireArea(auth, 'fiere')
  if (areaError) return areaError

  try {
    const body = await request.json().catch(() => ({}))
    const fair = String(body.fair || 'ttg-2026').trim().toLowerCase()
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(fair)) return Response.json({ error: 'Fiera non valida' }, { status: 400 })

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

    const plan = planOutreach(rows)
    const now = new Date().toISOString()
    const updates: Record<string, unknown>[] = []
    let skippedEdited = 0
    for (const { row, duplicate } of plan) {
      const current = (row.outreach || {}) as OutreachState
      if (current.sent_at || current.edited) {
        skippedEdited += 1
        continue
      }
      const built = buildOutreach(row)
      if (!built) continue
      const outreach: OutreachState = {
        ...current,
        selected: current.subject ? Boolean(current.selected) && !duplicate : !duplicate,
        subject: built.subject,
        body: built.body,
        template: built.template,
        lang: built.lang,
        generated_at: now,
        edited: false,
        note: duplicate ? 'Stessa email di un espositore più prioritario: non selezionata' : null,
        error: null,
      }
      updates.push({ ...row, outreach })
    }

    if (!body.dry_run) {
      for (let i = 0; i < updates.length; i += 200) {
        const { error } = await auth.supabase.from('trade_fair_exhibitors').upsert(updates.slice(i, i + 200), { onConflict: 'id' })
        if (error) throw error
      }
    }
    return Response.json({
      aligned: plan.length,
      prepared: updates.length,
      duplicates: plan.filter((p) => p.duplicate).length,
      kept_edited_or_sent: skippedEdited,
      dry_run: Boolean(body.dry_run),
    })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Impossibile preparare le email') }, { status: 500 })
  }
}
