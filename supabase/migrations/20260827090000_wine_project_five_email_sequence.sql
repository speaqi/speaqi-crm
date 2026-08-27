-- Cinque tocchi commerciali Wine Project, con un secondo messaggio dedicato
-- alle cantine che non hanno aperto la prima comunicazione.

alter table public.wine_project_automation_settings
  add column if not exists fourth_followup_days integer not null default 16 check (fourth_followup_days between 4 and 75),
  add column if not exists fifth_followup_days integer not null default 28 check (fifth_followup_days between 5 and 90),
  add column if not exists sequence_templates jsonb;

alter table public.wine_project_automation_settings
  drop constraint if exists wine_project_automation_settings_check,
  drop constraint if exists wine_project_automation_settings_check1;

alter table public.wine_project_automation_settings
  add constraint wine_project_automation_settings_sequence_days_check
  check (
    second_followup_days > first_followup_days
    and third_followup_days > second_followup_days
    and fourth_followup_days > third_followup_days
    and fifth_followup_days > fourth_followup_days
  );

alter table public.wine_project_followup_events
  drop constraint if exists wine_project_followup_events_sequence_check;

alter table public.wine_project_followup_events
  add constraint wine_project_followup_events_sequence_check
  check (sequence between 1 and 5);

comment on column public.wine_project_automation_settings.sequence_templates is
  'Cinque modelli email Wine Project, modificabili dal CRM. La seconda email viene usata solo in assenza di aperture/click.';
