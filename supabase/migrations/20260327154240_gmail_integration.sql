create table if not exists public.gmail_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  refresh_token text not null,
  scope text,
  token_type text,
  history_id text,
  last_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id),
  unique(email)
);

create table if not exists public.gmail_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  gmail_account_id uuid not null references public.gmail_accounts(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  gmail_message_id text not null,
  gmail_thread_id text,
  direction text not null check (direction in ('inbound', 'outbound')),
  subject text,
  from_email text,
  to_emails text[] not null default '{}',
  cc_emails text[] not null default '{}',
  snippet text,
  body_text text,
  body_html text,
  sent_at timestamptz,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(gmail_account_id, gmail_message_id)
);

create table if not exists public.gmail_oauth_states (
  state text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists gmail_messages_user_contact_sent_idx
on public.gmail_messages(user_id, contact_id, sent_at desc);

create index if not exists gmail_messages_account_thread_idx
on public.gmail_messages(gmail_account_id, gmail_thread_id, sent_at desc);

create index if not exists gmail_oauth_states_user_created_idx
on public.gmail_oauth_states(user_id, created_at desc);

drop trigger if exists set_gmail_accounts_updated_at on public.gmail_accounts;
create trigger set_gmail_accounts_updated_at
before update on public.gmail_accounts
for each row execute function public.set_updated_at();

alter table public.gmail_accounts enable row level security;
alter table public.gmail_messages enable row level security;
alter table public.gmail_oauth_states enable row level security;

drop policy if exists "gmail_accounts_owner" on public.gmail_accounts;
create policy "gmail_accounts_owner"
on public.gmail_accounts
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "gmail_messages_owner" on public.gmail_messages;
create policy "gmail_messages_owner"
on public.gmail_messages
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "gmail_oauth_states_owner" on public.gmail_oauth_states;
create policy "gmail_oauth_states_owner"
on public.gmail_oauth_states
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
