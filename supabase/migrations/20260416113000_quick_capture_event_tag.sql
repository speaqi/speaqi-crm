alter table public.contacts
  add column if not exists event_tag text;

create index if not exists contacts_user_event_tag_idx
on public.contacts(user_id, event_tag, created_at desc);
