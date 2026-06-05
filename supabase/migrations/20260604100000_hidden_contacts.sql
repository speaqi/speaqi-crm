-- Hidden contacts: flag to hide contacts from pipeline without changing scope
alter table public.contacts
  add column if not exists hidden boolean default false;

create index if not exists contacts_user_hidden_idx
  on public.contacts(user_id, hidden);
