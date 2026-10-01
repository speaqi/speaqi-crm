import type { SupabaseClient } from '@supabase/supabase-js'

// Accesso (Supabase Auth) di un collaboratore del team.
//
// Rimuovere un collaboratore cancella solo la riga `team_members`: l'utente di
// login resta in `auth.users`. Ricreandolo con la stessa email, `createUser`
// rispondeva "A user with this email address has already been registered" e
// non c'era modo di andare avanti dal CRM. Qui quell'utente si ritrova e si
// riusa, impostandogli la password scelta.
//
// Riusare un utente esistente vuol dire poterne cambiare la password, quindi
// non si riusa mai il titolare di un altro spazio di lavoro ne' un
// collaboratore di un altro team: altrimenti un admin qualsiasi prenderebbe
// l'account di chiunque conoscendone l'email.

export const MIN_PASSWORD_LENGTH = 8

export class TeamLoginError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
  }
}

export function validateMemberPassword(password: string) {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new TeamLoginError(`La password deve avere almeno ${MIN_PASSWORD_LENGTH} caratteri`)
  }
  if (password.length > 72) throw new TeamLoginError('Password troppo lunga (massimo 72 caratteri)')
}

export async function findAuthUserIdByEmail(admin: SupabaseClient, email: string) {
  const target = email.trim().toLowerCase()
  const perPage = 1000
  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage })
    if (error) throw new TeamLoginError(error.message, 500)
    const users = data?.users || []
    const match = users.find((candidate) => String(candidate.email || '').trim().toLowerCase() === target)
    if (match) return match.id
    if (users.length < perPage) return null
  }
  return null
}

type Scope = { workspaceUserId: string; currentUserId: string; memberId?: string | null }

/** Rifiuta un utente di login che appartiene a qualcun altro. */
export async function assertAuthUserBelongsToWorkspace(admin: SupabaseClient, authUserId: string, scope: Scope) {
  if (authUserId === scope.currentUserId) return

  const { data: linked, error: linkedError } = await admin
    .from('team_members')
    .select('id, user_id')
    .eq('auth_user_id', authUserId)
    .limit(5)
  if (linkedError) throw new TeamLoginError(linkedError.message, 500)
  const elsewhere = (linked || []).find((row) => row.user_id !== scope.workspaceUserId)
  if (elsewhere) throw new TeamLoginError('Questa email è già un accesso di un altro team: usane un’altra', 409)
  const otherMember = (linked || []).find((row) => row.id !== scope.memberId)
  if (otherMember) throw new TeamLoginError('Questa email è già l’accesso di un altro collaboratore del team', 409)

  // Il titolare di uno spazio di lavoro ha righe sue: non è un accesso da riciclare.
  for (const table of ['team_members', 'contacts'] as const) {
    const { count, error } = await admin
      .from(table)
      .select('id', { count: 'exact', head: true })
      .eq('user_id', authUserId)
    if (error) throw new TeamLoginError(error.message, 500)
    if ((count || 0) > 0) {
      throw new TeamLoginError('Questa email è il titolare di un altro spazio di lavoro: usane un’altra', 409)
    }
  }
}

/**
 * Crea l'accesso con email e password, oppure — se l'email ha già un utente di
 * login libero (tipicamente di un collaboratore rimosso) — lo riusa e gli
 * imposta la password. Restituisce l'id dell'utente di login.
 */
export async function ensureMemberLogin(
  admin: SupabaseClient,
  email: string,
  password: string,
  scope: Scope
): Promise<{ authUserId: string; reused: boolean }> {
  validateMemberPassword(password)

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (!createError && created.user?.id) return { authUserId: created.user.id, reused: false }

  const existingId = await findAuthUserIdByEmail(admin, email)
  if (!existingId) {
    throw new TeamLoginError(createError?.message || 'Accesso non creato')
  }
  await assertAuthUserBelongsToWorkspace(admin, existingId, scope)
  await setMemberPassword(admin, existingId, password)
  return { authUserId: existingId, reused: true }
}

export async function setMemberPassword(admin: SupabaseClient, authUserId: string, password: string) {
  validateMemberPassword(password)
  const { error } = await admin.auth.admin.updateUserById(authUserId, { password, email_confirm: true })
  if (error) throw new TeamLoginError(error.message)
}
