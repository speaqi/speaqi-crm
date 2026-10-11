-- Referente con cui si e' parlato allo stand (usato come nome del contatto CRM).
alter table public.trade_fair_exhibitors add column if not exists contact_person text;
