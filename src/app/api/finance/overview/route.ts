import { NextRequest } from 'next/server'
import { contactAssigneeMatchOrFilter } from '@/lib/server/collaborator-filters'
import { errorMessage } from '@/lib/server/http'
import { applyCrmScope } from '@/lib/server/scope-filters'
import { requireRouteUser } from '@/lib/server/supabase'

type QuoteRow = {
  id: string
  contact_id: string | null
  quote_number: string
  status: string
  customer_name: string | null
  customer_company: string | null
  items: unknown
  subtotal_amount: number | null
  discount_amount: number | null
  tax_amount: number | null
  total_amount: number | null
  payment_state: string | null
  valid_until: string | null
  sent_at: string | null
  accepted_at: string | null
  paid_at: string | null
  created_at: string
}

type ContactRow = {
  id: string
  name: string | null
  company: string | null
  status: string | null
  value: number | null
  score: number | null
  win_probability: number | null
  responsible: string | null
}

type GoalRow = {
  id: string
  period_type: 'annual' | 'quarterly' | 'monthly'
  period_start: string
  metric: string
  target_amount: number
  label: string | null
}

type Insight = {
  tone: 'positive' | 'warning' | 'critical' | 'info'
  title: string
  detail: string
}

function money(value: unknown) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function monthKey(iso: string) {
  return iso.slice(0, 7)
}

function isPaidQuote(quote: QuoteRow) {
  return quote.status === 'paid' || quote.payment_state === 'paid'
}

function isOpenQuote(quote: QuoteRow) {
  return (quote.status === 'sent' || quote.status === 'accepted' || quote.status === 'draft') && !isPaidQuote(quote)
}

function paidDate(quote: QuoteRow) {
  return quote.paid_at || quote.accepted_at || quote.created_at
}

function daysBetween(fromIso: string | null, toMs: number) {
  if (!fromIso) return null
  const from = new Date(fromIso).getTime()
  if (Number.isNaN(from)) return null
  return Math.floor((toMs - from) / 86400000)
}

const STAGE_PROBABILITY: Record<string, number> = {
  new: 0.05,
  contacted: 0.1,
  replied: 0.2,
  interested: 0.25,
  waiting: 0.15,
  supertop: 0.4,
  'call booked': 0.5,
  call_booked: 0.5,
  quote: 0.6,
  preventivo: 0.6,
}

function stageProbability(status: string | null | undefined) {
  const normalized = String(status || '').trim().toLowerCase()
  return STAGE_PROBABILITY[normalized] ?? 0.1
}

function quoteProbability(quote: QuoteRow, contact: ContactRow | undefined, nowMs: number) {
  if (quote.status === 'accepted') return 0.9
  let probability = quote.status === 'draft' ? 0.1 : 0.35
  if (contact) {
    if (contact.win_probability != null && Number.isFinite(Number(contact.win_probability))) {
      probability = Math.max(probability, Number(contact.win_probability) / 100)
    }
    const score = money(contact.score)
    if (score > 0) probability += Math.min(score / 400, 0.25)
  }
  const ageDays = daysBetween(quote.sent_at || quote.created_at, nowMs)
  if (ageDays != null) {
    if (ageDays > 60) probability *= 0.35
    else if (ageDays > 30) probability *= 0.6
  }
  if (quote.valid_until && new Date(quote.valid_until).getTime() < nowMs) {
    probability *= 0.5
  }
  return Math.min(Math.max(probability, 0.02), 0.95)
}

const CATEGORY_KEYWORDS: Array<{ category: string; pattern: RegExp }> = [
  { category: 'SIGNATURE', pattern: /signature/i },
  { category: 'EXPERIENCE', pattern: /experience/i },
  { category: 'START', pattern: /start/i },
]

function itemCategory(description: string) {
  for (const entry of CATEGORY_KEYWORDS) {
    if (entry.pattern.test(description)) return entry.category
  }
  return 'Altro'
}

type QuoteLineItemLike = { description?: unknown; quantity?: unknown; unit_price?: unknown; total?: unknown }

function quoteItems(quote: QuoteRow): QuoteLineItemLike[] {
  return Array.isArray(quote.items) ? (quote.items as QuoteLineItemLike[]) : []
}

