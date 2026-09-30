# Permessi per area e super admin — Design

Data: 2026-09-30

## Obiettivo

Massimo Morgante, proprietario del workspace, deve poter decidere per ogni
collaboratore quali aree del CRM sono visibili. Oggi tutti i collaboratori
vedono lo stesso menu del proprietario e possono aprire quasi ogni pagina.

Successo: un collaboratore senza permesso su un'area non la vede nel menu, non
la apre via URL e non ne può chiamare le API dedicate. Il proprietario gestisce
le spunte da Impostazioni → Team.

## Ruoli

- **Super admin** = proprietario del workspace, cioè l'utente per cui oggi
  `requireRouteUser` restituisce `isAdmin = true` (`team_members.user_id ===
  auth user id`, oppure nessuna riga team risolta). Ha sempre tutte le aree e
  non è limitabile. Nessun nuovo ruolo né nuova colonna per identificarlo.
- **Collaboratore** = ogni altro utente del team. Vede le aree in
  `team_members.allowed_areas`.

Gestione team (creare, rinominare, rimuovere, permessi) resta esclusiva del
super admin, indipendentemente dall'area "Impostazioni". I controlli
`auth.isAdmin` esistenti restano invariati.

Le campagne commerciali (Acumbamail, Hospitality, Wine Project) sono
**esclusive del super admin** e non compaiono nel pannello: non sono
delegabili. Le loro API sono già protette da `auth.isAdmin`.

La visibilità dei contatti (solo quelli assegnati) non cambia.

## Aree

Chiave → pagine (prefisso di path):

| Chiave | Etichetta | Pagine | Default |
|---|---|---|---|
| `oggi` | Oggi | `/dashboard`, `/operativo` | sempre attiva, non disattivabile |
| `pipeline` | Pipeline | `/kanban` | sì |
| `contatti` | Contatti | `/contacts`, `/personali`, `/partner`, `/vinitaly`, `/speaqi`, `/quick-capture`, `/voice` | sì |
| `followup` | Follow-up | `/calendario` | sì |
| `email` | Email | `/email`, `/gmail` | no |
| `preventivi` | Preventivi | `/preventivi` | no |
| `analytics` | Analytics | `/attivita` | no |
| `finanza` | Finanza | `/finanza` | no |
| `marketing` | Marketing | `/marketing` | no |
| `progetti` | Progetti | `/progetti` | no |
| `import` | Import | `/import` | no |
| `impostazioni` | Impostazioni | `/impostazioni`, `/impostazioni/email-ai` | no |

Path riservati al super admin (`SUPER_ADMIN_PATHS`): `/acumbamail`,
`/hospitality`, `/impostazioni/wine-project`, `/impostazioni/team`.

Risoluzione del path: prima i path super admin, poi vince il prefisso più
lungo tra le aree. Un path che non corrisponde a nulla è consentito.

## Dati

Migrazione `supabase/migrations/<timestamp>_team_member_allowed_areas.sql`:

```sql
alter table public.team_members
  add column if not exists allowed_areas text[];
```

- `null` = mai configurato → si applicano i default (`pipeline`, `contatti`,
  `followup`, più `oggi`).
- Array (anche vuoto) = esattamente quelle aree, più `oggi`.

I collaboratori esistenti restano `null` e quindi passano alle aree base.
Nessun altro dato viene toccato. Chiavi sconosciute nell'array vengono ignorate.

## Componenti

### `src/lib/areas.ts` (condiviso client/server, puro)

- `AREAS`: elenco ordinato `{ key, label, paths, alwaysOn?, defaultOn }`.
- `AreaKey`: unione delle chiavi.
- `resolveAllowedAreas(raw: unknown, isAdmin: boolean): AreaKey[]` — super
  admin → tutte; altrimenti default o array filtrato, sempre con `oggi`.
- `SUPER_ADMIN_PATHS`: prefissi riservati al super admin.
- `areaForPath(pathname): AreaKey | null` — prefisso più lungo.
- `canAccessPath(pathname, areas, isAdmin): boolean`.

### Server — `src/lib/server/supabase.ts`

