# Quick Dismiss — Azioni rapide "Cassa" da Dashboard e Contatti

**Data**: 2026-06-05
**Stato**: Approved

## Obiettivo

Permettere di "cassare" rapidamente un contatto dalla dashboard (coda priorità, griglia settimanale) e dalla lista contatti con 3 azioni:

1. **Perso** → contatto spostato nello stage `Lost`, follow-up rimosso
2. **Richiama tra 3 mesi** → contatto spostato in `Waiting`, follow-up a +3 mesi
3. **Richiama tra 6 mesi** → contatto spostato in `Waiting`, follow-up a +6 mesi

L'azione è disponibile ovunque appaia un contatto: priority queue, week grid, contact list.

## Design

### Nuovo stage `Waiting`

Lo stage `Waiting` è uno stage **semi-chiuso**:

- I contatti in `Waiting` **non appaiono** nella coda priorità né nella griglia settimanale
- I contatti in `Waiting` mantengono un `next_followup_at` (a differenza di `Lost`)
- I contatti sono recuperabili dal Kanban e dalla lista contatti
- `Waiting` **non è closed** — il contatto può essere riportato in uno stage attivo

Posizione nella pipeline:

```
New → Contacted → Interested → Waiting → Supertop → Call booked → Quote → Lost → Closed → Paid
```

### Nuova funzione `isInactiveStatus()`

Raggruppa gli stage che devono essere esclusi da code e griglia:

```ts
isInactiveStatus(status) = isClosedStatus(status) || status === 'Waiting'
```

Usata in `buildScheduledCalls()` e nella costruzione della `queueItems`.

### Componente `QuickDismissMenu`

Un menu dropdown attivato da un'icona `⋮` su ogni card/riga. Il menu contiene:

| Azione | Stage | Follow-up |
|--------|-------|-----------|
| ❌ Perso | `Lost` | `null` |
| ⏳ Richiama tra 3 mesi | `Waiting` | `now + 3 months` |
| 📅 Richiama tra 6 mesi | `Waiting` | `now + 6 months` |

Alla selezione:
- Chiama `updateContact(id, { status, next_followup_at })`
- L'hook `useCRM.updateContact` aggiorna lo stato locale
- Il contatto viene rimosso da coda/lista locale dopo il refresh

### Posizionamento

| Posizione | Componente |
|-----------|-----------|
| Righe Priority Queue | `DashboardPriorityQueue` — a destra delle azioni esistenti |
| Card Week Grid | `oggi-call-card` nella dashboard — accanto al pulsante ✓ |
| Righe Contact List | `contacts/page.tsx` — nella colonna azioni |

### Pipeline Kanban comprimibile

Toggle per nascondere/mostrare le colonne "fredde" (`New`, `Waiting`, `Lost`) nel Kanban. Default: visibili. Un pulsante `⚙️ Colonne` sopra la board attiva/disattiva la visibilità di queste colonne.

## Comportamento API

### `PATCH /api/contacts/[id]`

Quando `status` cambia in `Waiting`:
- Si comporta come uno stage attivo per il follow-up: **mantiene** `next_followup_at` se fornito
- Completa i task pending call (come fa per `Lost`)
- NON imposta `next_followup_at = null` (a differenza di `Lost`)

Logica attuale da modificare in `src/app/api/contacts/[id]/route.ts`:

```ts
// Attuale (righe ~339-341):
const nextFollowupAt =
  nextContactScope === 'holding' || isClosedStatus(nextStatus)
    ? null
    : requestedFollowupAt

// Nuovo:
const nextFollowupAt =
  nextContactScope === 'holding' || isClosedStatus(nextStatus)
    ? null
    : requestedFollowupAt
// Waiting mantiene il follow-up (non è closed)
```

`completePendingCallTasks` viene già chiamato per `isClosedStatus(nextStatus)` — va chiamato anche per `nextStatus === 'Waiting'`:

```ts
if (isClosedStatus(nextStatus) || nextStatus === 'Waiting') {
  await completePendingCallTasks(auth.supabase, auth.workspaceUserId, id)
} else if (nextContactScope === 'holding') {
  await completePendingCallTasks(auth.supabase, auth.workspaceUserId, id)
} else if (nextFollowupAt) {
  await syncPendingCallTask(...)
}
```

## Modifiche

### File modificati

| File | Modifica |
|------|----------|
| `src/lib/data.ts` | Aggiungere `Waiting` a `DEFAULT_PIPELINE_STAGES`, aggiungere `isInactiveStatus()` |
| `src/lib/schedule.ts` | `buildScheduledCalls()`: escludere `isInactiveStatus()` invece di `isClosedStatus()` |
| `src/components/crm/QuickDismissMenu.tsx` | **Nuovo** — componente dropdown con 3 azioni |
| `src/components/crm/DashboardPriorityQueue.tsx` | Aggiungere `<QuickDismissMenu>` su ogni riga coda |
| `src/app/(app)/dashboard/page.tsx` | Aggiungere `<QuickDismissMenu>` su ogni card week grid; usare `isInactiveStatus()` |
| `src/app/(app)/contacts/page.tsx` | Aggiungere `<QuickDismissMenu>` su ogni riga contatti |
| `src/app/(app)/kanban/page.tsx` | Toggle per colonne comprimibili (New, Waiting, Lost) |
| `src/app/api/contacts/[id]/route.ts` | Gestire `Waiting`: non azzerare follow-up, completare task pending call |

### Da NON modificare

- **Database schema**: `Waiting` è un valore testuale nello stage, non richiede nuove colonne o enum
- **RLS policies**: nessuna modifica necessaria
- **Task system**: `completePendingCallTasks` già esiste, va solo chiamato per Waiting
- **CSS/Stili**: il QuickDismissMenu usa gli stili esistenti del design system

## Edge Cases

- **Contatto senza task**: il menu funziona comunque, cambia solo status e follow-up sul contatto
- **Contatto già in Waiting/Lost**: il menu è comunque visibile (puoi spostare da Waiting a Lost, ecc.)
- **Contatto in stage chiuso (Closed/Paid)**: il menu non appare (non ha senso "perdere" un contatto già chiuso)
- **Admin vs Collaborator**: entrambi vedono il menu, il PATCH rispetta i permessi esistenti
