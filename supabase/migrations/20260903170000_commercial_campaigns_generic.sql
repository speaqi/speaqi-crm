-- Motore campagne generico sopra `commercial_*`.
--
-- Le tabelle base (commercial_campaigns, _campaign_steps, _enrollments,
-- _messages, _suppressions, _import_batches) esistono gia: le crea
-- 20260828180000_hospitality_outreach.sql. Questa migration le rende
-- configurabili per verticale invece che cablate su Hospitality, e aggiunge le
-- garanzie che l'arruolamento automatico richiede: tetti separati e atomici,
-- soppressioni per email, immutabilita di slug e step gia usati.

-- Guardia esplicita: se le basi mancano, il messaggio deve dire quale
-- migration applicare, non fallire su una colonna inesistente.
do $$
begin
  if to_regclass('public.commercial_campaigns') is null then
    raise exception 'commercial_* mancanti: applicare prima 20260828180000_hospitality_outreach.sql';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Configurazione per campagna al posto delle costanti nel codice
-- ---------------------------------------------------------------------------

alter table public.commercial_campaigns
  add column if not exists slug text,
  add column if not exists brand_eyebrow text,
  add column if not exists landing_url text,
  -- Filtri di import generici. NULL = filtro assente: una campagna nuova non
  -- eredita criteri pensati per un altro verticale.
  add column if not exists import_exclude_keyword text,
  add column if not exists import_required_country text,
  -- Tetto arruolamenti, distinto da daily_cap che resta il tetto invii.
  add column if not exists daily_enrollment_cap integer not null default 30,
  -- Hospitality arruola solo contatti con base giuridica e data di acquisizione
  -- attestate. Era una condizione cablata nel codice: diventa configurazione,
  -- spenta per le campagne nuove e accesa per Hospitality dal backfill.
  add column if not exists require_marketing_attestation boolean not null default false;

alter table public.commercial_campaigns
  drop constraint if exists commercial_campaigns_daily_enrollment_cap_check;
alter table public.commercial_campaigns
  add constraint commercial_campaigns_daily_enrollment_cap_check
  check (daily_enrollment_cap between 1 and 5000);

alter table public.commercial_campaigns
  drop constraint if exists commercial_campaigns_slug_format_check;
alter table public.commercial_campaigns
  add constraint commercial_campaigns_slug_format_check
  check (slug is null or slug ~ '^[a-z0-9][a-z0-9-]{1,63}$');

comment on column public.commercial_campaigns.slug is
  'Prefisso delle chiavi Acumbamail e di utm_campaign. Immutabile una volta valorizzato.';
comment on column public.commercial_campaigns.brand_eyebrow is
  'Riga di intestazione nell''HTML dell''email.';
comment on column public.commercial_campaigns.landing_url is
  'Destinazione del bottone CTA. Sostituisce {{landing_url}} nei template.';
comment on column public.commercial_campaigns.import_exclude_keyword is
  'Se valorizzato, scarta dall''import i record che contengono la parola nel nome azienda. NULL = nessun filtro.';
comment on column public.commercial_campaigns.import_required_country is
  'Se valorizzato, solo i record di quel paese vengono iscritti; gli altri entrano col tag <event_tag>_en senza iscrizione. NULL = nessun filtro.';
comment on column public.commercial_campaigns.daily_cap is
  'Tetto invii per giorno solare. Distinto da daily_enrollment_cap.';
comment on column public.commercial_campaigns.daily_enrollment_cap is
  'Tetto arruolamenti nuovi per giorno solare. Distinto da daily_cap.';
comment on column public.commercial_campaigns.require_marketing_attestation is
  'Se vero, arruola solo contatti con marketing_legal_basis, marketing_source_acquired_at e hospitality_filter_decision = include.';

create unique index if not exists commercial_campaigns_user_slug_unique
  on public.commercial_campaigns(user_id, slug) where slug is not null;

-- Backfill: la campagna Hospitality esistente conserva esattamente i valori
-- che oggi vivono nel codice, cosi il comportamento non cambia.
update public.commercial_campaigns
set slug = coalesce(slug, 'hospitality'),
    brand_eyebrow = coalesce(brand_eyebrow, 'SPEAQI · HOSPITALITY EXPERIENCE'),
    landing_url = coalesce(landing_url, 'https://speaqi.com/demo/hotel-project'),
    require_marketing_attestation = true
where vertical = 'hospitality';

-- Le campagne preesistenti senza verticale hospitality prendono uno slug
-- derivato dal verticale, unico per utente.
update public.commercial_campaigns c
set slug = left(regexp_replace(lower(c.vertical || '-' || c.id::text), '[^a-z0-9-]+', '-', 'g'), 60)
where c.slug is null;

