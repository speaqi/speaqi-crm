alter table public.contacts
  add column if not exists contact_scope text not null default 'crm' check (contact_scope in ('crm', 'holding')),
  add column if not exists promoted_at timestamptz;

create index if not exists contacts_user_scope_idx
on public.contacts(user_id, contact_scope, updated_at desc);
