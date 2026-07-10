-- Trattative (deals): un contatto può avere più trattative nel tempo, al
-- massimo UNA aperta. contacts.status resta la cache speculare della
-- trattativa aperta (o dell'esito dell'ultima chiusa): dashboard, kanban,
-- automazioni e analytics continuano a leggerlo invariato. Le trattative
-- abilitano il rientro in pipeline dei clienti chiusi/pagati.

create table if not exists public.deals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  title text not null default 'Trattativa',
  -- Con chi è la trattativa (es. "Federalberghi"): la stessa persona può
  -- portare avanti opportunità con entità diverse.
  counterparty text,
  stage text not null,
  value numeric(12,2),
  quote_id uuid references public.quotes(id) on delete set null,
  expected_close_at date,
  outcome text check (outcome in ('won', 'lost')),
  lost_reason text,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists deals_one_open_per_contact
  on public.deals(contact_id)
  where closed_at is null;

create index if not exists deals_user_open_idx
  on public.deals(user_id, stage)
  where closed_at is null;

create index if not exists deals_contact_idx
  on public.deals(contact_id, created_at desc);

alter table public.quotes
  add column if not exists deal_id uuid references public.deals(id) on delete set null;

drop trigger if exists set_deals_updated_at on public.deals;
create trigger set_deals_updated_at
before update on public.deals
for each row execute function public.set_updated_at();

alter table public.deals enable row level security;

-- Stesso pattern workspace di contacts/tasks: owner, oppure membro del team
-- assegnatario del contatto padre (match nome su responsible/assigned_agent).
drop policy if exists "deals_workspace" on public.deals;
create policy "deals_workspace"
on public.deals
for all to authenticated
using (
  auth.uid() = user_id
  or exists (
    select 1
    from public.contacts c
    join public.team_members tm on tm.user_id = c.user_id
    where c.id = deals.contact_id
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
    from public.contacts c
    join public.team_members tm on tm.user_id = c.user_id
    where c.id = deals.contact_id
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

-- Backfill: esattamente una trattativa per ogni contatto CRM, derivata dallo
-- status attuale. I contatti chiusi ottengono una trattativa chiusa (won/lost)
-- così lo storico è coerente e possono ripartire con una nuova opportunità.
insert into public.deals (user_id, contact_id, title, stage, value, outcome, lost_reason, closed_at, created_at)
select
  c.user_id,
  c.id,
  'Trattativa iniziale',
  c.status,
  c.value,
  case
    when lower(c.status) in ('closed', 'paid') then 'won'
    when lower(c.status) in ('lost', 'not_interested') then 'lost'
    else null
  end,
  case when lower(c.status) in ('lost', 'not_interested') then c.lost_reason else null end,
  case
    when lower(c.status) in ('closed', 'paid') then coalesce(c.won_at, c.first_closed_at, c.updated_at, now())
    when lower(c.status) in ('lost', 'not_interested') then coalesce(c.first_closed_at, c.updated_at, now())
    else null
  end,
  c.created_at
from public.contacts c
where c.contact_scope = 'crm'
  and not exists (select 1 from public.deals d where d.contact_id = c.id);

-- Collega il preventivo più recente di ogni contatto alla sua trattativa.
update public.quotes q
set deal_id = d.id
from public.deals d
where q.contact_id = d.contact_id
  and q.deal_id is null
  and q.id = (
    select q2.id from public.quotes q2
    where q2.contact_id = q.contact_id
    order by q2.created_at desc
    limit 1
  );
