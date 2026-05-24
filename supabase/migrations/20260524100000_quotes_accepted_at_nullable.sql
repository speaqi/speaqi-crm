-- New quotes are not accepted at creation time.
-- Keep accepted_at populated only when status becomes accepted/paid.
alter table public.quotes
  alter column accepted_at drop not null;

alter table public.quotes
  alter column accepted_at drop default;
