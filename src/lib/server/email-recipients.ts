// Niente "*": nei filtri ilike di PostgREST e' un jolly, e "a*@x.it"
// passerebbe il controllo grazie a "alice@x.it".
const EMAIL_PATTERN = /^[^\s@,;<>*]+@[^\s@,;<>*]+\.[^\s@,;<>*]+$/

/** Un solo indirizzo, senza liste ne' nomi: "a@x.it, b@y.it" non passa. */
export function singleRecipient(value: unknown) {
  if (typeof value !== 'string') return null
  const email = value.trim().toLowerCase()
  return EMAIL_PATTERN.test(email) ? email : null
}

function exactLikePattern(value: string) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}

/**
 * Le rotte che spediscono un testo scritto da chi chiama scrivono solo a chi
 * il workspace conosce gia': un contatto o un membro del team. Senza questo
 * controllo un account qualunque poteva usare il mittente del CRM per
 * scrivere a chiunque.
 */
export async function isWorkspaceRecipient(supabase: any, workspaceUserId: string, email: string) {
  const pattern = exactLikePattern(email)
  for (const table of ['contacts', 'team_members']) {
    const { data, error } = await supabase
      .from(table)
      .select('id')
      .eq('user_id', workspaceUserId)
      .ilike('email', pattern)
      .limit(1)
      .maybeSingle()
    if (error) throw error
    if (data) return true
  }
  return false
}
