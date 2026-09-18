-- Le colonne scritte da recalcAndPersistScore() e /api/automation/score-leads
-- non sono mai state create. PostgREST rifiuta l'intera UPDATE quando contiene
-- una colonna inesistente, quindi nemmeno `score` veniva salvato e il cron
-- 09-score-leads falliva a ogni giro sul filtro `last_scored_at`.
alter table public.contacts
  add column if not exists engagement_score integer,
  add column if not exists fit_score integer,
  add column if not exists urgency_score integer,
  add column if not exists last_scored_at timestamptz;
