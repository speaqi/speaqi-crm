-- Link vendita personali: ogni membro del team apre /vendita/<token> senza
-- login e crea il preventivo davanti al cliente.
--
-- Si salva solo lo SHA-256 del token, mai il token: il link si vede una volta
-- alla generazione e poi solo si rigenera. Il backup notturno esporta le
-- tabelle su Storage e via email, e un dump non deve contenere link validi.
--
-- Tabella a parte e non una colonna su team_members perche' team_members e'
-- leggibile dai collaboratori (team_members_select): l'hash di un link non
-- deve arrivare a chi non e' admin.

create table if not exists public.sales_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  team_member_id uuid not null references public.team_members(id) on delete cascade,
  token_hash text not null unique,
  token_hint text,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  last_used_at timestamptz
);

-- Un solo link attivo per membro: rigenerare revoca il precedente.
create unique index if not exists sales_links_one_active_per_member
  on public.sales_links(team_member_id)
  where revoked_at is null;

create index if not exists sales_links_user_idx on public.sales_links(user_id);

alter table public.sales_links enable row level security;

drop policy if exists "sales_links_owner" on public.sales_links;
create policy "sales_links_owner"
on public.sales_links
for all to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
