alter table public.contacts
  add column if not exists category text;

create index if not exists contacts_user_category_idx
on public.contacts(user_id, category, next_action_at);
