-- Sposta il kill switch degli invii reali dalla variabile d'ambiente
-- WINE_PROJECT_CAMPAIGN_SEND_ENABLED a una colonna, così l'admin lo controlla
-- dalla dashboard CRM senza toccare Railway.
alter table public.wine_project_automation_settings
  add column if not exists campaign_send_enabled boolean not null default false;

comment on column public.wine_project_automation_settings.campaign_send_enabled is
  'Master switch per gli invii reali via Acumbamail. Distinto da enabled: enabled mette in pausa tutta la sequenza (arruolamento incluso), questo governa solo se il passo di invio puo'' effettivamente spedire.';
