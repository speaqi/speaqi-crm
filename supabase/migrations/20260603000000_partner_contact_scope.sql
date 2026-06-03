alter table public.contacts
  drop constraint if exists contacts_contact_scope_check;

alter table public.contacts
  add constraint contacts_contact_scope_check
    check (contact_scope in ('crm', 'holding', 'personal', 'partner'));
