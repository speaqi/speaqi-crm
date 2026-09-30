-- Aree del CRM visibili al collaboratore (Impostazioni → Team).
-- null = mai configurato → default applicativi (src/lib/areas.ts).
alter table public.team_members
  add column if not exists allowed_areas text[];
