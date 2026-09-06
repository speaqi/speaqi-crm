-- Notifiche WhatsApp (gateway OpenWA self-hosted).
--
-- Ogni fatto che vale una notifica (email inviata, aperta, cliccata, risposta,
-- disiscrizione) finisce prima in coda qui e solo dopo diventa un messaggio
-- WhatsApp. Due ragioni: (1) le aperture e i click di una lista da migliaia di
-- cantine sono decine di eventi l'ora e un messaggio per evento farebbe
-- segnalare il numero, quindi il grosso esce come riepilogo periodico; (2) il
-- gateway e un servizio esterno che puo essere spento o disconnesso, e un
-- invio email non deve mai fallire per colpa sua: l'evento resta in coda con
-- notified_at null e il riepilogo successivo lo recupera.

create table if not exists public.whatsapp_notification_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  delivery text not null default 'digest',
  contact_id uuid references public.contacts(id) on delete set null,
  -- Copie del contatto al momento dell'evento: la scheda puo essere cancellata
  -- o riassegnata prima che il riepilogo parta, e il messaggio deve restare
  -- leggibile lo stesso.
  contact_label text,
  agent_name text,
  campaign text,
  detail text,
  source text,
  occurred_at timestamptz not null default now(),
  notified_at timestamptz,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'whatsapp_notification_events_type_check') then
    alter table public.whatsapp_notification_events
      add constraint whatsapp_notification_events_type_check
      check (event_type in ('email_sent', 'email_open', 'email_click', 'email_reply', 'email_unsubscribe'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'whatsapp_notification_events_delivery_check') then
    alter table public.whatsapp_notification_events
      add constraint whatsapp_notification_events_delivery_check
      check (delivery in ('digest', 'immediate'));
  end if;
end
$$;

-- Il riepilogo legge sempre e solo la coda non ancora notificata di un utente,
-- in ordine di accadimento.
create index if not exists whatsapp_notification_events_pending_idx
  on public.whatsapp_notification_events(user_id, occurred_at)
  where notified_at is null;

create index if not exists whatsapp_notification_events_recent_idx
  on public.whatsapp_notification_events(user_id, occurred_at desc);

alter table public.whatsapp_notification_events enable row level security;

drop policy if exists "whatsapp_notification_events_owner" on public.whatsapp_notification_events;
create policy "whatsapp_notification_events_owner" on public.whatsapp_notification_events
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Storico degli invii verso il gateway: senza questo, quando un messaggio non
-- arriva non si distingue "il CRM non l'ha mai mandato" da "WhatsApp non l'ha
-- consegnato".
create table if not exists public.whatsapp_notification_sends (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  chat_id text,
  body text,
  event_count integer not null default 0,
  ok boolean not null default false,
  provider_message_id text,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists whatsapp_notification_sends_recent_idx
  on public.whatsapp_notification_sends(user_id, created_at desc);

alter table public.whatsapp_notification_sends enable row level security;

drop policy if exists "whatsapp_notification_sends_owner" on public.whatsapp_notification_sends;
create policy "whatsapp_notification_sends_owner" on public.whatsapp_notification_sends
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

comment on table public.whatsapp_notification_events is
  'Coda degli eventi CRM da notificare su WhatsApp. delivery=immediate esce subito (risposte), delivery=digest confluisce nel riepilogo periodico di /api/automation/whatsapp-digest.';

comment on column public.whatsapp_notification_events.notified_at is
  'Valorizzato solo quando il messaggio WhatsApp e partito davvero. Un invio fallito lascia il campo null e l''evento rientra nel riepilogo successivo.';
