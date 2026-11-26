-- Agente Distribuzione: il contatto dei partner di Tourism Intelligence, dal primo invio alla risposta.
--
-- Una riga per ente (`distribution_outreach`), una riga per email della sequenza
-- (`distribution_outreach_messages`, al massimo tre). L'agente prepara i messaggi; con il
-- pilota acceso ognuno aspetta il clic del titolare (uscita dell'Ufficio, anche da Telegram),
-- poi l'invio parte dal job `distribution-outreach` in orario d'ufficio, entro un tetto
-- giornaliero prenotato qui sotto in modo atomico. Solo aggiunte: nessuna tabella esistente cambia.

create table if not exists public.distribution_outreach (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entity_id uuid not null references public.tourism_entities(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  deal_id uuid references public.deals(id) on delete set null,
  email text not null check (email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  email_domain text not null check (char_length(email_domain) between 3 and 255),
  guide_slug text,
  segment text not null check (segment in ('operator','agency','hospitality','transport','other')),
  language text not null default 'it' check (language in ('it','en')),
  status text not null default 'active' check (status in ('active','replied','bounced','stopped','completed')),
  stop_reason text check (stop_reason is null or char_length(stop_reason) <= 500),
  step int not null default 0 check (step between 0 and 3),
  next_due_at timestamptz,
  gmail_thread_id text,
  last_rfc_message_id text,
  last_sent_at timestamptz,
  last_checked_at timestamptz,
  reply jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, entity_id)
);
create index if not exists distribution_outreach_active_idx on public.distribution_outreach(user_id, status, next_due_at);
create index if not exists distribution_outreach_domain_idx on public.distribution_outreach(user_id, email_domain);

create table if not exists public.distribution_outreach_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  outreach_id uuid not null references public.distribution_outreach(id) on delete cascade,
  step int not null check (step between 1 and 3),
  subject text not null check (char_length(subject) between 1 and 200),
  body_text text not null check (char_length(body_text) between 20 and 6000),
  status text not null default 'pending'
    check (status in ('pending','approved','sending','sent','unknown','failed','skipped')),
  output_id uuid,
  approved_at timestamptz,
  claimed_at timestamptz,
  sent_at timestamptz,
  gmail_message_id text,
  rfc_message_id text,
  error text check (error is null or char_length(error) <= 1000),
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (outreach_id, step)
);
create index if not exists distribution_messages_queue_idx on public.distribution_outreach_messages(user_id, status, approved_at);
create index if not exists distribution_messages_claimed_idx on public.distribution_outreach_messages(user_id, claimed_at) where claimed_at is not null;

alter table public.distribution_outreach enable row level security;
alter table public.distribution_outreach_messages enable row level security;
drop policy if exists distribution_outreach_read on public.distribution_outreach;
create policy distribution_outreach_read on public.distribution_outreach for select to authenticated using (user_id = auth.uid());
drop policy if exists distribution_messages_read on public.distribution_outreach_messages;
create policy distribution_messages_read on public.distribution_outreach_messages for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete on public.distribution_outreach, public.distribution_outreach_messages from anon, authenticated;

-- Prende un messaggio approvato per l'invio, solo se il tetto del giorno (fuso di Roma) non è pieno.
-- Conta anche gli invii incerti: un esito non noto è una mail che potrebbe essere partita.
create or replace function public.claim_distribution_message(p_user_id uuid, p_message_id uuid, p_cap int)
returns boolean language plpgsql security definer set search_path = '' as $$
declare day_start timestamptz; used int; claimed uuid;
begin
  if p_cap is null or p_cap < 0 then raise exception 'Tetto non valido'; end if;
  perform pg_advisory_xact_lock(hashtext(p_user_id::text || ':distribution-send'));
  day_start := (date_trunc('day', now() at time zone 'Europe/Rome')) at time zone 'Europe/Rome';
  select count(*) into used from public.distribution_outreach_messages
    where user_id = p_user_id and claimed_at >= day_start and status in ('sending','sent','unknown');
  if used >= p_cap then return false; end if;
  update public.distribution_outreach_messages
    set status = 'sending', claimed_at = now(), attempts = attempts + 1, updated_at = now()
    where id = p_message_id and user_id = p_user_id and status = 'approved'
    returning id into claimed;
  return claimed is not null;
end $$;

revoke all on function public.claim_distribution_message(uuid, uuid, int) from public, anon, authenticated;
grant execute on function public.claim_distribution_message(uuid, uuid, int) to service_role;
