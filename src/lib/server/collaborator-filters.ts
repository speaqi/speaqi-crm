/** Admin: full workspace list; collaboratore: parametro ignorato (sempre solo assegnati). */
export function workspaceContactsAllFromRequest(
  request: { nextUrl: URL },
  isAdmin: boolean
): boolean {
  return isAdmin && request.nextUrl.searchParams.get('workspace') === 'all'
}

/**
 * PostgREST `.or()` fragment: contact assigned to a team member by `responsible` or `assigned_agent`
 * (case-insensitive match, same as `ilike` without wildcards).
 */
export function contactAssigneeMatchOrFilter(memberName: string | null | undefined): string | null {
  const t = String(memberName || '').trim()
  if (!t) return null
  const quoted = `"${t.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  return `responsible.ilike.${quoted},assigned_agent.ilike.${quoted}`
}

/** Foreign table name for `tasks` → embedded `contact:contacts(...)` filters in Supabase/PostgREST. */
export const TASKS_CONTACT_FOREIGN_TABLE = 'contacts'
