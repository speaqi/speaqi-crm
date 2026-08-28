-- Stato di consegna separato dalla semplice pianificazione: evita doppie
-- campagne in caso di retry dell'automazione n8n.
alter table public.wine_project_followup_events
  drop constraint if exists wine_project_followup_events_status_check;

alter table public.wine_project_followup_events
  add constraint wine_project_followup_events_status_check
  check (status in ('scheduled', 'queued', 'sending', 'sent', 'skipped', 'failed'));

alter table public.wine_project_followup_events
  add column if not exists sending_at timestamptz,
  add column if not exists sent_at timestamptz,
  add column if not exists campaign_id text,
  add column if not exists campaign_key text,
  add column if not exists delivery_error text;

create index if not exists wine_project_followup_events_delivery_idx
  on public.wine_project_followup_events(user_id, status, sequence, due_at);
