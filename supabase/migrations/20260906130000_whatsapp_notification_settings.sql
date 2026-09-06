-- Il destinatario delle notifiche WhatsApp esce dalle variabili d'ambiente e
-- entra nel CRM.
--
-- Con il numero nelle env cambiarlo significava toccare Railway e riavviare il
-- servizio: una cosa che si fa una volta e poi non si fa piu. Qui il numero,
-- l'interruttore e la scelta degli eventi stanno su una riga per workspace,
-- modificabile da /impostazioni/whatsapp.
--
-- Restano nelle env solo le credenziali del gateway (URL, API key, sessione),
-- che sono infrastruttura, e `WHATSAPP_NOTIFY_ENABLED=false` come freno di
-- emergenza che vince su qualunque interruttore dell'interfaccia.

create table if not exists public.whatsapp_notification_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  notify_to text,
  enabled boolean not null default false,
  -- null = tutti gli eventi. Un elenco esplicito serve a spegnere le aperture
  -- quando una campagna grossa le rende rumorose.
  events text[],
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.whatsapp_notification_settings enable row level security;

drop policy if exists "whatsapp_notification_settings_owner" on public.whatsapp_notification_settings;
create policy "whatsapp_notification_settings_owner" on public.whatsapp_notification_settings
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

comment on table public.whatsapp_notification_settings is
  'Destinatario e interruttore delle notifiche WhatsApp per workspace. Le credenziali del gateway OpenWA restano nelle env; da qui si governa a chi scrivere e cosa notificare.';

comment on column public.whatsapp_notification_settings.notify_to is
  'Numero destinatario in formato internazionale. Normalizzato a WID (39...@c.us) al momento dell''invio.';

comment on column public.whatsapp_notification_settings.events is
  'Sottoinsieme di eventi da notificare; null significa tutti.';
