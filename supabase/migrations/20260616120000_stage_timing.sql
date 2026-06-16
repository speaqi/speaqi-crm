-- Stage timing: misura tempo-in-fase e tempo-di-chiusura dei lead.
-- Popola stage_transitions (tabella già esistente ma mai scritta) e aggiunge
-- colonne denormalizzate su contacts per il calcolo veloce lato card.

-- ============================================================
-- NUOVE COLONNE SU CONTACTS
-- ============================================================

alter table public.contacts
  add column if not exists stage_entered_at timestamptz,
  add column if not exists first_closed_at timestamptz,
  add column if not exists won_at timestamptz;

create index if not exists contacts_user_stage_entered_idx
  on public.contacts(user_id, stage_entered_at desc);

-- ============================================================
-- RLS stage_transitions: allinea ai collaboratori (come activities_workspace)
-- La policy originale (auth.uid() = user_id) bloccherebbe le scritture dei
-- membri del team, per cui workspaceUserId != auth.uid().
-- ============================================================

drop policy if exists "stage_transitions_owner" on public.stage_transitions;
drop policy if exists "stage_transitions_workspace" on public.stage_transitions;

create policy "stage_transitions_workspace"
on public.stage_transitions
for all to authenticated
using (
  auth.uid() = user_id
  or exists (
    select 1
    from public.team_members tm
    join public.contacts c
      on c.id = stage_transitions.contact_id
     and c.user_id = stage_transitions.user_id
    where tm.user_id = stage_transitions.user_id
      and (
        tm.auth_user_id = auth.uid()
        or (
          tm.email is not null
          and btrim(tm.email) <> ''
          and lower(btrim(tm.email)) = lower(btrim(coalesce(auth.jwt()->>'email', '')))
        )
      )
      and (
        lower(btrim(coalesce(c.responsible, ''))) = lower(btrim(tm.name))
        or lower(btrim(coalesce(c.assigned_agent, ''))) = lower(btrim(tm.name))
      )
  )
)
with check (
  auth.uid() = user_id
  or exists (
    select 1
    from public.team_members tm
    join public.contacts c
      on c.id = stage_transitions.contact_id
     and c.user_id = stage_transitions.user_id
    where tm.user_id = stage_transitions.user_id
      and (
        tm.auth_user_id = auth.uid()
        or (
          tm.email is not null
          and btrim(tm.email) <> ''
          and lower(btrim(tm.email)) = lower(btrim(coalesce(auth.jwt()->>'email', '')))
        )
      )
      and (
        lower(btrim(coalesce(c.responsible, ''))) = lower(btrim(tm.name))
        or lower(btrim(coalesce(c.assigned_agent, ''))) = lower(btrim(tm.name))
      )
  )
);

-- ============================================================
-- BACKFILL: stage_entered_at
-- Dall'ultima attività di sistema "stato X -> <status corrente>"; fallback
-- a updated_at, poi created_at.
-- ============================================================

update public.contacts c
set stage_entered_at = coalesce(t.entered_at, c.updated_at, c.created_at)
from (
  select distinct on (a.contact_id)
    a.contact_id,
    a.created_at as entered_at
  from public.activities a
  join public.contacts cc on cc.id = a.contact_id
  where a.type = 'system'
    and a.content ~ ('-> ' || cc.status || '($|[;.])')
  order by a.contact_id, a.created_at desc
) t
where c.id = t.contact_id
  and c.stage_entered_at is null;

-- Per i lead senza alcuna transizione tracciata
update public.contacts
set stage_entered_at = coalesce(updated_at, created_at)
where stage_entered_at is null;

-- ============================================================
-- BACKFILL: first_closed_at / won_at (solo lead attualmente chiusi)
-- ============================================================

update public.contacts c
set first_closed_at = coalesce(t.closed_at, c.updated_at)
from (
  select a.contact_id, min(a.created_at) as closed_at
  from public.activities a
  where a.type = 'system'
    and a.content ~ '-> (Closed|Paid|Lost|not_interested)($|[;.])'
  group by a.contact_id
) t
where c.id = t.contact_id
  and c.first_closed_at is null
  and lower(c.status) in ('closed', 'paid', 'lost', 'not_interested');

update public.contacts c
set won_at = coalesce(t.won_at, c.updated_at)
from (
  select a.contact_id, min(a.created_at) as won_at
  from public.activities a
  where a.type = 'system'
    and a.content ~ '-> (Closed|Paid)($|[;.])'
  group by a.contact_id
) t
where c.id = t.contact_id
  and c.won_at is null
  and lower(c.status) in ('closed', 'paid');

-- ============================================================
-- BACKFILL: storico stage_transitions dalle attività di sistema
-- Parsando "stato <from> -> <to>" (idempotente).
-- ============================================================

insert into public.stage_transitions (contact_id, user_id, from_stage, to_stage, changed_at)
select
  a.contact_id,
  c.user_id,
  btrim((regexp_match(a.content, 'stato (.+?) -> ([^;.]+)'))[1]) as from_stage,
  btrim((regexp_match(a.content, 'stato (.+?) -> ([^;.]+)'))[2]) as to_stage,
  a.created_at as changed_at
from public.activities a
join public.contacts c on c.id = a.contact_id
where a.type = 'system'
  and a.content ~ 'stato (.+?) -> ([^;.]+)'
  and not exists (
    select 1 from public.stage_transitions st
    where st.contact_id = a.contact_id
      and st.changed_at = a.created_at
  );
