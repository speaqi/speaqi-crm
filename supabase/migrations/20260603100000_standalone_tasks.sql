-- Make contact_id nullable to allow standalone to-do tasks
alter table public.tasks
  alter column contact_id drop not null;

-- Add title column for standalone tasks that have no contact name to display
alter table public.tasks
  add column if not exists title text;
