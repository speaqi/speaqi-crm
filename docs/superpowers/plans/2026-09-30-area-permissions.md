# Area Permissions & Super Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the workspace owner (super admin) choose, per collaborator, which CRM areas are visible; enforce it in menu, pages and area-specific APIs.

**Architecture:** One pure module (`src/lib/areas.ts`) defines areas, defaults and path→area resolution, shared by client and server. `team_members.allowed_areas text[]` stores the per-user choice. `requireRouteUser` exposes `allowedAreas`; a `requireArea` helper returns 403 in area-specific routes. The client filters the sidebar, redirects blocked URLs and offers a checkbox panel in Impostazioni → Team.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Supabase (Postgres + service role), Node 22 built-in test runner (`node --test`, native TS type stripping).

**Spec:** `docs/superpowers/specs/2026-09-30-area-permissions-design.md`

## Global Constraints

- Super admin = the user for whom `requireRouteUser` returns `isAdmin = true`. Always all areas, never restrictable. No new role column.
- Area keys, exactly: `oggi`, `pipeline`, `contatti`, `followup`, `email`, `preventivi`, `analytics`, `finanza`, `marketing`, `progetti`, `import`, `impostazioni`.
- `oggi` is always on. Defaults when `allowed_areas` is `null`: `pipeline`, `contatti`, `followup`.
- Super-admin-only paths (not in the panel): `/acumbamail`, `/hospitality`, `/impostazioni/wine-project`, `/impostazioni/team`.
- Existing `auth.isAdmin` checks stay untouched. Contact visibility rules stay untouched. No RLS changes.
- UI copy in Italian. 403 message: `Area non abilitata per questo utente`. Redirect toast: `Area non abilitata per il tuo utente`.
- `src/lib/areas.ts` must use only erasable TypeScript syntax (no `enum`, no parameter properties, no `@/` imports) so `node --test` can load it directly.
- The worktree has no `node_modules`: run `npm install` once before the first verification step.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Migration not yet applied (column `allowed_areas` missing): a collaborator must get the default areas — never a 500, never `isAdmin = true`. Pinned in Task 2 (separate, error-tolerant query).
2. `allowed_areas = []`: the user sees only Oggi, and `/dashboard` stays reachable so the redirect cannot loop. Pinned in Task 1 tests.
3. Unknown or non-string keys stored in the array are ignored, not crashed on. Pinned in Task 1 tests.
4. Nested paths and look-alikes: `/contacts/123` → `contatti`, `/impostazioni/email-ai` → `impostazioni`, `/impostazioni/team` → super admin only, `/importazioni` must NOT match `/import`. Pinned in Task 1 tests.
5. Client cannot load `/api/team-members`: no client-side blocking (areas unknown → allow), APIs remain the barrier. Pinned in Task 1 tests (`null` areas) and Task 4.

---

### Task 1: Area definitions (pure module + tests)

**Files:**
- Create: `src/lib/areas.ts`
- Test: `scripts/areas.test.mjs`

**Interfaces:**
- Produces: `AREAS`, `AreaKey`, `ALL_AREA_KEYS`, `SUPER_ADMIN_PATHS`, `isAreaKey(value): value is AreaKey`, `resolveAllowedAreas(raw: unknown, isAdmin: boolean): AreaKey[]`, `areaForPath(pathname: string): AreaKey | null`, `canAccessPath(pathname: string, areas: AreaKey[] | null, isAdmin: boolean): boolean`.

- [ ] **Step 1: Write the failing test**

`scripts/areas.test.mjs`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ALL_AREA_KEYS,
  areaForPath,
  canAccessPath,
  isAreaKey,
  resolveAllowedAreas,
} from '../src/lib/areas.ts'

test('super admin gets every area', () => {
  assert.deepEqual(resolveAllowedAreas(['pipeline'], true), ALL_AREA_KEYS)
  assert.deepEqual(resolveAllowedAreas(null, true), ALL_AREA_KEYS)
})

test('null means defaults plus oggi', () => {
  assert.deepEqual(resolveAllowedAreas(null, false), ['oggi', 'pipeline', 'contatti', 'followup'])
  assert.deepEqual(resolveAllowedAreas(undefined, false), ['oggi', 'pipeline', 'contatti', 'followup'])
})

test('empty array means only oggi', () => {
  assert.deepEqual(resolveAllowedAreas([], false), ['oggi'])
})

