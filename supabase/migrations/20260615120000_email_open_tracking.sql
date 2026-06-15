-- Per-message open tracking (tracking pixel) for outbound Gmail messages.
alter table public.gmail_messages
  add column if not exists tracking_token text,
  add column if not exists opened_at timestamptz,
  add column if not exists last_opened_at timestamptz,
  add column if not exists open_count integer not null default 0 check (open_count >= 0);

-- Lookup of a message by its tracking token must be unique and fast.
create unique index if not exists gmail_messages_tracking_token_idx
on public.gmail_messages(tracking_token)
where tracking_token is not null;
