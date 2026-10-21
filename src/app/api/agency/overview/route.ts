import { NextRequest } from 'next/server'
import { agencyRoute, getSettings, listCategories } from '@/lib/server/agency'
import { countTodo, normalizeSlides } from '@/lib/agency'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Cruscotto: opportunità, presentazioni e preventivi Agency in una lettura sola. */
export async function GET(request: NextRequest) {
  return agencyRoute(request, async (auth) => {
    const sb = auth.supabase
    const uid = auth.user.id
    const [projects, presentations, quotes, categories, settings] = await Promise.all([
      sb.from('agency_projects').select('id,title,client_name,contact_id,stage,services,updated_at,created_at,assets').eq('user_id', uid).order('updated_at', { ascending: false }).limit(500),
      sb.from('agency_presentations').select('id,project_id,title,status,slides,quote_id,updated_at,approved_at').eq('user_id', uid).order('updated_at', { ascending: false }).limit(500),
      sb.from('quotes').select('id,agency_project_id,quote_number,title,status,total_amount,currency,created_at,updated_at').eq('user_id', uid).not('agency_project_id', 'is', null).order('created_at', { ascending: false }).limit(500),
      listCategories(sb, uid),
      getSettings(sb, uid)
    ])
    for (const r of [projects, presentations, quotes]) if (r.error) throw r.error
    const pres = (presentations.data || []) as any[]
    const qs = (quotes.data || []) as any[]
    return {
      settings,
      categories,
      projects: (projects.data || []).map(({ assets, ...p }: any) => {
        const mine = qs.filter((q) => q.agency_project_id === p.id && q.status !== 'cancelled')
        return {
          ...p,
          documents: (assets || []).length,
          presentations: pres.filter((x) => x.project_id === p.id).length,
          approved: pres.filter((x) => x.project_id === p.id && x.status === 'approved').length,
          quotes: mine.length,
          // Il valore dell'opportunità è quello del preventivo più recente: mai una cifra scritta a parte.
          value: mine[0] ? Number(mine[0].total_amount) : null,
          currency: mine[0]?.currency || 'EUR'
        }
      }),
      presentations: pres.map(({ slides, ...p }) => ({ ...p, slide_count: (slides || []).length, todo: countTodo(normalizeSlides(slides), { hasQuote: Boolean(p.quote_id) }) })),
      quotes: qs
    }
  })
}
