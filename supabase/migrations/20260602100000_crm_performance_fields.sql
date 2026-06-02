-- CRM Performance: indici mancanti + nuovi campi commerciali
-- Parte del CRM Audit Fix Pack (giugno 2026)

-- ============================================================
-- NUOVI CAMPI CRM
-- ============================================================

alter table public.contacts
  add column if not exists win_probability integer default 0 check (win_probability >= 0 and win_probability <= 100),
  add column if not exists lost_reason text,
  add column if not exists company_size text,
  add column if not exists industry text;

-- ============================================================
-- INDICI MANCANTI (CRITICI)
-- ============================================================

-- Collaborator RLS: responsible matching senza indice = table scan
create index if not exists contacts_user_responsible_idx
  on public.contacts(user_id, responsible);

create index if not exists contacts_user_assigned_agent_idx
  on public.contacts(user_id, assigned_agent);

-- Score e valore: ordinamento lead caldi / deal value
create index if not exists contacts_user_score_idx
  on public.contacts(user_id, score desc);

create index if not exists contacts_user_value_idx
  on public.contacts(user_id, value desc nulls last);

create index if not exists contacts_user_priority_idx
  on public.contacts(user_id, priority desc);

-- Stale detection: filtro per last_contact_at
create index if not exists contacts_user_last_contact_idx
  on public.contacts(user_id, last_contact_at desc);

-- Source: channel attribution
create index if not exists contacts_user_source_idx
  on public.contacts(user_id, source);

-- Industry: segmentazione
create index if not exists contacts_user_industry_idx
  on public.contacts(user_id, industry);

-- Win probability: forecast pesato
create index if not exists contacts_user_win_probability_idx
  on public.contacts(user_id, win_probability desc);

-- ============================================================
-- INDICI SU TASKS
-- ============================================================

-- Ogni pagina dettaglio contatto filtra tasks per contact_id
create index if not exists tasks_contact_status_idx
  on public.tasks(contact_id, status);

create index if not exists tasks_user_contact_status_idx
  on public.tasks(user_id, contact_id, status);

-- ============================================================
-- INDICI SU EMAIL_LOGS (RLS senza indice)
-- ============================================================

create index if not exists email_logs_user_created_idx
  on public.email_logs(user_id, created_at desc);

-- ============================================================
-- INDICI SU QUOTES
-- ============================================================

create index if not exists quotes_user_payment_state_idx
  on public.quotes(user_id, payment_state);

create index if not exists quotes_user_amount_idx
  on public.quotes(user_id, total_amount desc);

-- ============================================================
-- STAGE TRANSITION HISTORY (per analytics conversione)
-- ============================================================

create table if not exists public.stage_transitions (
  id uuid default gen_random_uuid() primary key,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  user_id uuid not null,
  from_stage text,
  to_stage text not null,
  changed_at timestamptz default now()
);

create index if not exists stage_transitions_contact_idx
  on public.stage_transitions(contact_id, changed_at desc);

create index if not exists stage_transitions_user_idx
  on public.stage_transitions(user_id, changed_at desc);

-- RLS: owner only
alter table public.stage_transitions enable row level security;

create policy "stage_transitions_owner"
  on public.stage_transitions
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
