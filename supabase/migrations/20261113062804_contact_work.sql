-- Progetti commerciali distinti dalla fase della relazione con il contatto.
create table public.crm_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 200),
  status text not null default 'demo' check (status in ('demo','trial','active','suspended','archived')),
  price numeric(12,2) check (price is null or price >= 0),
  billing_interval text not null default 'yearly' check (billing_interval in ('monthly','yearly','custom')),
  terms text not null default '' check (length(terms) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index crm_projects_contact_idx on public.crm_projects(user_id, contact_id);
alter table public.crm_projects enable row level security;
-- contacts RLS restricts collaborators to their assigned contacts. Both sides
-- are checked so a project cannot be moved to an inaccessible workspace.
create policy crm_projects_contact_access on public.crm_projects for all to authenticated
  using (exists (select 1 from public.contacts c where c.id = crm_projects.contact_id and c.user_id = crm_projects.user_id))
  with check (exists (select 1 from public.contacts c where c.id = crm_projects.contact_id and c.user_id = crm_projects.user_id));
grant select, insert, update, delete on public.crm_projects to authenticated;
create trigger crm_projects_updated_at before update on public.crm_projects for each row execute function public.set_updated_at();

-- L'emissione esterna è una dichiarazione distinta dallo stato SDI e non
-- riserva numeri. Conserviamo la bozza precedente per la riconciliazione.
alter table public.invoices
  add column externally_issued boolean not null default false,
  add column external_number text,
  add column external_snapshot jsonb,
  add column payment_state text not null default 'unknown' check (payment_state in ('unknown','unpaid','paid')),
  add column paid_at date,
  add column project_id uuid references public.crm_projects(id) on delete set null;
create unique index invoices_external_number_unique on public.invoices(user_id, extract(year from issue_date), lower(btrim(external_number))) where externally_issued and external_number is not null;
alter table public.tasks add column project_id uuid references public.crm_projects(id) on delete set null;
alter table public.quotes add column project_id uuid references public.crm_projects(id) on delete set null;

create function public.check_crm_project_link() returns trigger language plpgsql set search_path = public as $$
begin
  if new.project_id is not null and not exists (
    select 1 from public.crm_projects p where p.id = new.project_id and p.user_id = new.user_id
      and (new.contact_id is null or p.contact_id = new.contact_id)
  ) then raise exception 'Progetto non valido per questo contatto'; end if;
  return new;
end; $$;
create trigger tasks_crm_project_check before insert or update of project_id, user_id, contact_id on public.tasks for each row execute function public.check_crm_project_link();
create trigger quotes_crm_project_check before insert or update of project_id, user_id, contact_id on public.quotes for each row execute function public.check_crm_project_link();
create trigger invoices_crm_project_check before insert or update of project_id, user_id, contact_id on public.invoices for each row execute function public.check_crm_project_link();

-- Storico degli stati registrati, senza cancellare le versioni precedenti.
create table public.crm_project_status_history (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.crm_projects(id) on delete cascade,
  old_status text,
  new_status text not null,
  changed_at timestamptz not null default now()
);
create index crm_project_status_history_project_idx on public.crm_project_status_history(project_id, changed_at desc);
alter table public.crm_project_status_history enable row level security;
create policy crm_project_status_history_read on public.crm_project_status_history for select to authenticated
  using (exists (select 1 from public.crm_projects p where p.id = crm_project_status_history.project_id));
grant select on public.crm_project_status_history to authenticated;
create function public.record_crm_project_status() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.crm_project_status_history(project_id, old_status, new_status) values (new.id, null, new.status);
  elsif old.status is distinct from new.status then
    insert into public.crm_project_status_history(project_id, old_status, new_status) values (new.id, old.status, new.status);
  end if;
  return new;
end; $$;
revoke all on function public.record_crm_project_status() from public, anon, authenticated;
create trigger crm_project_status_history_record after insert or update of status on public.crm_projects for each row execute function public.record_crm_project_status();