-- ---------------------------------------------------------------------------
-- 2. Soppressioni: unsubscribe, bounce e blacklist valgono anche per email
-- ---------------------------------------------------------------------------

alter table public.commercial_suppressions
  add column if not exists campaign_id uuid references public.commercial_campaigns(id) on delete cascade;

comment on column public.commercial_suppressions.campaign_id is
  'NULL = soppressione valida per tutto il workspace (blacklist). Valorizzato = solo per quella campagna.';

-- Una email soppressa non deve poter rientrare da un''altra struttura.
create unique index if not exists commercial_suppressions_user_email_unique
  on public.commercial_suppressions(user_id, lower(email))
  where email is not null and length(trim(email)) > 0 and campaign_id is null;

create index if not exists commercial_suppressions_email_lookup_idx
  on public.commercial_suppressions(user_id, lower(email));

-- ---------------------------------------------------------------------------
-- 3. Immutabilita: slug e step gia usati
-- ---------------------------------------------------------------------------

create or replace function public.commercial_campaign_slug_is_immutable()
returns trigger
language plpgsql
as $$
begin
  if old.slug is not null and new.slug is distinct from old.slug then
    raise exception 'commercial_campaign_slug_immutable'
      using hint = 'Lo slug entra nelle chiavi Acumbamail e negli UTM gia inviati: non puo cambiare.';
  end if;
  return new;
end;
$$;

drop trigger if exists commercial_campaigns_slug_immutable on public.commercial_campaigns;
create trigger commercial_campaigns_slug_immutable
  before update on public.commercial_campaigns
  for each row execute function public.commercial_campaign_slug_is_immutable();

create or replace function public.commercial_step_is_immutable_once_used()
returns trigger
language plpgsql
as $$
declare v_used boolean;
begin
  select exists (
    select 1
    from public.commercial_messages m
    join public.commercial_enrollments e on e.id = m.enrollment_id
    where e.campaign_id = old.campaign_id
      and m.step_number = old.step_number
      and m.status in ('sending', 'sent')
  ) into v_used;

  if not v_used then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'commercial_step_immutable'
      using hint = 'Lo step e gia stato inviato: non puo essere cancellato.';
  end if;

  if new.subject_template is distinct from old.subject_template
     or new.body_text_template is distinct from old.body_text_template
     or new.body_html_template is distinct from old.body_html_template
     or new.day_offset is distinct from old.day_offset
     or new.step_number is distinct from old.step_number then
    raise exception 'commercial_step_immutable'
      using hint = 'Lo step e gia stato inviato: il testo inviato deve restare quello registrato.';
  end if;
  return new;
end;
$$;

drop trigger if exists commercial_campaign_steps_immutable on public.commercial_campaign_steps;
create trigger commercial_campaign_steps_immutable
  before update or delete on public.commercial_campaign_steps
  for each row execute function public.commercial_step_is_immutable_once_used();

-- ---------------------------------------------------------------------------
-- 4. Tetti atomici: contatori giornalieri per campagna
-- ---------------------------------------------------------------------------

