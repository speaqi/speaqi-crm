alter table public.contacts
add column if not exists email_draft_note text;

alter table public.email_drafts
add column if not exists scheduled_for timestamptz;

create unique index if not exists email_drafts_auto_schedule_unique
on public.email_drafts (contact_id, scheduled_for)
where source = 'auto' and scheduled_for is not null;
