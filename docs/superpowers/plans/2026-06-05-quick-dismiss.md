# Quick Dismiss Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 3-option "cassa" dropdown (⋮) on priority queue, week grid, and contact list to quickly dismiss contacts as Lost, Waiting+3M, or Waiting+6M, plus a new Waiting pipeline stage and collapsible Kanban columns.

**Architecture:** New `QuickDismissMenu` component wraps `updateContact()` with preset status+follow-up combos. `Waiting` stage is semi-closed — excluded from priority queue/week grid but keeps follow-up date. `isInactiveStatus()` groups Waiting + Closed statuses for schedule filtering. Kanban adds a toggle to hide "cold" columns (New, Waiting, Lost).

**Tech Stack:** React 19, TypeScript 5, Next.js 15 App Router, Supabase

---

### Task 1: Add Waiting stage and `isInactiveStatus()` to data layer

**Files:**
- Modify: `src/lib/data.ts`

- [ ] **Step 1: Add Waiting to DEFAULT_PIPELINE_STAGES**

In `src/lib/data.ts`, insert `Waiting` after `Interested` (order 3), shift subsequent stages:

```ts
export const DEFAULT_PIPELINE_STAGES: Array<Omit<PipelineStage, 'id'>> = [
  { name: 'New', order: 0, color: '#3b82f6', system_key: 'new' },
  { name: 'Contacted', order: 1, color: '#f59e0b', system_key: 'contacted' },
  { name: 'Interested', order: 2, color: '#10b981', system_key: 'interested' },
  { name: 'Waiting', order: 3, color: '#8b5cf6', system_key: 'waiting' },
  { name: 'Supertop', order: 4, color: '#e11d48', system_key: 'supertop' },
  { name: 'Call booked', order: 5, color: '#7c3aed', system_key: 'call_booked' },
  { name: 'Quote', order: 6, color: '#f97316', system_key: 'quote' },
  { name: 'Lost', order: 7, color: '#ef4444', system_key: 'lost' },
  { name: 'Closed', order: 8, color: '#059669', system_key: 'closed' },
  { name: 'Paid', order: 9, color: '#0d9488', system_key: 'paid' },
]
```

- [ ] **Step 2: Add `isInactiveStatus()` function**

After the existing `isClosedStatus()` function (around line 264), add:

```ts
/** Status che escludono il contatto da code priorità e griglia settimanale (Waiting + closed). */
export function isInactiveStatus(status: string) {
  return isClosedStatus(status) || status.toLowerCase() === 'waiting'
}
```

- [ ] **Step 3: Add Waiting label to `statusLabel()`**

In the `statusLabel` switch, add a case for `Waiting`:

```ts
case 'Waiting':
case 'waiting':
  return 'In attesa'
```

- [ ] **Step 4: Verify the changes**

Run: `grep -n "isClosedStatus\|isInactiveStatus" src/lib/data.ts` to confirm both functions exist.

Run: `grep -n "Waiting\|waiting" src/lib/data.ts` to confirm Waiting is in stages, statusLabel, and isInactiveStatus.

- [ ] **Step 5: Commit**

```bash
git add src/lib/data.ts
git commit -m "feat: add Waiting pipeline stage and isInactiveStatus helper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Update schedule builder to exclude inactive statuses

**Files:**
- Modify: `src/lib/schedule.ts`

- [ ] **Step 1: Replace `isClosedStatus` with `isInactiveStatus` in `buildScheduledCalls`**

In `src/lib/schedule.ts`, update the import:

```ts
import { isInactiveStatus } from '@/lib/data'
```

Replace the `isClosedStatus` check at line 47:

```ts
// Before:
if (isClosedStatus(contact.status)) continue

