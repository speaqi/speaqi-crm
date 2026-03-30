alter table public.contacts
  add column if not exists email_open_count integer not null default 0 check (email_open_count >= 0),
  add column if not exists email_click_count integer not null default 0 check (email_click_count >= 0),
  add column if not exists last_email_open_at timestamptz,
  add column if not exists last_email_click_at timestamptz,
  add column if not exists email_unsubscribed_at timestamptz,
  add column if not exists email_unsubscribe_source text;

create index if not exists contacts_user_email_idx
on public.contacts(user_id, email);

create index if not exists contacts_user_unsubscribed_idx
on public.contacts(user_id, email_unsubscribed_at desc);
