import { NextRequest } from 'next/server'
import {
  AgencyInputError,
  addProjectAssets,
  agencyBody,
  agencyRoute,
  claimGeneration,
  createPresentation,
  createProject,
  deleteProject,
  importWebsite,
  inBackground,
  readFiles,
  runGeneration,
  type ProjectRow
} from '@/lib/server/agency'
import { MAX_AGENCY_REQUEST_BYTES } from '@/lib/server/agency-assets'
import { createServiceRoleClient } from '@/lib/server/supabase'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 90

export async function GET(request: NextRequest) {
  return agencyRoute(request, async (auth) => {
    const contact = request.nextUrl.searchParams.get('contact_id')
    let query = auth.supabase
      .from('agency_projects')
      .select('id,title,client_name,contact_id,stage,services,updated_at')
      .eq('user_id', auth.user.id)
      .order('updated_at', { ascending: false })
      .limit(500)
    if (contact) query = query.eq('contact_id', contact)
    const { data, error } = await query
    if (error) throw error
    return { projects: data || [] }
  })
}

/**
 * Da brief a presentazione in un gesto: cliente, brief, file, sito. Si crea l'opportunità,
 * si salvano i materiali, si legge il sito e si avvia l'agente (che lavora dopo la risposta).
 * Accetta JSON o multipart (con i file).
 */
export async function POST(request: NextRequest) {
  return agencyRoute(request, async (auth) => {
    const service = createServiceRoleClient()
    const multipart = (request.headers.get('content-type') || '').startsWith('multipart/')
    let fields: Record<string, unknown>
    let files: Awaited<ReturnType<typeof readFiles>>['files'] = []
    if (multipart) {
      const read = await readFiles(request, MAX_AGENCY_REQUEST_BYTES)
      files = read.files
      const f = read.form
      fields = {
        contact_id: f.get('contact_id'),
        title: f.get('title'),
        brief: f.get('brief'),
        website_url: f.get('website_url'),
        services: f.getAll('services'),
        generate: f.get('generate'),
        language: f.get('language'),
        instruction: f.get('instruction')
      }
    } else {
      fields = await agencyBody(request)
    }
    let project: ProjectRow | null = null
    try {
      project = await createProject(auth.supabase, auth.user.id, fields)
      if (files.length) await addProjectAssets(auth.supabase, service, project, files)
    } catch (error) {
      // Un file non valido non lascia un'opportunità a metà.
      if (project) await deleteProject(auth.supabase, service, project).catch(() => undefined)
      throw error
    }
    const warnings: string[] = []
    const url = typeof fields.website_url === 'string' ? fields.website_url.trim() : ''
    if (url) {
      try {
        const site = await importWebsite(auth.supabase, service, project, url)
        if (site.truncated) warnings.push('Il testo del sito è lungo: l’agente ne legge la prima parte.')
      } catch (error) {
        warnings.push(error instanceof AgencyInputError ? error.message : 'Sito non letto')
      }
    }
    const presentation = await createPresentation(auth.supabase, project, { language: fields.language, instruction: fields.instruction })
    let status = presentation.status
    if (fields.generate !== '0' && fields.generate !== false) {
      const claimed = await claimGeneration(auth.supabase, presentation)
      status = claimed.status
      inBackground('generazione', () => runGeneration(auth.supabase, service, claimed))
    }
    return Response.json({ project_id: project.id, presentation_id: presentation.id, status, warnings }, { status: 201, headers: { 'Cache-Control': 'private, no-store' } })
  })
}
