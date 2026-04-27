import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/server/supabase'

export async function POST(request: Request) {
  try {
    const { name, email, password } = await request.json()

    if (!name || !email || !password) {
      return NextResponse.json({ error: 'Tutti i campi sono obbligatori' }, { status: 400 })
    }

    if (password.length < 6) {
      return NextResponse.json({ error: 'Password troppo corta (min 6 caratteri)' }, { status: 400 })
    }

    const sb = createServiceRoleClient()

    const { data: authData, error: authError } = await sb.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: name },
    })

    if (authError) {
      return NextResponse.json({ error: authError.message }, { status: 400 })
    }

    const { error: memberError } = await sb
      .from('team_members')
      .insert({
        name,
        email: email.toLowerCase().trim(),
        auth_user_id: authData.user.id,
        role: 'collaborator',
      })

    if (memberError) {
      await sb.auth.admin.deleteUser(authData.user.id)
      return NextResponse.json({ error: 'Errore creazione profilo' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ error: 'Errore interno del server' }, { status: 500 })
  }
}
