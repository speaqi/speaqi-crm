alter table public.contacts
  drop constraint if exists contacts_contact_scope_check;

alter table public.contacts
  add column if not exists personal_section text,
  add constraint contacts_contact_scope_check
    check (contact_scope in ('crm', 'holding', 'personal'));

create index if not exists contacts_user_personal_section_idx
on public.contacts(user_id, personal_section, updated_at desc)
where contact_scope = 'personal';