test('unknown and non-string keys are ignored, order follows AREAS', () => {
  assert.deepEqual(resolveAllowedAreas(['finanza', 'boh', 42, null, 'pipeline', 'finanza'], false), [
    'oggi',
    'pipeline',
    'finanza',
  ])
  assert.deepEqual(resolveAllowedAreas('finanza', false), ['oggi', 'pipeline', 'contatti', 'followup'])
})

test('isAreaKey', () => {
  assert.equal(isAreaKey('finanza'), true)
  assert.equal(isAreaKey('campagne'), false)
  assert.equal(isAreaKey(3), false)
})

test('areaForPath resolves nested paths on segment boundaries', () => {
  assert.equal(areaForPath('/contacts/123'), 'contatti')
  assert.equal(areaForPath('/impostazioni'), 'impostazioni')
  assert.equal(areaForPath('/impostazioni/email-ai'), 'impostazioni')
  assert.equal(areaForPath('/progetti'), 'progetti')
  assert.equal(areaForPath('/import'), 'import')
  assert.equal(areaForPath('/importazioni'), null)
  assert.equal(areaForPath('/contacts?scope=holding'), 'contatti')
  assert.equal(areaForPath('/qualcosa-di-nuovo'), null)
})

test('canAccessPath', () => {
  const base = resolveAllowedAreas(null, false)
  assert.equal(canAccessPath('/kanban', base, false), true)
  assert.equal(canAccessPath('/finanza', base, false), false)
  assert.equal(canAccessPath('/finanza', resolveAllowedAreas(['finanza'], false), false), true)
  // dashboard always reachable, even with nothing granted
  assert.equal(canAccessPath('/dashboard', resolveAllowedAreas([], false), false), true)
  // unmapped paths are allowed
  assert.equal(canAccessPath('/qualcosa-di-nuovo', base, false), true)
  // unknown areas (team call failed) → no client-side blocking
  assert.equal(canAccessPath('/finanza', null, false), true)
})

