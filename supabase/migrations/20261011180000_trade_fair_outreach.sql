-- Mailing agli espositori: l'email preparata (oggetto, testo, lingua), se e'
-- selezionata per l'invio e l'esito. Un espositore diventa contatto del CRM solo
-- se risponde o lo si aggiunge a mano.
alter table public.trade_fair_exhibitors
  add column if not exists outreach jsonb not null default '{}'::jsonb check (jsonb_typeof(outreach) = 'object');
