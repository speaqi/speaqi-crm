alter table public.contacts
  add column if not exists list_name text;

create index if not exists contacts_user_scope_list_idx
on public.contacts(user_id, contact_scope, list_name, updated_at desc);
