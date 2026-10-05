-- Existing personal receivables remain confirmed; prospective amounts are separate.
alter table public.receivables
  add column if not exists category text not null default 'confirmed'
  constraint receivables_category_check check (category in ('confirmed', 'prospective'));
