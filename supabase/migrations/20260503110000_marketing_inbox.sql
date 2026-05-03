alter table public.contacts
  add column if not exists marketing_status text not null default 'not_ready',
  add column if not exists marketing_paused_until timestamptz;

alter table public.contacts
  drop constraint if exists contacts_marketing_status_check;

alter table public.contacts
  add constraint contacts_marketing_status_check
  check (
    marketing_status in (
      'not_ready',
      'ready_to_draft',
      'draft_created',
      'ready_to_send',
      'sent',
      'followup_due',
      'paused',
      'unsubscribed'
    )
  );

create index if not exists contacts_user_marketing_status_idx
  on public.contacts(user_id, marketing_status);

create index if not exists contacts_user_marketing_paused_idx
  on public.contacts(user_id, marketing_paused_until)
  where marketing_paused_until is not null;