- Le query di risoluzione del membro selezionano anche `allowed_areas`.
- `requireRouteUser` restituisce in più `allowedAreas: AreaKey[]`.
- Nuovo helper `requireArea(auth, area): Response | null` — 403
  `{ error: 'Area non abilitata per questo utente' }` se l'area manca.

### API

`GET /api/team-members`: aggiunge `allowed_areas` (aree effettive del
chiamante) alla risposta; le righe `members` includono la colonna grezza.

`PATCH /api/team-members/[id]`: accetta `allowed_areas: string[]`, validato
contro `AREAS` (chiavi sconosciute → 400). Già riservato al super admin.

Blocco per area sulle route usate solo dalla pagina dell'area:

| Area | Route |
|---|---|
| `analytics` | `GET /api/analytics` |
| `analytics` o `progetti` | `GET /api/analytics/projects` (usata da `/progetti`) |
| `finanza` | `/api/finance/overview`, `/api/finance/goals` |
| `marketing` | `/api/marketing/queue`, `/api/marketing/contacts/[id]` |
| `preventivi` | `POST /api/quotes`, `PATCH`/`DELETE /api/quotes/[id]`, `/api/quotes/[id]/send-acceptance-email` |
| `import` | `/api/import/csv`, `/api/import/legacy`, `/api/import/ocr` |
| `impostazioni` | `/api/user-settings` |
| `email` | `/api/gmail`, `/api/gmail/connect` |

Non bloccate, perché condivise con aree base:

- `GET /api/quotes*` (scheda contatto).
- `/api/ai/generate-drafts` e le route sessione di `/api/automation/*` per le
  bozze (usate da dashboard, scheda contatto, calendario). L'area `email`
  blocca quindi le pagine `/email` e `/gmail`, non la bozza dalla scheda.
- `GET /api/pipeline-stages`, `/api/contacts*`, `/api/tasks*`, `/api/deals`.
- Le route autenticate con `AUTOMATION_SECRET`, webhook e route pubbliche:
  non passano da `requireRouteUser` e restano invariate.

### Client

- `useCRM`: nuovo stato `allowedAreas`, letto da `/api/team-members`; esposto
  nel context insieme a `canAccess(area)`. Se la chiamata team fallisce si
  mantiene il comportamento attuale (nessun blocco lato client; le API
  restano la barriera).
- `updateTeamMember` accetta `allowed_areas`.
- `Sidebar`: riceve `allowedAreas`, filtra `NAV_ITEMS` e i link del footer
  tramite `canAccessPath`.
- `(app)/layout.tsx`: dopo il caricamento, se `!canAccessPath(pathname,
  allowedAreas)` → `router.replace('/dashboard')` e toast "Area non abilitata
  per il tuo utente"; nel frattempo non renderizza `children`.
- `/impostazioni`: le card vengono filtrate con `canAccessPath` sul loro href.
- `/impostazioni/team`: sotto ogni collaboratore non admin, una riga di
  checkbox per area (esclusa `oggi`). Ogni click salva subito con `PATCH`;
  in caso di errore la spunta torna indietro e compare un toast. La riga del
  super admin mostra "Accesso completo".

## Errori

- 403 di area dalle API: messaggio mostrato dal normale gestore errori della
  pagina (in pratica non raggiungibile dall'interfaccia, dato il redirect).
- Colonna assente (migrazione non ancora applicata): la select fallisce sulla
  colonna; `requireRouteUser` deve degradare a "default" e non a errore 500.
  Ordine di rilascio consigliato: migrazione prima del deploy.

## Verifica

Il progetto non ha una suite di test. Verifica prevista:

- `npm run lint` e `npm run build` puliti.
- Script Node una tantum sulle funzioni pure di `src/lib/areas.ts`
  (default, array vuoto, chiavi sconosciute, prefisso più lungo, super admin).
- Prova manuale in dev con un account collaboratore: menu ridotto, redirect
  da URL diretto, 403 su `/api/finance/overview`, spunta che riabilita l'area.

## Fuori scope

- Permessi a livello di singola azione (sola lettura / scrittura).
- Più super admin o ruoli intermedi.
- Modifiche alle policy RLS: il blocco è applicativo (pagine + API).
