-- Quali mappe Speaqi riguardano un contatto: l'hotel che ha il video nella
-- mappa di Capri, il comune che e' la guida di Sorrento. Per gli enti c'e'
-- gia' la strada di Tourism Intelligence (destinazione -> mappa); questa
-- tabella serve a tutti gli altri, e si scrive a mano dalla scheda completa.
create table public.contact_map_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  -- Lo slug della mappa (Speaqi o StudioMap): lo stato si legge a ogni apertura.
  map_ref text not null check (length(btrim(map_ref)) between 2 and 120),
  role text not null default 'client' check (role in ('client','partner','prospect','guide')),
  note text check (note is null or length(note) <= 500),
  created_at timestamptz not null default now(),
  unique (user_id, contact_id, map_ref)
);

create index contact_map_links_contact_idx on public.contact_map_links(contact_id);

alter table public.contact_map_links enable row level security;

create policy contact_map_links_owner on public.contact_map_links
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
