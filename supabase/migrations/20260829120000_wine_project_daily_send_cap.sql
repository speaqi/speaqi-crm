-- Il limite operativo della campagna Wine è configurato dal CRM, non da una
-- variabile d'ambiente. Il valore iniziale protegge il primo pilot da 100 invii.
alter table public.wine_project_automation_settings
  add column if not exists daily_send_cap integer not null default 100
  check (daily_send_cap between 1 and 5000);

comment on column public.wine_project_automation_settings.daily_send_cap is
  'Numero massimo di email Wine Project inviate per giorno solare Europe/Rome.';
