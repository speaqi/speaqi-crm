-- Separa il bacino (event_tag = 'wine-project') dall'ingresso in sequenza.
-- daily_send_cap resta il tetto sugli invii totali, follow-up inclusi;
-- daily_enrollment_cap governa quanti contatti nuovi entrano ogni giorno.
alter table public.wine_project_automation_settings
  add column if not exists daily_enrollment_cap integer not null default 30;

alter table public.wine_project_automation_settings
  drop constraint if exists wine_project_automation_settings_daily_enrollment_cap_check;

alter table public.wine_project_automation_settings
  add constraint wine_project_automation_settings_daily_enrollment_cap_check
  check (daily_enrollment_cap between 1 and 5000);

comment on column public.wine_project_automation_settings.daily_enrollment_cap is
  'Contatti nuovi immessi in sequenza ogni giorno. Distinto da daily_send_cap, che limita gli invii totali.';

-- L''arruolamento conta le email 1 create oggi e scorre il bacino per id.
create index if not exists wine_project_followup_events_enrollment_idx
  on public.wine_project_followup_events(user_id, sequence, created_at);
