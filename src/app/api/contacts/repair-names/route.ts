import { NextRequest } from 'next/server'
import { inferRepairName } from '@/lib/contact-name'
import { requireRouteUser } from '@/lib/server/supabase'

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message || fallback)
  }
  return fallback
}

export async function POST(request: NextRequest) {
  const auth = await requireRouteUser(request)
  if ('error' in auth) return auth.error

  try {
    const { data, error } = await auth.supabase
      .from('contacts')
      .select('id, name, email, company')
      .eq('user_id', auth.user.id)

    if (error) throw error

    const repairs = (data || [])
      .map((contact) => ({
        id: contact.id as string,
        name: inferRepairName({
          currentName: contact.name as string | null | undefined,
          company: contact.company as string | null | undefined,
          email: contact.email as string | null | undefined,
        }),
      }))
      .filter((contact): contact is { id: string; name: string } => !!contact.name)

    for (const repair of repairs) {
      const { error: updateError } = await auth.supabase
        .from('contacts')
        .update({ name: repair.name })
        .eq('user_id', auth.user.id)
        .eq('id', repair.id)

      if (updateError) throw updateError
    }

    return Response.json({ scanned: (data || []).length, updated: repairs.length })
  } catch (error) {
    return Response.json(
      { error: errorMessage(error, 'Riparazione nomi fallita') },
      { status: 500 }
    )
  }
}
