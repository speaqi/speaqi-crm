-- Soldi da ricevere: un'area a parte, fuori da Speaqi.
--
-- Non sono preventivi e non sono trattative: sono crediti personali (un
-- prestito, una fattura di un altro lavoro, un rimborso) che non hanno un
-- contatto in pipeline e non devono comparire in nessuna superficie del CRM.
-- Per questo la riga appartiene a chi l'ha scritta (`auth.uid()`), non al
-- workspace: un collaboratore non la vede, e il proprietario non vede quelle
-- dei collaboratori.
create table if not exists public.receivables (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  amount numeric(12, 2) not null check (amount > 0),
  -- Null = ancora da incassare. Una data e non un booleano: quando e' arrivato
  -- il pagamento e' l'unica cosa che interessa rileggere dopo.
  collected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists receivables_user_idx
  on public.receivables (user_id, collected_at, created_at);

alter table public.receivables enable row level security;

drop policy if exists "receivables_owner" on public.receivables;
create policy "receivables_owner" on public.receivables
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

comment on table public.receivables is
  'Soldi da ricevere, personali e fuori da Speaqi (/incassi). Una riga per credito, visibile solo a chi l''ha scritta.';

comment on column public.receivables.collected_at is
  'Quando e'' stato incassato. Null = ancora da incassare.';