test('super admin paths ignore granted areas', () => {
  const everything = resolveAllowedAreas([...ALL_AREA_KEYS], false)
  for (const path of ['/acumbamail', '/hospitality', '/impostazioni/wine-project', '/impostazioni/team']) {
    assert.equal(canAccessPath(path, everything, false), false, path)
    assert.equal(canAccessPath(path, ALL_AREA_KEYS, true), true, path)
  }
  // even when areas are unknown, non-admins never pass super admin paths
  assert.equal(canAccessPath('/acumbamail', null, false), false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test scripts/areas.test.mjs`
Expected: FAIL — `Cannot find module '.../src/lib/areas.ts'`.

- [ ] **Step 3: Write the implementation**

`src/lib/areas.ts`:

```ts
// Aree del CRM abilitabili per singolo collaboratore (Impostazioni → Team).
// Modulo puro, condiviso da client e server: niente import, solo sintassi
// TypeScript cancellabile (viene caricato anche da `node --test`).

export const AREAS = [
  { key: 'oggi', label: 'Oggi', paths: ['/dashboard', '/operativo'], alwaysOn: true, defaultOn: true },
  { key: 'pipeline', label: 'Pipeline', paths: ['/kanban'], alwaysOn: false, defaultOn: true },
  {
    key: 'contatti',
    label: 'Contatti',
    paths: ['/contacts', '/personali', '/partner', '/vinitaly', '/speaqi', '/quick-capture', '/voice'],
    alwaysOn: false,
    defaultOn: true,
  },
  { key: 'followup', label: 'Follow-up', paths: ['/calendario'], alwaysOn: false, defaultOn: true },
  { key: 'email', label: 'Email', paths: ['/email', '/gmail'], alwaysOn: false, defaultOn: false },
  { key: 'preventivi', label: 'Preventivi', paths: ['/preventivi'], alwaysOn: false, defaultOn: false },
  { key: 'analytics', label: 'Analytics', paths: ['/attivita'], alwaysOn: false, defaultOn: false },
  { key: 'finanza', label: 'Finanza', paths: ['/finanza'], alwaysOn: false, defaultOn: false },
  { key: 'marketing', label: 'Marketing', paths: ['/marketing'], alwaysOn: false, defaultOn: false },
  { key: 'progetti', label: 'Progetti', paths: ['/progetti'], alwaysOn: false, defaultOn: false },
  { key: 'import', label: 'Import', paths: ['/import'], alwaysOn: false, defaultOn: false },
  { key: 'impostazioni', label: 'Impostazioni', paths: ['/impostazioni'], alwaysOn: false, defaultOn: false },
] as const

export type AreaKey = (typeof AREAS)[number]['key']

export const ALL_AREA_KEYS: AreaKey[] = AREAS.map((area) => area.key)

// Riservati al proprietario del workspace: non delegabili dal pannello.
export const SUPER_ADMIN_PATHS = [
  '/acumbamail',
  '/hospitality',
  '/impostazioni/wine-project',
  '/impostazioni/team',
]

export function isAreaKey(value: unknown): value is AreaKey {
  return typeof value === 'string' && (ALL_AREA_KEYS as string[]).includes(value)
}

// null/non-array = mai configurato → default. Array (anche vuoto) = esattamente quelle aree.
export function resolveAllowedAreas(raw: unknown, isAdmin: boolean): AreaKey[] {
  if (isAdmin) return ALL_AREA_KEYS
  const granted = Array.isArray(raw) ? raw.filter(isAreaKey) : null
  return AREAS.filter((area) =>
    area.alwaysOn ? true : granted ? granted.includes(area.key) : area.defaultOn
  ).map((area) => area.key)
}

function cleanPath(pathname: string) {
  return pathname.split(/[?#]/)[0]
}

function matchesPrefix(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

export function areaForPath(pathname: string): AreaKey | null {
  const path = cleanPath(pathname)
  let best: { key: AreaKey; length: number } | null = null
  for (const area of AREAS) {
    for (const prefix of area.paths) {
      if (matchesPrefix(path, prefix) && (!best || prefix.length > best.length)) {
        best = { key: area.key, length: prefix.length }
      }
    }
  }
  return best ? best.key : null
}

// `areas === null` = aree non note lato client (chiamata team fallita): non si blocca,
// le API restano la barriera.
export function canAccessPath(pathname: string, areas: AreaKey[] | null, isAdmin: boolean): boolean {
  const path = cleanPath(pathname)
  if (SUPER_ADMIN_PATHS.some((prefix) => matchesPrefix(path, prefix))) return isAdmin
  if (isAdmin || areas === null) return true
  const area = areaForPath(path)
  return area === null || areas.includes(area)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test scripts/areas.test.mjs`
Expected: all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/areas.ts scripts/areas.test.mjs
git commit -m "feat(permissions): area definitions and path resolution"
```

---

### Task 2: Migration, server auth and team API

**Files:**
- Create: `supabase/migrations/20260930100000_team_member_allowed_areas.sql`
- Modify: `src/lib/server/supabase.ts` (candidate type ~line 52, the six `.select('user_id, name, created_at…')` calls, `requireRouteUser` ~line 155-235)
- Modify: `src/app/api/team-members/route.ts` (GET response)
- Modify: `src/app/api/team-members/[id]/route.ts` (PATCH body handling)
- Modify: `src/types/index.ts` (`TeamMember`)

**Interfaces:**
- Consumes: `AreaKey`, `isAreaKey`, `resolveAllowedAreas` from `@/lib/areas`.
- Produces: `requireRouteUser(...)` result gains `allowedAreas: AreaKey[]`; `requireArea(auth: { allowedAreas: AreaKey[] }, ...areas: AreaKey[]): Response | null` (passes if ANY listed area is granted); `GET /api/team-members` response gains `allowed_areas: AreaKey[]`; `PATCH /api/team-members/[id]` accepts `allowed_areas: string[]`; `TeamMember.allowed_areas?: string[] | null`.

- [ ] **Step 1: Migration**

`supabase/migrations/20260930100000_team_member_allowed_areas.sql`:

```sql
-- Aree del CRM visibili al collaboratore (Impostazioni → Team).
-- null = mai configurato → default applicativi (src/lib/areas.ts).
alter table public.team_members
  add column if not exists allowed_areas text[];
```

Do NOT apply it to the remote database in this task; the user applies it before deploy.

- [ ] **Step 2: Carry the member id through resolution**

In `src/lib/server/supabase.ts`:

Add `id` to the candidate type:

```ts
type TeamMemberCandidate = {
  id?: string | null
  user_id?: string | null
  name?: string | null
  email?: string | null
  created_at?: string | null
}
```

In both `resolveTeamMemberWithUserClient` and `resolveTeamMemberWithServiceRole`, change every `.select('user_id, name, created_at')` to `.select('id, user_id, name, created_at')` and every `.select('user_id, name, created_at, email')` to `.select('id, user_id, name, created_at, email')` (six calls in total). Do not add `allowed_areas` to these selects: if the column is missing the whole resolution would fail and the collaborator would fall back to `isAdmin = true`.

- [ ] **Step 3: Expose `allowedAreas` and add `requireArea`**

Add the import at the top of `src/lib/server/supabase.ts`:

```ts
import { resolveAllowedAreas, type AreaKey } from '@/lib/areas'
```

In `requireRouteUser`, track the member id. Replace:

```ts
    if (resolvedMember?.user_id) {
      workspaceUserId = resolvedMember.user_id
      isAdmin = resolvedMember.user_id === user.id
      memberName = resolvedMember.name?.trim() || null
    }
```

with:

```ts
    if (resolvedMember?.user_id) {
      workspaceUserId = resolvedMember.user_id
      isAdmin = resolvedMember.user_id === user.id
      memberName = resolvedMember.name?.trim() || null
      memberId = resolvedMember.id || null
    }
```

and declare `let memberId: string | null = null` next to `let memberName: string | null = null`.

Just before the final `return {`, add:

```ts
  // Query separata e tollerante: se la colonna non esiste ancora (migrazione non
  // applicata) il collaboratore ricade sui default, senza 500 e senza diventare admin.
  let allowedAreasRaw: unknown = null
  if (!isAdmin && memberId) {
    try {
      const { data } = await createServiceRoleClient()
        .from('team_members')
        .select('allowed_areas')
        .eq('id', memberId)
        .maybeSingle()
      allowedAreasRaw = data?.allowed_areas ?? null
    } catch {
      // No service role key: keep defaults.
    }
  }
  const allowedAreas = resolveAllowedAreas(allowedAreasRaw, isAdmin)
```

Add `allowedAreas,` to the returned object after `memberName,`.

At the end of the file add:

```ts
/** 403 se l'utente non ha nessuna delle aree indicate. Il super admin le ha sempre tutte. */
export function requireArea(auth: { allowedAreas: AreaKey[] }, ...areas: AreaKey[]) {
  if (areas.some((area) => auth.allowedAreas.includes(area))) return null
  return Response.json({ error: 'Area non abilitata per questo utente' }, { status: 403 })
}
```

- [ ] **Step 4: Team API**

`src/app/api/team-members/route.ts`, GET — add one field to the response:

```ts
  return Response.json({
    members,
    is_admin: auth.isAdmin,
    member_name: auth.memberName,
    allowed_areas: auth.allowedAreas,
  })
```

`src/app/api/team-members/[id]/route.ts` — add `import { isAreaKey } from '@/lib/areas'`, and in PATCH right after the line `if ('color' in body) update.color = normalizeText(body.color)`:

```ts
    if ('allowed_areas' in body) {
      const areas: unknown = body.allowed_areas
      if (!Array.isArray(areas) || !areas.every(isAreaKey)) {
        return Response.json({ error: 'Aree non valide' }, { status: 400 })
      }
      update.allowed_areas = Array.from(new Set(areas))
    }
```

(PATCH is already restricted to `auth.isAdmin`, so only the super admin can change permissions.)

`src/types/index.ts`, in `interface TeamMember` after `color?: string | null`:

```ts
  allowed_areas?: string[] | null
```

- [ ] **Step 5: Verify**

Run: `npm install` (once), then `npx tsc --noEmit` and `node --test scripts/areas.test.mjs`
Expected: no type errors; tests pass.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260930100000_team_member_allowed_areas.sql src/lib/server/supabase.ts src/app/api/team-members src/types/index.ts
git commit -m "feat(permissions): allowed_areas column, requireArea and team API"
```

---

### Task 3: Gate area-specific API routes

**Files (all under `src/app/api/`):**
- Modify: `analytics/route.ts`, `analytics/projects/route.ts`, `finance/overview/route.ts`, `finance/goals/route.ts`, `marketing/queue/route.ts`, `marketing/contacts/[id]/route.ts`, `quotes/route.ts`, `quotes/[id]/route.ts`, `quotes/[id]/send-acceptance-email/route.ts`, `import/csv/route.ts`, `import/ocr/route.ts`, `user-settings/route.ts`, `gmail/route.ts`, `gmail/connect/route.ts`

**Interfaces:**
- Consumes: `requireArea(auth, ...areas)` from `@/lib/server/supabase` (Task 2).

- [ ] **Step 1: Add the guard to every handler listed below**

In each file, add `requireArea` to the existing import from `@/lib/server/supabase`. In each listed handler, immediately after the existing line `if ('error' in auth) return auth.error`, insert (with the area from the table):

```ts
  const areaError = requireArea(auth, 'finanza')
  if (areaError) return areaError
```

| File | Handlers | Area argument(s) |
|---|---|---|
| `analytics/route.ts` | GET | `'analytics'` |
| `analytics/projects/route.ts` | GET | `'analytics', 'progetti'` |
| `finance/overview/route.ts` | GET | `'finanza'` |
| `finance/goals/route.ts` | POST, DELETE | `'finanza'` |
| `marketing/queue/route.ts` | GET | `'marketing'` |
| `marketing/contacts/[id]/route.ts` | PATCH | `'marketing'` |
| `quotes/route.ts` | GET, POST | `'preventivi'` |
| `quotes/[id]/route.ts` | GET, PATCH, DELETE | `'preventivi'` |
| `quotes/[id]/send-acceptance-email/route.ts` | POST | `'preventivi'` |
| `import/csv/route.ts` | POST | `'import'` |
| `import/ocr/route.ts` | POST | `'import'` |
| `user-settings/route.ts` | GET, PUT | `'impostazioni'` |
| `gmail/route.ts` | GET, DELETE | `'email'` |
| `gmail/connect/route.ts` | POST | `'email'` |

Do NOT touch: `quotes/public/*` (public customer pages), `import/legacy` (called automatically by `useCRM` for every user), `gmail/callback`, any `automation/*`, `ai/*`, `contacts/*`, `tasks/*`, `deals`, `pipeline-stages`.

If a handler's `requireRouteUser` result is stored under a name other than `auth`, use that name.

- [ ] **Step 2: Verify coverage and types**

Run: `grep -rc "requireArea(auth" src/app/api | grep -v ":0"`
Expected: 14 files, counts summing to 20 (one per handler in the table).

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api
git commit -m "feat(permissions): enforce areas on area-specific API routes"
```

---

### Task 4: Client — context, sidebar, page guard, settings cards

**Files:**
- Modify: `src/hooks/useCRM.ts` (state ~line 112, team load ~line 236-250, `updateTeamMember` ~line 746, return object ~line 790)
- Modify: `src/components/layout/Sidebar.tsx`
- Modify: `src/app/(app)/layout.tsx`
- Modify: `src/app/(app)/impostazioni/page.tsx`

**Interfaces:**
- Consumes: `canAccessPath`, `AreaKey` from `@/lib/areas`; `allowed_areas` from `GET /api/team-members` (Task 2).
- Produces: `useCRM()` / `useCRMContext()` expose `allowedAreas: AreaKey[] | null` (null = unknown); `updateTeamMember(id, payload)` payload accepts `allowed_areas?: string[]`; `Sidebar` props `{ counts, allowedAreas: AreaKey[] | null, isAdmin: boolean }`.

- [ ] **Step 1: `useCRM` state**

Add import: `import type { AreaKey } from '@/lib/areas'`.

After `const [isAdmin, setIsAdmin] = useState(true)`:

```ts
  /** Aree abilitate per l'utente loggato; null = non note (chiamata team fallita) → nessun blocco lato client. */
  const [allowedAreas, setAllowedAreas] = useState<AreaKey[] | null>(null)
```

In the team load, extend the response type and store the value:

```ts
        const teamResponse = await apiFetch<{
          members: TeamMember[]
          is_admin?: boolean
          member_name?: string | null
          allowed_areas?: AreaKey[]
        }>('/api/team-members')
        setTeamMembers(teamResponse.members || [])
        teamIsAdmin = Boolean(teamResponse.is_admin ?? true)
        setIsAdmin(teamIsAdmin)
        setAllowedAreas(Array.isArray(teamResponse.allowed_areas) ? teamResponse.allowed_areas : null)
```

Change the `updateTeamMember` payload type to:

```ts
payload: { name?: string; email?: string | null; color?: string | null; make_admin?: boolean; allowed_areas?: string[] }
```

Add `allowedAreas,` to the returned object right after `isAdmin,`.

- [ ] **Step 2: Sidebar**

In `src/components/layout/Sidebar.tsx`:

```ts
import { canAccessPath, type AreaKey } from '@/lib/areas'
```

Extend props:

```ts
interface SidebarProps {
  counts: { /* unchanged */ }
  allowedAreas: AreaKey[] | null
  isAdmin: boolean
}
```

Move the three footer links into a constant next to `NAV_ITEMS`:

```ts
const FOOTER_ITEMS = [
  { href: '/import', label: 'Importa', icon: '📥' },
  { href: '/acumbamail', label: 'Acumbamail', icon: '📧' },
  { href: '/hospitality', label: 'Hospitality', icon: '🏨' },
]
```

Change the signature to `export function Sidebar({ counts, allowedAreas, isAdmin }: SidebarProps)` and, after `const pathname = usePathname()`:

```ts
  const visible = (href: string) => canAccessPath(href, allowedAreas, isAdmin)
```

Render `NAV_ITEMS.filter((item) => visible(item.href)).map(...)` (body unchanged) and replace the footer with:

```tsx
      <div className="sidebar-footer">
        {FOOTER_ITEMS.filter((item) => visible(item.href)).map((item) => (
          <Link key={item.href} href={item.href} className="nav-item sidebar-footer-item">
            <span className="icon">{item.icon}</span>
            {item.label}
          </Link>
        ))}
      </div>
```

- [ ] **Step 3: Page guard in the app layout**

In `src/app/(app)/layout.tsx` add `import { canAccessPath } from '@/lib/areas'`.

After the existing auth `useEffect` and BEFORE the `if (!authChecked || crm.loading)` early return, add:

```tsx
  const areaBlocked = !crm.loading && !canAccessPath(pathname, crm.allowedAreas, crm.isAdmin)

  useEffect(() => {
    if (!authChecked || !areaBlocked) return
    showToast('Area non abilitata per il tuo utente')
    router.replace('/dashboard')
  }, [authChecked, areaBlocked, router, showToast])
```

Pass the new props: `<Sidebar counts={counts} allowedAreas={crm.allowedAreas} isAdmin={crm.isAdmin} />`.

Replace `{children}` with `{areaBlocked ? null : children}`.

(`/dashboard` belongs to the always-on area `oggi`, so the redirect target is never blocked.)

- [ ] **Step 4: Settings cards**

In `src/app/(app)/impostazioni/page.tsx` add:

```ts
import { canAccessPath } from '@/lib/areas'
import { useCRMContext } from '../layout'
```

Inside the component:

```ts
  const { allowedAreas, isAdmin } = useCRMContext()
  const items = SETTINGS_ITEMS.filter((item) => canAccessPath(item.href, allowedAreas, isAdmin))
```

and map over `items` instead of `SETTINGS_ITEMS`.

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors (pre-existing lint warnings unrelated to these files are acceptable; note them, do not fix).

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useCRM.ts src/components/layout/Sidebar.tsx "src/app/(app)/layout.tsx" "src/app/(app)/impostazioni/page.tsx"
git commit -m "feat(permissions): filter menu and block pages by allowed areas"
```

---

### Task 5: Permissions panel in Impostazioni → Team

**Files:**
- Modify: `src/app/(app)/impostazioni/team/page.tsx`
- Modify: `src/app/globals.css` (after the `.team-role-badge` block, ~line 3360)

**Interfaces:**
- Consumes: `AREAS`, `resolveAllowedAreas`, `AreaKey` from `@/lib/areas`; `updateTeamMember(id, { allowed_areas })` (Task 4); `TeamMember.allowed_areas` (Task 2).

- [ ] **Step 1: Toggle handler**

In `team/page.tsx` add `import { AREAS, resolveAllowedAreas, type AreaKey } from '@/lib/areas'`, then inside the component:

```tsx
  const [savingAreasFor, setSavingAreasFor] = useState<string | null>(null)
  const panelAreas = AREAS.filter((area) => !area.alwaysOn)

  async function handleToggleArea(memberId: string, current: AreaKey[], key: AreaKey) {
    const next = panelAreas
      .map((area) => area.key)
      .filter((areaKey) => (areaKey === key ? !current.includes(key) : current.includes(areaKey)))
    setSavingAreasFor(memberId)
    try {
      await updateTeamMember(memberId, { allowed_areas: next })
    } catch (updateError) {
      showToast(`Errore: ${updateError instanceof Error ? updateError.message : 'permessi non aggiornati'}`)
    } finally {
      setSavingAreasFor(null)
    }
  }
```

The checkboxes are controlled by `teamMembers` state, which `updateTeamMember` only updates on success — on failure the tick stays as it was.

- [ ] **Step 2: Render the panel**

Inside `.team-row-body`, after the email line `{member.email && <span className="team-row-email">{member.email}</span>}`, add:

```tsx
                {isAdmin &&
                  (member.is_current_admin ? (
                    <span className="team-areas-note">Super admin · accesso completo</span>
                  ) : (
                    <div className="team-areas">
                      <span className="team-areas-label">Aree visibili</span>
                      {panelAreas.map((area) => {
                        const current = resolveAllowedAreas(member.allowed_areas, false)
                        return (
                          <label key={area.key} className="team-area-check">
                            <input
                              type="checkbox"
                              checked={current.includes(area.key)}
                              disabled={savingAreasFor === member.id}
                              onChange={() => handleToggleArea(member.id, current, area.key)}
                            />
                            {area.label}
                          </label>
                        )
                      })}
                    </div>
                  ))}
```

Update the page subtitle to:

```tsx
          Aggiungi i collaboratori e scegli quali aree del CRM può vedere ciascuno. Se imposti una password, crei anche il loro accesso.
```

- [ ] **Step 3: Styles**

Append after the `.team-role-badge { … }` block in `src/app/globals.css`:

```css
.team-areas { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; margin-top: 8px; }
.team-areas-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text3); }
.team-area-check { display: inline-flex; align-items: center; gap: 5px; font-size: 13px; cursor: pointer; }
.team-area-check input { margin: 0; }
.team-areas-note { font-size: 12px; color: var(--text3); margin-top: 4px; }
```

Also change `.team-row` alignment so the action buttons stay at the top when the row grows: read the existing `.team-row { … }` rule (line ~3333) and, if it has `align-items: center`, change it to `align-items: flex-start`.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/impostazioni/team/page.tsx" src/app/globals.css
git commit -m "feat(permissions): per-collaborator area checkboxes in Team settings"
```

---

### Task 6: Docs and final verification

**Files:**
- Modify: `CLAUDE.md` (section "Collaborator / Workspace Access")

- [ ] **Step 1: Document the feature**

Append to the "Collaborator / Workspace Access" list in `CLAUDE.md`:

```markdown
- **Area permissions**: the workspace owner is the super admin (always every area). For each collaborator, `team_members.allowed_areas` (text[], `null` = defaults Pipeline/Contatti/Follow-up) lists the visible areas, edited via checkboxes in `/impostazioni/team`. Areas, defaults and path mapping live in `src/lib/areas.ts` (single source of truth, tested by `node --test scripts/areas.test.mjs`). Enforcement: sidebar + settings cards filtered and blocked URLs redirected to `/dashboard` in `(app)/layout.tsx`; area-specific API routes call `requireArea(auth, '<area>')` right after `requireRouteUser`. Acumbamail, Hospitality, Wine Project and Team management are super-admin only (`SUPER_ADMIN_PATHS`, `auth.isAdmin`) and not delegable. New area-specific routes must add a `requireArea` guard.
```

- [ ] **Step 2: Full verification**

Run: `node --test scripts/areas.test.mjs && npx tsc --noEmit && npm run lint`
Expected: tests pass, no type or lint errors.

Run: `npm run build` (needs `.env.local` with `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`; if the worktree has none, copy it from the main checkout `../../../.env.local`). If no env file is available anywhere, report the build as not run — do not claim it passed.
Expected: build completes.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: area permissions"
```

---

## Manual check after the migration is applied (user, with a collaborator account)

1. Collaborator logs in: sidebar shows only Oggi, Pipeline, Contatti, Follow-up.
2. Opening `/finanza` by URL → back to Oggi with the toast.
3. As super admin, tick "Finanza" for that collaborator in Impostazioni → Team; collaborator reloads → `/finanza` opens.
4. Collaborator opening `/acumbamail` or `/impostazioni/team` → redirected, whatever is ticked.
