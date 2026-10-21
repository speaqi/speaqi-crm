-- I modelli vivono nei JSON già separati agency_settings / tourism_deck_templates.
-- Solo il collegamento del preventivo Tourism richiede una nuova colonna.
alter table public.quotes
  add column tourism_deck_id uuid references public.tourism_decks(id) on delete set null;
create index quotes_tourism_deck_idx on public.quotes(user_id, tourism_deck_id, created_at desc)
  where tourism_deck_id is not null;
alter table public.quotes add constraint quotes_one_proposal_line
  check (agency_project_id is null or tourism_deck_id is null);

-- La FK non basta: il deck deve appartenere allo stesso workspace del preventivo.
-- SECURITY INVOKER mantiene le policy esistenti e non aggiunge accesso pubblico.
create function public.quote_tourism_same_owner() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.tourism_deck_id is not null and not exists (
    select 1 from public.tourism_decks d
    where d.id = new.tourism_deck_id and d.user_id = new.user_id
  ) then
    raise exception 'Tourism presentation not found for this owner' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.quote_tourism_same_owner() from public;
create trigger quotes_tourism_same_owner
  before insert or update of tourism_deck_id, user_id on public.quotes
  for each row execute function public.quote_tourism_same_owner();