function goalPeriodEnd(goal: GoalRow) {
  const start = new Date(`${goal.period_start}T00:00:00Z`)
  const end = new Date(start)
  if (goal.period_type === 'annual') end.setUTCFullYear(end.getUTCFullYear() + 1)
  else if (goal.period_type === 'quarterly') end.setUTCMonth(end.getUTCMonth() + 3)
  else end.setUTCMonth(end.getUTCMonth() + 1)
  return end
}

export async function GET(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    let contactsQuery = applyCrmScope(
      auth.supabase
        .from('contacts')
        .select('id, name, company, status, value, score, win_probability, responsible')
        .eq('user_id', auth.workspaceUserId)
    ).limit(5000)

    if (!auth.isAdmin) {
      const assigneeOr = contactAssigneeMatchOrFilter(auth.memberName)
      if (assigneeOr) contactsQuery = contactsQuery.or(assigneeOr)
      else contactsQuery = contactsQuery.eq('responsible', '__no_member__')
    }

    const [quotesResult, contactsResult, goalsResult] = await Promise.all([
      auth.supabase
        .from('quotes')
        .select(
          'id, contact_id, quote_number, status, customer_name, customer_company, items, subtotal_amount, discount_amount, tax_amount, total_amount, payment_state, valid_until, sent_at, accepted_at, paid_at, created_at'
        )
        .eq('user_id', auth.workspaceUserId)
        .order('created_at', { ascending: false })
        .limit(5000),
      contactsQuery,
      auth.supabase
        .from('business_goals')
        .select('id, period_type, period_start, metric, target_amount, label')
        .eq('user_id', auth.workspaceUserId)
        .order('period_start', { ascending: false })
        .limit(200),
    ])

    if (quotesResult.error) throw quotesResult.error
    if (contactsResult.error) throw contactsResult.error
    // business_goals may not exist yet if the migration has not been applied
    const goals: GoalRow[] = goalsResult.error ? [] : ((goalsResult.data as GoalRow[]) ?? [])

    const quotes = (quotesResult.data as QuoteRow[]) ?? []
    const contacts = (contactsResult.data as ContactRow[]) ?? []
    const contactById = new Map(contacts.map((contact) => [contact.id, contact]))

    const nowMs = Date.now()
    const now = new Date()

    // ── Ricavi realizzati e confermati ──
    const paidQuotes = quotes.filter(isPaidQuote)
    const acceptedUnpaid = quotes.filter((quote) => quote.status === 'accepted' && !isPaidQuote(quote))
    const sentQuotes = quotes.filter((quote) => quote.status === 'sent' && !isPaidQuote(quote))
    const draftQuotes = quotes.filter((quote) => quote.status === 'draft' && !isPaidQuote(quote))
    const cancelledQuotes = quotes.filter((quote) => quote.status === 'cancelled')

    const paidRevenue = paidQuotes.reduce((sum, quote) => sum + money(quote.total_amount), 0)
    const paidRevenueNet = paidQuotes.reduce(
      (sum, quote) => sum + money(quote.total_amount) - money(quote.tax_amount),
      0
    )
    const confirmedRevenue = acceptedUnpaid.reduce((sum, quote) => sum + money(quote.total_amount), 0)
    const openQuotesValue = [...sentQuotes, ...acceptedUnpaid].reduce(
      (sum, quote) => sum + money(quote.total_amount),
      0
    )

    // ── Serie mensile (ultimi 12 mesi) ──
    const monthlyMap = new Map<string, { month: string; paid: number; confirmed: number; sent: number }>()
    for (let i = 11; i >= 0; i--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
      const key = d.toISOString().slice(0, 7)
      monthlyMap.set(key, { month: key, paid: 0, confirmed: 0, sent: 0 })
    }
    for (const quote of paidQuotes) {
      const bucket = monthlyMap.get(monthKey(paidDate(quote)))
      if (bucket) bucket.paid += money(quote.total_amount)
    }
    for (const quote of acceptedUnpaid) {
      const bucket = monthlyMap.get(monthKey(quote.accepted_at || quote.created_at))
      if (bucket) bucket.confirmed += money(quote.total_amount)
    }
    for (const quote of sentQuotes) {
      const bucket = monthlyMap.get(monthKey(quote.sent_at || quote.created_at))
      if (bucket) bucket.sent += money(quote.total_amount)
    }
    const monthly = Array.from(monthlyMap.values())

    const currentMonthKey = now.toISOString().slice(0, 7)
    const currentYearPrefix = now.toISOString().slice(0, 4)
    const mtdRevenue = paidQuotes
      .filter((quote) => monthKey(paidDate(quote)) === currentMonthKey)
      .reduce((sum, quote) => sum + money(quote.total_amount), 0)
    const ytdRevenue = paidQuotes
      .filter((quote) => paidDate(quote).startsWith(currentYearPrefix))
      .reduce((sum, quote) => sum + money(quote.total_amount), 0)

    // Run-rate: media degli ultimi 3 mesi pagati (proxy MRR in assenza di abbonamenti ricorrenti)
    const lastThreeMonths = monthly.slice(-3)
    const runRateMonthly = lastThreeMonths.reduce((sum, row) => sum + row.paid, 0) / Math.max(lastThreeMonths.length, 1)
    const runRateAnnual = runRateMonthly * 12

    // ── Previsione 30 giorni e scoring opportunità ──
    const opportunities = [...sentQuotes, ...acceptedUnpaid]
      .map((quote) => {
        const contact = quote.contact_id ? contactById.get(quote.contact_id) : undefined
        const probability = quoteProbability(quote, contact, nowMs)
        const total = money(quote.total_amount)
        return {
          id: quote.id,
          quote_number: quote.quote_number,
          customer: quote.customer_company || quote.customer_name || 'Cliente',
          contact_id: quote.contact_id,
          status: quote.status,
          total,
          probability: Math.round(probability * 100) / 100,
          expectedValue: Math.round(total * probability * 100) / 100,
          ageDays: daysBetween(quote.sent_at || quote.created_at, nowMs) ?? 0,
        }
      })
      .sort((left, right) => right.expectedValue - left.expectedValue)

    const expectedRevenue30d = opportunities.reduce((sum, opportunity) => sum + opportunity.expectedValue, 0)

    // ── Pipeline contatti (valore stimato trattative) ──
    let pipelineValue = 0
    let weightedPipelineValue = 0
    for (const contact of contacts) {
      const normalized = String(contact.status || '').trim().toLowerCase()
      const isClosed = ['closed', 'paid', 'lost', 'not_interested', 'chiuso', 'pagato', 'perso'].includes(normalized)
      const value = money(contact.value)
      if (isClosed || value <= 0) continue
      pipelineValue += value
      const probability =
        contact.win_probability != null && Number.isFinite(Number(contact.win_probability))
          ? Number(contact.win_probability) / 100
          : stageProbability(contact.status)
      weightedPipelineValue += value * probability
    }

    // ── Ricavi per categoria (da line items dei preventivi pagati) ──
    const categoryMap = new Map<string, { category: string; amount: number; count: number }>()
    for (const quote of paidQuotes) {
      const items = quoteItems(quote)
      if (items.length === 0) {
        const bucket = categoryMap.get('Altro') ?? { category: 'Altro', amount: 0, count: 0 }
        bucket.amount += money(quote.total_amount)
        bucket.count += 1
        categoryMap.set('Altro', bucket)
        continue
      }
      for (const item of items) {
        const description = String(item?.description || '')
        const category = itemCategory(description)
        const lineTotal = money(item?.total ?? money(item?.quantity) * money(item?.unit_price))
        const bucket = categoryMap.get(category) ?? { category, amount: 0, count: 0 }
        bucket.amount += lineTotal
        bucket.count += 1
        categoryMap.set(category, bucket)
      }
    }
    const byCategory = Array.from(categoryMap.values()).sort((left, right) => right.amount - left.amount)

    // ── Top clienti per fatturato ──
    const clientMap = new Map<string, { name: string; contact_id: string | null; amount: number; quotes: number }>()
    for (const quote of paidQuotes) {
      const key = quote.contact_id || (quote.customer_company || quote.customer_name || 'Cliente').toLowerCase()
      const bucket = clientMap.get(key) ?? {
        name: quote.customer_company || quote.customer_name || 'Cliente',
        contact_id: quote.contact_id,
        amount: 0,
        quotes: 0,
      }
      bucket.amount += money(quote.total_amount)
      bucket.quotes += 1
      clientMap.set(key, bucket)
    }
    const topClients = Array.from(clientMap.values())
      .sort((left, right) => right.amount - left.amount)
      .slice(0, 8)

    // ── KPI ──
    const decidedCount = paidQuotes.length + cancelledQuotes.length
    const winRate = decidedCount > 0 ? paidQuotes.length / decidedCount : 0
    const payingClients = clientMap.size
    const avgDealValue = paidQuotes.length > 0 ? paidRevenue / paidQuotes.length : 0
    const avgRevenuePerClient = payingClients > 0 ? paidRevenue / payingClients : 0
    const paymentDays = paidQuotes
      .map((quote) => (quote.paid_at && quote.sent_at ? daysBetween(quote.sent_at, new Date(quote.paid_at).getTime()) : null))
      .filter((days): days is number => days != null && days >= 0)
    const avgDaysToPay = paymentDays.length > 0 ? paymentDays.reduce((sum, days) => sum + days, 0) / paymentDays.length : null

    // ── Obiettivi con avanzamento ──
    const goalsWithProgress = goals.map((goal) => {
      const startMs = new Date(`${goal.period_start}T00:00:00Z`).getTime()
      const endMs = goalPeriodEnd(goal).getTime()
      let current = 0
      if (goal.metric === 'revenue' || goal.metric === 'paid_revenue') {
        current = paidQuotes
          .filter((quote) => {
            const ms = new Date(paidDate(quote)).getTime()
            return ms >= startMs && ms < endMs
          })
          .reduce((sum, quote) => sum + money(quote.total_amount), 0)
      } else if (goal.metric === 'new_clients') {
        const ids = new Set<string>()
        for (const quote of paidQuotes) {
          const ms = new Date(paidDate(quote)).getTime()
          if (ms >= startMs && ms < endMs) {
            ids.add(quote.contact_id || (quote.customer_company || quote.customer_name || '').toLowerCase())
          }
        }
        current = ids.size
      } else if (goal.metric === 'quotes_sent') {
        current = quotes.filter((quote) => {
          const sent = quote.sent_at ? new Date(quote.sent_at).getTime() : null
          return sent != null && sent >= startMs && sent < endMs
        }).length
      }
      const target = money(goal.target_amount)
      const progress = target > 0 ? current / target : 0
      const elapsed = Math.min(Math.max((nowMs - startMs) / (endMs - startMs), 0), 1)
      const atRisk = elapsed > 0.15 && progress < elapsed * 0.75 && progress < 1
      return {
        ...goal,
        target_amount: target,
        current: Math.round(current * 100) / 100,
        progress: Math.round(progress * 1000) / 1000,
        expectedProgress: Math.round(elapsed * 1000) / 1000,
        active: nowMs >= startMs && nowMs < endMs,
        atRisk,
      }
    })

    // ── Insight automatici (regole, non LLM) ──
    const insights: Insight[] = []
    const prevMonth = monthly[monthly.length - 2]
    const thisMonth = monthly[monthly.length - 1]
    if (prevMonth && thisMonth && prevMonth.paid > 0) {
      const delta = (thisMonth.paid - prevMonth.paid) / prevMonth.paid
      if (delta >= 0.1) {
        insights.push({
          tone: 'positive',
          title: 'Fatturato in crescita',
          detail: `Il mese corrente è a +${Math.round(delta * 100)}% rispetto al mese scorso (incassato finora).`,
        })
      } else if (delta <= -0.25) {
        insights.push({
          tone: 'warning',
          title: 'Fatturato in calo rispetto al mese scorso',
          detail: `Incassato finora ${Math.round(Math.abs(delta) * 100)}% in meno del mese precedente: spingi sui preventivi aperti.`,
        })
      }
    }
    const staleQuotes = sentQuotes.filter((quote) => (daysBetween(quote.sent_at || quote.created_at, nowMs) ?? 0) > 30)
    if (staleQuotes.length > 0) {
      const value = staleQuotes.reduce((sum, quote) => sum + money(quote.total_amount), 0)
      insights.push({
        tone: 'warning',
        title: `${staleQuotes.length} preventivi inviati da oltre 30 giorni`,
        detail: `Valore bloccato: €${Math.round(value).toLocaleString('it-IT')}. Un follow-up mirato può sbloccarli o liberare la pipeline.`,
      })
    }
    if (acceptedUnpaid.length > 0) {
      insights.push({
        tone: 'info',
        title: `${acceptedUnpaid.length} preventivi accettati in attesa di pagamento`,
        detail: `Entrate confermate per €${Math.round(confirmedRevenue).toLocaleString('it-IT')}: sollecita il saldo per trasformarle in cassa.`,
      })
    }
    const topClient = topClients[0]
    if (topClient && paidRevenue > 0 && topClient.amount / paidRevenue > 0.4) {
      insights.push({
        tone: 'critical',
        title: 'Concentrazione del fatturato',
        detail: `${topClient.name} vale il ${Math.round((topClient.amount / paidRevenue) * 100)}% dei ricavi: diversifica per ridurre il rischio.`,
      })
    }
    if (decidedCount >= 5) {
      if (winRate >= 0.5) {
        insights.push({
          tone: 'positive',
          title: `Win rate al ${Math.round(winRate * 100)}%`,
          detail: 'Ottimo tasso di chiusura: c\'è spazio per alzare i prezzi o spingere pacchetti superiori.',
        })
      } else if (winRate < 0.25) {
        insights.push({
          tone: 'warning',
          title: `Win rate al ${Math.round(winRate * 100)}%`,
          detail: 'Molti preventivi non si chiudono: rivedi qualifica dei lead, pricing o tempi di follow-up.',
        })
      }
    }
    const activeRevenueGoal = goalsWithProgress.find((goal) => goal.active && (goal.metric === 'revenue' || goal.metric === 'paid_revenue'))
    if (activeRevenueGoal) {
      const gap = activeRevenueGoal.target_amount - activeRevenueGoal.current
      if (gap > 0 && expectedRevenue30d + confirmedRevenue < gap && activeRevenueGoal.period_type === 'monthly') {
        insights.push({
          tone: 'critical',
          title: 'Pipeline insufficiente per l\'obiettivo del mese',
          detail: `Mancano €${Math.round(gap).toLocaleString('it-IT')} ma il valore atteso dei preventivi aperti è €${Math.round(expectedRevenue30d).toLocaleString('it-IT')}: servono nuove opportunità.`,
        })
      } else if (activeRevenueGoal.progress >= 1) {
        insights.push({
          tone: 'positive',
          title: 'Obiettivo raggiunto',
          detail: `Hai già superato l'obiettivo ${activeRevenueGoal.label || activeRevenueGoal.period_type}: valuta di alzare il target.`,
        })
      }
    }
    if (draftQuotes.length >= 3) {
      insights.push({
        tone: 'info',
        title: `${draftQuotes.length} preventivi in bozza`,
        detail: 'Bozze non inviate non generano fatturato: completale o eliminale.',
      })
    }

    return Response.json({
      summary: {
        paidRevenue,
        paidRevenueNet,
        confirmedRevenue,
        openQuotesValue,
        expectedRevenue30d: Math.round(expectedRevenue30d * 100) / 100,
        pipelineValue,
        weightedPipelineValue: Math.round(weightedPipelineValue * 100) / 100,
        mtdRevenue,
        ytdRevenue,
        runRateMonthly: Math.round(runRateMonthly * 100) / 100,
        runRateAnnual: Math.round(runRateAnnual * 100) / 100,
        avgDealValue: Math.round(avgDealValue * 100) / 100,
        avgRevenuePerClient: Math.round(avgRevenuePerClient * 100) / 100,
        avgDaysToPay: avgDaysToPay != null ? Math.round(avgDaysToPay) : null,
        winRate: Math.round(winRate * 1000) / 1000,
        payingClients,
        quoteCounts: {
          draft: draftQuotes.length,
          sent: sentQuotes.length,
          accepted: acceptedUnpaid.length,
          paid: paidQuotes.length,
          cancelled: cancelledQuotes.length,
        },
      },
      monthly,
      byCategory,
      topClients,
      opportunities: opportunities.slice(0, 20),
      goals: goalsWithProgress,
      insights,
    })
  } catch (error) {
    return Response.json({ error: errorMessage(error, 'Failed to load finance overview') }, { status: 500 })
  }
}