// After:
if (isInactiveStatus(contact.status)) continue
```

Also update the `isClosedStatus` import removal — the import line changes from:
```ts
import { isClosedStatus } from '@/lib/data'
```
to:
```ts
import { isInactiveStatus } from '@/lib/data'
```

- [ ] **Step 2: Verify**

Run: `grep "isClosedStatus\|isInactiveStatus" src/lib/schedule.ts` to confirm only `isInactiveStatus` is used.

- [ ] **Step 3: Commit**

```bash
git add src/lib/schedule.ts
git commit -m "feat: exclude Waiting status from scheduled calls via isInactiveStatus

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Create QuickDismissMenu component

**Files:**
- Create: `src/components/crm/QuickDismissMenu.tsx`

- [ ] **Step 1: Create the component**

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'

interface Props {
  contactId: string
  contactName: string
  onDismiss: (contactId: string, status: string, nextFollowupAt: string | null) => void
  disabled?: boolean
}

function monthsFromNow(months: number): string {
  const d = new Date()
  d.setMonth(d.getMonth() + months)
  d.setHours(9, 0, 0, 0)
  return d.toISOString()
}

export function QuickDismissMenu({ contactId, contactName, onDismiss, disabled }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClick)
      return () => document.removeEventListener('mousedown', handleClick)
    }
  }, [open])

  function handleSelect(status: string, followupMonths: number | null) {
    setOpen(false)
    const followupAt = followupMonths ? monthsFromNow(followupMonths) : null
    onDismiss(contactId, status, followupAt)
  }

  return (
    <div className="quick-dismiss" ref={ref}>
      <button
        type="button"
        className="quick-dismiss-trigger"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        disabled={disabled}
        title={`Azioni rapide per ${contactName}`}
        aria-label={`Azioni rapide per ${contactName}`}
      >
        ⋮
      </button>
      {open && (
        <div className="quick-dismiss-dropdown">
          <button
            type="button"
            className="quick-dismiss-option is-lost"
            onClick={(e) => {
              e.stopPropagation()
              handleSelect('Lost', null)
            }}
          >
            ❌ Perso
          </button>
          <button
            type="button"
            className="quick-dismiss-option is-waiting"
            onClick={(e) => {
              e.stopPropagation()
              handleSelect('Waiting', 3)
            }}
          >
            ⏳ Richiama tra 3 mesi
          </button>
          <button
            type="button"
            className="quick-dismiss-option is-waiting"
            onClick={(e) => {
              e.stopPropagation()
              handleSelect('Waiting', 6)
            }}
          >
            📅 Richiama tra 6 mesi
          </button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Add styles**

Append to the global CSS file. First, find the CSS file:

Run: `ls src/app/globals.css src/app/(app)/*.css src/styles/*.css 2>/dev/null || echo "checking..."`

Then add the styles (location TBD based on existing pattern, but for now note the needed CSS):

```css
/* Quick Dismiss Menu */
.quick-dismiss {
  position: relative;
  display: inline-flex;
}

.quick-dismiss-trigger {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 1.1rem;
  padding: 2px 6px;
  border-radius: 6px;
  color: var(--text3, #999);
  line-height: 1;
}

.quick-dismiss-trigger:hover {
  background: var(--bg-hover, #f0f0f0);
  color: var(--text1, #333);
}

.quick-dismiss-dropdown {
  position: absolute;
  right: 0;
  top: 100%;
  z-index: 100;
  background: var(--surface, #fff);
  border: 1px solid var(--border, #ddd);
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.12);
  min-width: 200px;
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.quick-dismiss-option {
  display: block;
  width: 100%;
  padding: 8px 12px;
  border: none;
  background: none;
  cursor: pointer;
  text-align: left;
  font-size: 0.9rem;
  border-radius: 6px;
  white-space: nowrap;
}

.quick-dismiss-option:hover {
  background: var(--bg-hover, #f5f5f5);
}

.quick-dismiss-option.is-lost:hover {
  background: #fef2f2;
  color: #b91c1c;
}

.quick-dismiss-option.is-waiting:hover {
  background: #f5f3ff;
  color: #6d28d9;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/crm/QuickDismissMenu.tsx
git commit -m "feat: add QuickDismissMenu component with Perso/Waiting 3M/6M actions

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Add QuickDismissMenu to DashboardPriorityQueue

**Files:**
- Modify: `src/components/crm/DashboardPriorityQueue.tsx`

- [ ] **Step 1: Add import and update Props**

```tsx
import { QuickDismissMenu } from '@/components/crm/QuickDismissMenu'
```

Update the `Props` interface to add `onDismiss`:

```tsx
interface Props {
  items: QueueItem[]
  onOpenContact: (contactId: string, event: MouseEvent<HTMLElement>) => void
  onComplete: (taskId: string | null) => void
  onReschedule: (contactId: string, taskId: string | null, days: number) => void
  onDismiss: (contactId: string, status: string, nextFollowupAt: string | null) => void
}
```

- [ ] **Step 2: Add QuickDismissMenu to each queue row**

Inside the return, in the `.oggi-queue-actions` div, add the `QuickDismissMenu` as the last element, before the closing `</div>` of `.oggi-queue-actions`:

At line ~143, inside `.oggi-queue-actions`, after the ✓ or → button, add:

```tsx
<QuickDismissMenu
  contactId={item.contact.id}
  contactName={item.contact.name}
  onDismiss={onDismiss}
/>
```

Full updated `.oggi-queue-actions` block:

```tsx
<div className="oggi-queue-actions">
  {due && (
    <span className="oggi-queue-time">{time}</span>
  )}
  <div className="oggi-queue-shifts">
    {[0, 1, 3].map((days) => (
      <button
        key={days}
        type="button"
        className="oggi-call-shift"
        onClick={(e) => {
          e.stopPropagation()
          onReschedule(item.contact.id, item.task?.id || null, days)
        }}
      >
        {days === 0 ? 'Oggi' : `+${days}`}
      </button>
    ))}
  </div>
  {item.task?.id ? (
    <button
      type="button"
      className="oggi-call-done"
      onClick={(e) => {
        e.stopPropagation()
        onComplete(item.task!.id)
      }}
      title="Completato"
    >
      ✓
    </button>
  ) : (
    <button
      type="button"
      className="oggi-call-done"
      onClick={(e) => onOpenContact(item.contact.id, e)}
      title="Apri"
    >
      →
    </button>
  )}
  <QuickDismissMenu
    contactId={item.contact.id}
    contactName={item.contact.name}
    onDismiss={onDismiss}
  />
</div>
```

- [ ] **Step 3: Commit**

```bash
git add src/components/crm/DashboardPriorityQueue.tsx
git commit -m "feat: add QuickDismissMenu to priority queue rows

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Wire QuickDismissMenu in dashboard page

**Files:**
- Modify: `src/app/(app)/dashboard/page.tsx`

- [ ] **Step 1: Add imports**

Add at the top:

```tsx
import { QuickDismissMenu } from '@/components/crm/QuickDismissMenu'
import { isInactiveStatus } from '@/lib/data'
```

- [ ] **Step 2: Update `queueItems` to use `isInactiveStatus`**

In the `queueItems` useMemo (line 161), update the check that skips closed contacts:

```tsx
// Before (line 163):
if (isClosedStatus(contact.status)) continue

// After:
if (isInactiveStatus(contact.status)) continue
```

- [ ] **Step 3: Update `riskItems` to use `isInactiveStatus`**

In the `riskItems` useMemo (line 201):

```tsx
// Before:
if (isClosedStatus(contact.status)) continue

// After:
if (isInactiveStatus(contact.status)) continue
```

- [ ] **Step 4: Add `handleDismiss` function**

Add this function near the other handlers (after `handleReschedule`):

```tsx
async function handleDismiss(contactId: string, status: string, nextFollowupAt: string | null) {
  try {
    await updateContact(contactId, {
      status,
      next_followup_at: nextFollowupAt,
    })
    const label = status === 'Lost' ? 'Perso' : 'In attesa'
    showToast(`${label} ✓`)
  } catch (error) {
    showToast(`Errore: ${error instanceof Error ? error.message : 'operazione'}`)
  }
}
```

- [ ] **Step 5: Pass `onDismiss` to DashboardPriorityQueue**

Update the `DashboardPriorityQueue` usage:

```tsx
<DashboardPriorityQueue
  items={queueItems}
  onOpenContact={openDrawerFromMouse}
  onComplete={handleComplete}
  onReschedule={handleReschedule}
  onDismiss={handleDismiss}
/>
```

- [ ] **Step 6: Add QuickDismissMenu to week grid cards**

Inside the week grid (line ~550-590), inside each `oggi-call-card`, add the QuickDismissMenu in the card actions area (next to the ✓ button):

```tsx
<div className="oggi-call-card" ...>
  <div className="oggi-call-grip" aria-hidden>⋮⋮</div>
  <div className="oggi-call-time">...</div>
  <button className="oggi-call-body" ...>...</button>
  {call.task?.id ? (
    <button
      type="button"
      className="oggi-call-done"
      onClick={(event) => {
        event.stopPropagation()
        handleComplete(call.task!.id)
      }}
      title="Segna completato"
    >
      ✓
    </button>
  ) : (
    <button
      type="button"
      className="oggi-call-done"
      onClick={(event) => openDrawerFromMouse(call.contact.id, event)}
    >
      →
    </button>
  )}
  <QuickDismissMenu
    contactId={call.contact.id}
    contactName={call.contact.name}
    onDismiss={handleDismiss}
  />
</div>
```

- [ ] **Step 7: Commit**

```bash
git add src/app/\(app\)/dashboard/page.tsx
git commit -m "feat: wire QuickDismissMenu in dashboard (queue + week grid), use isInactiveStatus

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Add QuickDismissMenu to contacts list page

**Files:**
- Modify: `src/app/(app)/contacts/page.tsx`

- [ ] **Step 1: Add import**

At the top, add:

```tsx
import { QuickDismissMenu } from '@/components/crm/QuickDismissMenu'
```

- [ ] **Step 2: Add `handleDismiss` function inside `ContactsPageInner`**

Add this function near the other handlers:

```tsx
async function handleDismiss(contactId: string, status: string, nextFollowupAt: string | null) {
  try {
    await updateContact(contactId, {
      status,
      next_followup_at: nextFollowupAt,
    })
    const label = status === 'Lost' ? 'Perso' : 'In attesa'
    showToast(`${label} ✓`)
  } catch (error) {
    showToast(`Errore: ${error instanceof Error ? error.message : 'operazione'}`)
  }
}
```

- [ ] **Step 3: Add QuickDismissMenu to each contact row**

In the `.contacts-row-side` div (around line 1118), add the menu after the "📞 Oggi" / "✓ Oggi" button and before the closing `</div>` of `.contacts-row-side`. Only show it if the contact is not already in a dead status:

```tsx
{!isClosed && (
  <>
    {isToday ? (
      <span className="btn btn-ghost btn-xs contacts-row-action" style={{ opacity: 0.45, pointerEvents: 'none' }}>
        ✓ Oggi
      </span>
    ) : (
      <button
        type="button"
        className="btn btn-ghost btn-xs contacts-row-action"
        title="Sposta il follow-up ad oggi"
        onClick={async (e) => {
          e.stopPropagation()
          const due = todayAt9am()
          const existingTask = call?.task as TaskWithContact | null
          if (existingTask) {
            await updateTask(existingTask.id, { due_date: due })
          } else {
            await addTask(contact.id, { type: 'follow-up', due_date: due })
          }
          showToast(`${contact.name} → ricontatto aggiunto per oggi`)
        }}
      >
        📞 Oggi
      </button>
    )}
  </>
)}
{!isClosed && (
  <QuickDismissMenu
    contactId={contact.id}
    contactName={contact.name}
    onDismiss={handleDismiss}
  />
)}
```

Note: the `isClosed` variable is already defined at line 1051 as `const isClosed = isClosedStatus(contact.status)`. The QuickDismissMenu should also be visible for Waiting contacts (so they can be moved to Lost or back), but not for truly closed ones. So the condition `!isClosed` is correct — Waiting is NOT closed, Lost IS closed. But wait — according to the spec, the menu should be visible even for Waiting contacts. And we also want it visible for Lost? No — once a contact is Lost, you wouldn't "cassa" it again. Let's keep it simple: show the menu for any non-closed contact (including Waiting). The check `!isClosed` works because `isClosedStatus` does NOT include Waiting.

But actually, we should also show it for Waiting contacts so they can be moved to Lost. Currently `isClosed` means Lost/Closed/Paid. Waiting is not closed. So `!isClosed` already includes Waiting. Good.

But the user might want to dismiss a Waiting contact to Lost. That means even Waiting contacts should show the menu. The current condition `!isClosed` already handles this since Waiting is not closed.

So keep it as `!isClosed &&` — the QuickDismissMenu shows for New, Contacted, Interested, Waiting, Supertop, Call booked, Quote (all non-closed statuses).

- [ ] **Step 4: Commit**

```bash
git add src/app/\(app\)/contacts/page.tsx
git commit -m "feat: add QuickDismissMenu to contact list rows

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Handle Waiting status in PATCH API

**Files:**
- Modify: `src/app/api/contacts/[id]/route.ts`

- [ ] **Step 1: Update import**

Update the import to also bring in `isInactiveStatus`:

```tsx
import { isClosedStatus, isInactiveStatus, normalizeContactScope } from '@/lib/data'
```

- [ ] **Step 2: Keep follow-up for Waiting status**

Current code (lines ~339-341):

```ts
const nextFollowupAt =
  nextContactScope === 'holding' || isClosedStatus(nextStatus)
    ? null
    : requestedFollowupAt
```

This is correct as-is. When `nextStatus` is `'Waiting'`, `isClosedStatus` returns `false`, so `nextFollowupAt` stays as `requestedFollowupAt`. No change needed here.

- [ ] **Step 3: Complete pending call tasks for Waiting**

Current code (lines ~445-451):

```ts
if (isClosedStatus(nextStatus)) {
  await completePendingCallTasks(auth.supabase, auth.workspaceUserId, id)
} else if (nextContactScope === 'holding') {
  await completePendingCallTasks(auth.supabase, auth.workspaceUserId, id)
} else if (nextFollowupAt) {
  await syncPendingCallTask(auth.supabase, auth.workspaceUserId, id, nextFollowupAt)
}
```

Update to also handle Waiting:

```ts
if (isClosedStatus(nextStatus) || nextStatus === 'Waiting') {
  await completePendingCallTasks(auth.supabase, auth.workspaceUserId, id)
} else if (nextContactScope === 'holding') {
  await completePendingCallTasks(auth.supabase, auth.workspaceUserId, id)
} else if (nextFollowupAt) {
  await syncPendingCallTask(auth.supabase, auth.workspaceUserId, id, nextFollowupAt)
}
```

- [ ] **Step 4: Verify the build compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -40`

- [ ] **Step 5: Commit**

```bash
git add src/app/api/contacts/\[id\]/route.ts
git commit -m "feat: handle Waiting status in PATCH API (keep follow-up, complete pending tasks)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Add collapsible columns toggle to Kanban

**Files:**
- Modify: `src/app/(app)/kanban/page.tsx`

- [ ] **Step 1: Add state and constants**

Add after `comuneFilter` state:

```tsx
const [collapsedColumns, setCollapsedColumns] = useState(false)

const COLD_STAGES = new Set(['New', 'Waiting', 'Lost'])
```

- [ ] **Step 2: Add toggle button in toolbar**

After the "＋ Nuovo contatto" button (line ~226), add:

```tsx
<button
  type="button"
  className="btn btn-ghost btn-sm"
  onClick={() => setCollapsedColumns((v) => !v)}
  style={collapsedColumns ? { background: '#f5f3ff', borderColor: '#c4b5fd', color: '#6d28d9' } : undefined}
>
  {collapsedColumns ? '👁️ Mostra tutte le colonne' : '⚙️ Comprimi colonne'}
</button>
```

- [ ] **Step 3: Filter stages in board view**

In the board view (line ~290), update the stages map to filter out cold columns when collapsed:

```tsx
{stages
  .filter((stage) => !collapsedColumns || !COLD_STAGES.has(stage.name))
  .map((stage) => {
```

- [ ] **Step 4: Commit**

```bash
git add src/app/\(app\)/kanban/page.tsx
git commit -m "feat: add collapsible cold columns toggle to Kanban board

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Add CSS styles for QuickDismissMenu

**Files:**
- Modify: CSS file (find and update)

- [ ] **Step 1: Find the main CSS file**

Run: `ls src/app/globals.css 2>/dev/null && echo "FOUND: globals.css" || find src -name "*.css" -not -path "*/node_modules/*" | head -5`

- [ ] **Step 2: Add QuickDismissMenu styles**

Append to the CSS file:

```css
/* ─── Quick Dismiss Menu ─── */
.quick-dismiss {
  position: relative;
  display: inline-flex;
  align-items: center;
}
.quick-dismiss-trigger {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 1.15rem;
  padding: 2px 6px;
  border-radius: 6px;
  color: var(--text3, #94a3b8);
  line-height: 1;
}
.quick-dismiss-trigger:hover {
  background: var(--hover-bg, rgba(0,0,0,0.06));
  color: var(--text1, #1e293b);
}
.quick-dismiss-dropdown {
  position: absolute;
  right: 0;
  top: calc(100% + 4px);
  z-index: 200;
  background: var(--surface, #fff);
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.14);
  min-width: 210px;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.quick-dismiss-option {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 9px 14px;
  border: none;
  background: none;
  cursor: pointer;
  text-align: left;
  font-size: 0.875rem;
  border-radius: 7px;
  white-space: nowrap;
  color: var(--text1, #334155);
  transition: background 0.1s;
}
.quick-dismiss-option:hover {
  background: var(--hover-bg, #f1f5f9);
}
.quick-dismiss-option.is-lost:hover {
  background: #fef2f2;
  color: #b91c1c;
}
.quick-dismiss-option.is-waiting:hover {
  background: #f5f3ff;
  color: #6d28d9;
}
```

- [ ] **Step 3: Commit**

```bash
git add <css-file-path>
git commit -m "feat: add QuickDismissMenu CSS styles

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Final build verification

- [ ] **Step 1: Run TypeScript check**

```bash
npx tsc --noEmit --pretty 2>&1 | head -60
```

Expected: no errors (or only pre-existing errors unrelated to our changes).

- [ ] **Step 2: Run linter**

```bash
npm run lint -- --fix 2>&1 | tail -20
```

- [ ] **Step 3: Verify all imports are correct**

```bash
grep -rn "QuickDismissMenu" src/ --include="*.tsx" --include="*.ts"
```

Expected: import in DashboardPriorityQueue.tsx, dashboard/page.tsx, contacts/page.tsx; definition in QuickDismissMenu.tsx.

- [ ] **Step 4: Verify isInactiveStatus usage**

```bash
grep -rn "isInactiveStatus" src/ --include="*.tsx" --include="*.ts"
```

Expected: definition in data.ts, usage in schedule.ts, dashboard/page.tsx.

- [ ] **Step 5: Commit final verification**

```bash
git add -A
git diff --cached --stat
# Only commit if there are remaining uncommitted changes
```
