-- Fiere (/fiere): gli espositori di una fiera (oggi TTG Travel Experience) da
-- valutare, contattare e seguire. Un espositore non e' un contatto della
-- pipeline: finche' nessuno lo chiama e' solo una riga di un elenco. Quando si
-- decide di lavorarlo si collega (o si crea) il contatto (`contact_id`) e da
-- li' valgono attivita', task e trattative di sempre.
create table if not exists public.trade_fair_exhibitors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  fair text not null check (fair ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  slug text not null,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  stand text,
  hall text,
  country text,
  city text,
  category text,
  description text,
  website text,
  email text,
  phone text,
  source_url text,
  -- Punteggio 0-100 calcolato dal testo (src/lib/trade-fair.ts); la priorita'
  -- scelta a mano (1 alta, 2 media, 3 bassa) vince sul punteggio.
  score integer not null default 0 check (score between 0 and 100),
  score_reasons text[] not null default '{}',
  priority smallint check (priority between 1 and 3),
  status text not null default 'new'
    check (status in ('new', 'contacted', 'replied', 'interested', 'meeting', 'not_interested')),
  contacted_at timestamptz,
  next_followup_at date,
  -- Registro delle note: [{id, at, text}], dalla piu' recente.
  notes jsonb not null default '[]'::jsonb check (jsonb_typeof(notes) = 'array'),
  contact_id uuid references public.contacts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, fair, slug)
);

create index if not exists trade_fair_exhibitors_list_idx
  on public.trade_fair_exhibitors (user_id, fair, status, score desc);
create index if not exists trade_fair_exhibitors_followup_idx
  on public.trade_fair_exhibitors (user_id, next_followup_at) where next_followup_at is not null;

alter table public.trade_fair_exhibitors enable row level security;

drop policy if exists "trade_fair_exhibitors_owner" on public.trade_fair_exhibitors;
create policy "trade_fair_exhibitors_owner" on public.trade_fair_exhibitors
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

comment on table public.trade_fair_exhibitors is
  'Espositori di una fiera (/fiere): punteggio di priorita'', stato del contatto, note e follow-up.';
