import { NextRequest } from 'next/server'
import { agencyRoute, signedUrls } from '@/lib/server/agency'
import { createServiceRoleClient } from '@/lib/server/supabase'
import type { AgencyAsset } from '@/lib/server/agency-assets'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Archivio: i materiali caricati in tutte le opportunità e le presentazioni prodotte. */
export async function GET(request: NextRequest) {
  return agencyRoute(request, async (auth) => {
    const [projects, presentations] = await Promise.all([
      auth.supabase.from('agency_projects').select('id,title,client_name,assets').eq('user_id', auth.user.id).order('updated_at', { ascending: false }).limit(500),
      auth.supabase.from('agency_presentations').select('id,project_id,title,status,version,updated_at,approved_at,public_token').eq('user_id', auth.user.id).order('updated_at', { ascending: false }).limit(500)
    ])
    if (projects.error) throw projects.error
    if (presentations.error) throw presentations.error
    const all = (projects.data || []).flatMap((p: any) => ((p.assets || []) as AgencyAsset[]).map((a) => ({ asset: a, project: p })))
    const urls = await signedUrls(createServiceRoleClient(), all.map((x) => x.asset))
    return {
      assets: all
        .map(({ asset: { path: _path, ...a }, project }) => ({ ...a, url: urls.get(a.id) || null, project_id: project.id, project_title: project.title, client_name: project.client_name }))
        .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))),
      presentations: (presentations.data || []).map((p: any) => {
        const project = (projects.data || []).find((x: any) => x.id === p.project_id) as { title: string } | undefined
        return { ...p, project: project ? { title: project.title } : null }
      })
    }
  })
}