create table if not exists public.commercial_campaign_daily_counters (
  campaign_id uuid not null references public.commercial_campaigns(id) on delete cascade,
  local_day date not null,
  enrolled_reserved integer not null default 0 check (enrolled_reserved >= 0),
  enrolled_count integer not null default 0 check (enrolled_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (campaign_id, local_day)
);

alter table public.commercial_campaign_daily_counters enable row level security;

drop policy if exists "commercial_campaign_daily_counters_owner" on public.commercial_campaign_daily_counters;
create policy "commercial_campaign_daily_counters_owner" on public.commercial_campaign_daily_counters
  for all using (exists (
    select 1 from public.commercial_campaigns c where c.id = campaign_id and c.user_id = auth.uid()
  )) with check (exists (
    select 1 from public.commercial_campaigns c where c.id = campaign_id and c.user_id = auth.uid()
  ));

-- Prenotazione atomica dei posti di arruolamento. Il lock e sulla riga del
-- contatore, quindi per campagna e per giorno: due worker in parallelo non
-- possono superare daily_enrollment_cap.
create or replace function public.reserve_commercial_enrollment_slots(
  p_campaign_id uuid,
  p_wanted integer,
  p_local_day date default (now() at time zone 'Europe/Rome')::date
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cap integer;
  v_used integer;
  v_granted integer;
begin
  if coalesce(p_wanted, 0) < 1 then return 0; end if;

  select daily_enrollment_cap into v_cap
  from public.commercial_campaigns where id = p_campaign_id;
  if v_cap is null then return 0; end if;

  insert into public.commercial_campaign_daily_counters (campaign_id, local_day)
  values (p_campaign_id, p_local_day)
  on conflict (campaign_id, local_day) do nothing;

  select enrolled_reserved + enrolled_count into v_used
  from public.commercial_campaign_daily_counters
  where campaign_id = p_campaign_id and local_day = p_local_day
  for update;

  v_granted := greatest(0, least(p_wanted, v_cap - coalesce(v_used, 0)));
  if v_granted = 0 then return 0; end if;

  update public.commercial_campaign_daily_counters
  set enrolled_reserved = enrolled_reserved + v_granted, updated_at = now()
  where campaign_id = p_campaign_id and local_day = p_local_day;

  return v_granted;
end;
$$;

-- Chiusura della prenotazione: quanti posti sono diventati iscrizioni vere e
-- quanti tornano disponibili (conflitto, filtro, errore a meta strada).
create or replace function public.settle_commercial_enrollment_slots(
  p_campaign_id uuid,
  p_reserved integer,
  p_used integer,
  p_local_day date default (now() at time zone 'Europe/Rome')::date
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.commercial_campaign_daily_counters
  set enrolled_reserved = greatest(0, enrolled_reserved - greatest(0, coalesce(p_reserved, 0))),
      enrolled_count = enrolled_count + greatest(0, least(coalesce(p_used, 0), coalesce(p_reserved, 0))),
      updated_at = now()
  where campaign_id = p_campaign_id and local_day = p_local_day;
end;
$$;

revoke all on function public.reserve_commercial_enrollment_slots(uuid, integer, date) from public, anon, authenticated;
revoke all on function public.settle_commercial_enrollment_slots(uuid, integer, integer, date) from public, anon, authenticated;
grant execute on function public.reserve_commercial_enrollment_slots(uuid, integer, date) to service_role;
grant execute on function public.settle_commercial_enrollment_slots(uuid, integer, integer, date) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Claim invii: soppressioni per email e disiscritti esclusi alla fonte
-- ---------------------------------------------------------------------------

create or replace function public.claim_commercial_messages(
  p_campaign_id uuid,
  p_limit integer default 20,
  p_dry_run boolean default true
) returns setof public.commercial_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campaign public.commercial_campaigns%rowtype;
  v_remaining integer;
begin
  select * into v_campaign from public.commercial_campaigns where id = p_campaign_id for update;
  if not found then return; end if;
  if not p_dry_run and (v_campaign.status <> 'active' or v_campaign.approval_status <> 'approved') then
    raise exception 'campaign_not_active_or_approved';
  end if;

  -- daily_cap governa gli invii; l'arruolamento ha il suo tetto separato.
  select greatest(0, v_campaign.daily_cap - count(*)) into v_remaining
  from public.commercial_messages m
  join public.commercial_enrollments e on e.id = m.enrollment_id
  where e.campaign_id = p_campaign_id
    and (m.status = 'sending' or (m.status = 'sent' and m.sent_at >= date_trunc('day', now())));
  if v_remaining < 1 then return; end if;

  return query
    with due as (
      select m.id from public.commercial_messages m
      join public.commercial_enrollments e on e.id = m.enrollment_id
      join public.contacts ct on ct.id = e.contact_id
      where e.campaign_id = p_campaign_id and e.status in ('pending', 'active')
        and m.status = 'scheduled' and m.scheduled_at <= now()
        and e.unsubscribed_at is null and e.complained_at is null
        and ct.email_unsubscribed_at is null
        and ct.marketing_eligibility = 'eligible'
        and not exists (
          select 1 from public.commercial_suppressions s
          where s.user_id = v_campaign.user_id
            and (s.campaign_id is null or s.campaign_id = p_campaign_id)
            and (s.structure_key = e.structure_key
                 or lower(coalesce(s.email, '')) = lower(m.recipient_email))
        )
      order by m.scheduled_at, m.id
      for update of m skip locked
      limit least(greatest(p_limit, 1), v_remaining)
    ), claimed as (
      update public.commercial_messages m set status = case when p_dry_run then m.status else 'sending' end
      from due where m.id = due.id returning m.*
    ) select * from claimed;
end;
$$;

revoke all on function public.claim_commercial_messages(uuid, integer, boolean) from public, anon, authenticated;
grant execute on function public.claim_commercial_messages(uuid, integer, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- 6. Indici di supporto all'arruolamento
-- ---------------------------------------------------------------------------

create index if not exists contacts_campaign_enrollment_idx
  on public.contacts(user_id, event_tag, id)
  where email is not null;
create index if not exists commercial_enrollments_created_idx
  on public.commercial_enrollments(campaign_id, created_at);
