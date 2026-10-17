import { NextRequest } from 'next/server'
import {
  isUuid,
  normalizeRecord,
  textValue,
  TourismInputError
} from '@/lib/tourism'
import { runTourismDiscovery } from '@/lib/server/tourism-discovery'
import {
  requireTourismOwner,
  tourismBody,
  tourismError,
  tourismResponse
} from '@/lib/server/tourism'

export const dynamic = 'force-dynamic'
export const maxDuration = 90

export async function GET(request: NextRequest) {
  const auth = await requireTourismOwner(request)
  if ('error' in auth) return auth.error
  try {
    const { data, error } = await auth.supabase
      .from('tourism_jobs')
      .select(
        'id,query,state,attempts,result,usage,error,created_at,lease_until'
      )
      .eq('user_id', auth.user.id)
      .order('created_at', { ascending: false })
      .limit(30)
    if (error) throw error
    return tourismResponse({
      jobs: data,
      configured: Boolean(process.env.OPENAI_API_KEY)
    })
  } catch (error) {
    return tourismError(error)
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireTourismOwner(request)
  if ('error' in auth) return auth.error
  const sb = auth.supabase
  const owner = auth.user.id
  try {
    const body = await tourismBody(request)
    if (body.action === 'create') {
      const query = textValue(body.query, 1000)
      if (query.length < 5)
        throw new TourismInputError(
          'Descrivere un paese, una destinazione o una categoria (almeno 5 caratteri)'
        )
      const { count, error: countError } = await sb
        .from('tourism_jobs')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', owner)
        .gte('created_at', new Date(Date.now() - 3600000).toISOString())
      if (countError) throw countError
      if ((count || 0) >= 10)
        return tourismResponse(
          { error: 'Limite di 10 ricerche per ora raggiunto' },
          429
        )
      const { data, error } = await sb
        .from('tourism_jobs')
        .insert({ user_id: owner, query })
        .select('*')
        .single()
      if (error) throw error
      return tourismResponse({ job: data }, 201)
    }
    if (!isUuid(body.id)) throw new TourismInputError('ID job non valido')
    if (body.action === 'approve') {
      const { data: job, error } = await sb
        .from('tourism_jobs')
        .select('state,result')
        .eq('user_id', owner)
        .eq('id', body.id)
        .single()
      if (error) throw error
      if (job.state !== 'succeeded')
        throw new TourismInputError('Ricerca non completata')
      if (
        !Array.isArray(body.indices) ||
        !body.indices.length ||
        body.indices.length > 12 ||
        body.indices.some(
          (i) => !Number.isInteger(i) || i < 0 || i >= job.result.length
        )
      )
        throw new TourismInputError('Selezione candidati non valida')
      const records = [...new Set(body.indices)].map((i) =>
        normalizeRecord(job.result[i], 'ai')
      )
      const result = await sb.rpc('tourism_import', { p_records: records })
      if (result.error) throw result.error
      return tourismResponse(result.data)
    }
    if (body.action !== 'run')
      throw new TourismInputError('Azione discovery non valida')
    if (!process.env.OPENAI_API_KEY)
      return tourismResponse(
        {
          error:
            'OPENAI_API_KEY non configurata. Il job resta in coda e può essere ripreso dopo la configurazione.'
        },
        503
      )
    const claim = await sb.rpc('tourism_claim_job', { p_job_id: body.id })
    if (claim.error) throw claim.error
    const job = claim.data
    let result: Awaited<ReturnType<typeof runTourismDiscovery>>
    try {
      result = await runTourismDiscovery(job.query)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Discovery fallita'
      const saved = await sb
        .from('tourism_jobs')
        .update({
          state: 'failed',
          error: message.slice(0, 500),
          lease_until: null,
          finished_at: new Date().toISOString()
        })
        .eq('id', job.id)
        .eq('user_id', owner)
        .eq('lease_token', job.lease_token)
        .select('id')
        .maybeSingle()
      if (saved.error) throw saved.error
      return tourismResponse(
        {
          error: `${message}. Tentativo ${job.attempts}/3; ripresa manuale disponibile.`
        },
        502
      )
    }
    const { data, error } = await sb
      .from('tourism_jobs')
      .update({
        state: 'succeeded',
        result: result.records,
        usage: {
          ...result.usage,
          model: result.model,
          rejected: result.rejected.length
        },
        error: result.rejected.join('\n').slice(0, 1000) || null,
        lease_until: null,
        finished_at: new Date().toISOString()
      })
      .eq('user_id', owner)
      .eq('id', job.id)
      .eq('lease_token', job.lease_token)
      .select('*')
      .maybeSingle()
    if (error) throw error
    if (!data)
      return tourismResponse(
        {
          error:
            'Lease scaduta: il risultato di un tentativo precedente non è stato sovrascritto.'
        },
        409
      )
    return tourismResponse({ job: data })
  } catch (error) {
    return tourismError(error)
  }
}
