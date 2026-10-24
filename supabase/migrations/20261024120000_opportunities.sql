-- Un solo percorso per le opportunità: si estende deals, non si crea un secondo CRM.
-- Le 1.060 trattative di oggi restano nella pipeline 'vendite', con le fasi di
-- sempre e lo specchio su contacts.status. Le pipeline nuove (tourism,
-- distribuzione, agency) hanno fasi proprie e non toccano lo stato del contatto.

alter table public.deals
  add column if not exists pipeline text not null default 'vendite',
  add column if not exists entity_id uuid references public.tourism_entities(id) on delete set null,
  add column if not exists role text,
  add column if not exists map_ref text,
  add column if not exists agency_project_id uuid references public.agency_projects(id) on delete set null,
  -- Un solo responsabile: il nome di un membro del team oppure agent:<id>.
  add column if not exists owner text,
  add column if not exists next_step text,
  add column if not exists next_step_due timestamptz,
  -- Perché è un'opportunità: [{ kind, text, source_url, at }], mai numeri senza fonte.
  add column if not exists evidence jsonb not null default '[]'::jsonb,
  add column if not exists potential_value numeric(12,2),
  add column if not exists potential_value_source text,
  add column if not exists stage_changed_at timestamptz,
  -- Accordo firmato e partner attivo sono due fatti diversi.
  add column if not exists signed_at timestamptz,
  add column if not exists activated_at timestamptz;

do $$ begin
  alter table public.deals add constraint deals_pipeline_check
    check (pipeline in ('vendite','tourism','distribuzione','agency'));
  alter table public.deals add constraint deals_role_check
    check (role is null or role in ('destinazione','distributore','cliente_agenzia','cliente_mappe'));
  alter table public.deals add constraint deals_new_pipeline_stage_check
    check (pipeline = 'vendite' or stage in ('scoperta','qualificata','proposta','trattativa','firmato','attivazione','attiva','persa','ferma'));
  alter table public.deals add constraint deals_owner_check
    check (owner is null or owner ~ '^agent:[a-z_]{2,40}$' or char_length(btrim(owner)) between 1 and 120);
  alter table public.deals add constraint deals_next_step_check
    check (next_step is null or char_length(next_step) <= 300);
  alter table public.deals add constraint deals_evidence_check
    check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) <= 50);
  alter table public.deals add constraint deals_map_ref_check
    check (map_ref is null or char_length(map_ref) between 1 and 120);
  alter table public.deals add constraint deals_potential_value_check
    check (potential_value is null or potential_value >= 0);
  alter table public.deals add constraint deals_activation_after_signature
    check (activated_at is null or signed_at is not null);
exception when duplicate_object then null; end $$;

-- Una trattativa aperta per contatto E per pipeline: lo stesso ente può avere
-- aperte la proposta della guida e quella della distribuzione.
create unique index if not exists deals_one_open_per_contact_pipeline
  on public.deals(contact_id, pipeline) where closed_at is null;
drop index if exists public.deals_one_open_per_contact;
create index if not exists deals_open_next_step_idx
  on public.deals(user_id, pipeline, next_step_due) where closed_at is null;

-- Una foreign key non guarda il proprietario: ente e progetto Agency devono
-- essere dello stesso workspace della trattativa.
create or replace function public.deals_same_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.entity_id is not null and not exists (select 1 from public.tourism_entities e where e.id = new.entity_id and e.user_id = new.user_id) then
    raise exception 'Ente di un altro workspace';
  end if;
  if new.agency_project_id is not null and not exists (select 1 from public.agency_projects p where p.id = new.agency_project_id and p.user_id = new.user_id) then
    raise exception 'Progetto Agency di un altro workspace';
  end if;
  if tg_op = 'INSERT' or new.stage is distinct from old.stage then new.stage_changed_at := now(); end if;
  return new;
end $$;
drop trigger if exists deals_same_owner on public.deals;
create trigger deals_same_owner before insert or update on public.deals
  for each row execute function public.deals_same_owner();

-- Ogni bozza email appartiene a un'opportunità: chi la prepara è il suo responsabile.
alter table public.email_drafts
  add column if not exists deal_id uuid references public.deals(id) on delete set null;
create index if not exists email_drafts_deal_idx on public.email_drafts(deal_id) where deal_id is not null;

-- Il Direttore ora fa il piano del giorno sulle opportunità: descrizione aggiornata
-- per chi l'ha già registrato (interruttore, budget e impostazioni restano come sono).
update public.office_agents
  set description = 'Ogni mattina il piano sulle opportunità: da lavorare, da sbloccare, partner da attivare. Mappe solo se servono.',
      schedule_job = 'office-director'
  where id = 'director';
