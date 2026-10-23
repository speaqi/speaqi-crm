-- Preventivi fatturati fuori dal CRM, prima che la fatturazione esistesse qui.
-- «Da fatturare» in /fatture li elenca finche' non hanno una fattura: questa
-- colonna li toglie senza crearne una (il numero resta quello di Aruba).
alter table public.quotes add column if not exists invoiced_outside_at timestamptz;
