import { NextRequest } from 'next/server'
import { ensurePipelineStages } from '@/lib/server/crm'
import { requireRouteUser } from '@/lib/server/supabase'

export async function GET(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const stages = await ensurePipelineStages(auth.supabase, auth.user.id)
    return Response.json({ stages })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to load stages' },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const body = await request.json()
    const stages = Array.isArray(body.stages) ? body.stages : []

    if (!stages.length) {
      return Response.json({ error: 'Stages payload is empty' }, { status: 400 })
    }

    const { error: deleteError } = await auth.supabase
      .from('pipeline_stages')
      .delete()
      .eq('user_id', auth.user.id)

    if (deleteError) throw deleteError

    const { data, error } = await auth.supabase
      .from('pipeline_stages')
      .insert(
        stages.map((stage: any, index: number) => ({
          user_id: auth.user.id,
          name: String(stage.name || '').trim(),
          order: index,
          color: stage.color ? String(stage.color) : null,
          system_key: stage.system_key ? String(stage.system_key) : null,
        }))
      )
      .select('*')
      .order('order', { ascending: true })

    if (error) throw error

    return Response.json({ stages: data || [] })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to update stages' },
      { status: 500 }
    )
  }
}
