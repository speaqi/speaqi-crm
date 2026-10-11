-- Speaqi Opportunity Score (SOS) sugli espositori di una fiera.
-- I criteri sono l'opzione scelta/dedotta (null = sconosciuto, che NON e' uno
-- zero): l'algoritmo vive in src/lib/opportunity-score.ts e le colonne sono la
-- fotografia dell'ultimo calcolo, per filtrare ed esportare in SQL.
alter table public.trade_fair_exhibitors
  add column if not exists organization_type text,
  add column if not exists distribution_reach text,
  add column if not exists map_need text,
  add column if not exists budget_capacity text,
  add column if not exists commercial_potential text,
  add column if not exists international_audience text,
  add column if not exists decision_maker_access text,
  add column if not exists strategic_synergy text,
  add column if not exists opportunity_score smallint check (opportunity_score between 0 and 100),
  add column if not exists ttg_action_score smallint check (ttg_action_score between 0 and 50),
  add column if not exists ttg_priority_score numeric(5,1) check (ttg_priority_score between 0 and 100),
  add column if not exists lead_class text check (lead_class in ('S', 'A', 'B', 'C', 'D')),
  add column if not exists data_confidence text check (data_confidence in ('HIGH', 'MEDIUM', 'LOW')),
  add column if not exists recommended_action text,
  add column if not exists score_explanation text[] not null default '{}',
  add column if not exists last_scored_at timestamptz,
  -- Criteri impostati a mano: {criterio: {option, at}}. Vincono sulla deduzione.
  add column if not exists sos_manual jsonb not null default '{}'::jsonb check (jsonb_typeof(sos_manual) = 'object'),
  -- decision_maker_present, partner_intro, existing_client.
  add column if not exists ttg_flags jsonb not null default '{}'::jsonb check (jsonb_typeof(ttg_flags) = 'object'),
  -- Dopo l'incontro: interesse, budget plausibile, prossimo passo concordato.
  add column if not exists meeting_outcome jsonb not null default '{}'::jsonb check (jsonb_typeof(meeting_outcome) = 'object'),
  -- Storico delle modifiche manuali ai criteri: [{at, factor, from, to}].
  add column if not exists sos_history jsonb not null default '[]'::jsonb check (jsonb_typeof(sos_history) = 'array');

create index if not exists trade_fair_exhibitors_class_idx
  on public.trade_fair_exhibitors (user_id, fair, lead_class, ttg_priority_score desc);
