alter table public.acumbamail_campaigns
  add column if not exists campaign_id text,
  add column if not exists last_synced_at timestamptz,
  add column if not exists last_sync_error text;

update public.acumbamail_campaigns
set campaign_id = '3796370'
where campaign_key = 'comuni-giugno-2026'
  and campaign_id is null;
