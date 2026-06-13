-- Follow-up sequences (cadenze multi-step): "giorno 0 email, giorno 3 call, giorno 7 email, giorno 14 WhatsApp".
-- Le sequenze materializzano automaticamente i task della cadenza e si fermano da sole quando il lead risponde
-- (riusa applyReplyOutcome / classify-reply) o quando lo stage diventa chiuso. Obiettivo: non perdere lead per
-- mancanza di follow-up dopo il primo contatto.

-- Definizione della cadenza
create table if not exists public.followup_sequences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  description text,
  status text not null default 'active' check (status in ('active', 'paused', 'archived')),
  trigger_event text not null default 'manual' check (trigger_event in ('manual', 'email_sent')),
  stop_on_reply boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Step ordinati della cadenza. offset_hours è cumulativo dall'inizio dell'iscrizione (giorno 0 = 0h, giorno 3 = 72h).
create table if not exists public.sequence_steps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  sequence_id uuid not null references public.followup_sequences (id) on delete cascade,
  step_index integer not null,
  action text not null check (action in ('send_email', 'call', 'wait', 'whatsapp')),
  offset_hours integer not null default 0 check (offset_hours >= 0),
  title text,
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  created_at timestamptz not null default now(),
  unique (sequence_id, step_index)
);

-- Iscrizione di un contatto a una cadenza. next_run_at indica quando eseguire lo step current_step.
create table if not exists public.sequence_enrollments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  sequence_id uuid not null references public.followup_sequences (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'completed', 'stopped')),
  current_step integer not null default 0,
  next_run_at timestamptz,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  stopped_at timestamptz,
  stop_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sequence_id, contact_id)
);

create index if not exists followup_sequences_user_idx
  on public.followup_sequences (user_id, status);

create index if not exists sequence_steps_sequence_idx
  on public.sequence_steps (sequence_id, step_index);

create index if not exists sequence_enrollments_due_idx
  on public.sequence_enrollments (status, next_run_at);

create index if not exists sequence_enrollments_contact_idx
  on public.sequence_enrollments (contact_id, status);

create index if not exists sequence_enrollments_user_idx
  on public.sequence_enrollments (user_id, status);

drop trigger if exists set_followup_sequences_updated_at on public.followup_sequences;
create trigger set_followup_sequences_updated_at
before update on public.followup_sequences
for each row execute function public.set_updated_at();

drop trigger if exists set_sequence_enrollments_updated_at on public.sequence_enrollments;
create trigger set_sequence_enrollments_updated_at
before update on public.sequence_enrollments
for each row execute function public.set_updated_at();

alter table public.followup_sequences enable row level security;
alter table public.sequence_steps enable row level security;
alter table public.sequence_enrollments enable row level security;

-- Policy workspace: l'owner e i collaboratori (team_members linkati per auth_user_id o email) accedono ai dati.
drop policy if exists "followup_sequences_workspace" on public.followup_sequences;
create policy "followup_sequences_workspace"
on public.followup_sequences
for all to authenticated
using (
  auth.uid() = user_id
  or exists (
    select 1 from public.team_members tm
    where tm.user_id = followup_sequences.user_id
      and (
        tm.auth_user_id = auth.uid()
        or (
          tm.email is not null
          and btrim(tm.email) <> ''
          and lower(btrim(tm.email)) = lower(btrim(coalesce(auth.jwt()->>'email', '')))
        )
      )
  )
)
with check (
  auth.uid() = user_id
  or exists (
    select 1 from public.team_members tm
    where tm.user_id = followup_sequences.user_id
      and (
        tm.auth_user_id = auth.uid()
        or (
          tm.email is not null
          and btrim(tm.email) <> ''
          and lower(btrim(tm.email)) = lower(btrim(coalesce(auth.jwt()->>'email', '')))
        )
      )
  )
);

drop policy if exists "sequence_steps_workspace" on public.sequence_steps;
create policy "sequence_steps_workspace"
on public.sequence_steps
for all to authenticated
using (
  auth.uid() = user_id
  or exists (
    select 1 from public.team_members tm
    where tm.user_id = sequence_steps.user_id
      and (
        tm.auth_user_id = auth.uid()
        or (
          tm.email is not null
          and btrim(tm.email) <> ''
          and lower(btrim(tm.email)) = lower(btrim(coalesce(auth.jwt()->>'email', '')))
        )
      )
  )
)
with check (
  auth.uid() = user_id
  or exists (
    select 1 from public.team_members tm
    where tm.user_id = sequence_steps.user_id
      and (
        tm.auth_user_id = auth.uid()
        or (
          tm.email is not null
          and btrim(tm.email) <> ''
          and lower(btrim(tm.email)) = lower(btrim(coalesce(auth.jwt()->>'email', '')))
        )
      )
  )
);

drop policy if exists "sequence_enrollments_workspace" on public.sequence_enrollments;
create policy "sequence_enrollments_workspace"
on public.sequence_enrollments
for all to authenticated
using (
  auth.uid() = user_id
  or exists (
    select 1 from public.team_members tm
    where tm.user_id = sequence_enrollments.user_id
      and (
        tm.auth_user_id = auth.uid()
        or (
          tm.email is not null
          and btrim(tm.email) <> ''
          and lower(btrim(tm.email)) = lower(btrim(coalesce(auth.jwt()->>'email', '')))
        )
      )
  )
)
with check (
  auth.uid() = user_id
  or exists (
    select 1 from public.team_members tm
    where tm.user_id = sequence_enrollments.user_id
      and (
        tm.auth_user_id = auth.uid()
        or (
          tm.email is not null
          and btrim(tm.email) <> ''
          and lower(btrim(tm.email)) = lower(btrim(coalesce(auth.jwt()->>'email', '')))
        )
      )
  )
);
