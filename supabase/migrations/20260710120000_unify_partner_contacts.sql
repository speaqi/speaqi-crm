-- Unificazione partner/clienti: "partner" diventa un attributo del contatto
-- (is_partner) invece di uno scope esclusivo. Un partner può quindi stare in
-- pipeline ed essere anche cliente. L'esclusione dalla pipeline passa al flag
-- per-contatto `hidden`.

alter table public.contacts
  add column if not exists is_partner boolean not null default false;

create index if not exists contacts_user_partner_idx
  on public.contacts(user_id, is_partner)
  where is_partner;

-- Backfill: i contatti in scope partner diventano contatti CRM flaggati partner.
-- Restano visibili in pipeline SOLO se hanno già un prossimo passo (follow-up o
-- task pendente) — così i promemoria legati ai partner riemergono subito; gli
-- altri partono nascosti (hidden) e si possono mostrare quando serve.
update public.contacts c
set is_partner = true,
    contact_scope = 'crm',
    hidden = not (
      c.next_followup_at is not null
      or exists (
        select 1 from public.tasks t
        where t.contact_id = c.id and t.status = 'pending'
      )
    )
where c.contact_scope = 'partner';

alter table public.contacts
  drop constraint if exists contacts_contact_scope_check;

alter table public.contacts
  add constraint contacts_contact_scope_check
    check (contact_scope in ('crm', 'holding', 'personal'));

-- Supertop era un livello di importanza travestito da stadio pipeline:
-- diventa priorità massima su uno stadio reale.
update public.contacts
set priority = 3,
    status = 'Interested'
where status = 'Supertop';

delete from public.pipeline_stages
where system_key = 'supertop' or name = 'Supertop';
