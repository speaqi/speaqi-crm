-- Diagnostica visibilità collaboratore (RLS + assegnazione)
-- Esegui in Supabase → SQL Editor (ruolo postgres: bypassa RLS).
--
-- Modifica email/nome nel CTE `params` di ogni blocco, oppure cerca/sostituisci qui:
--   pierpaoloizzo@speaqi.com
--   PierPaolo Izzo

-- ─── 1) Scheda team + utente auth (email) ─────────────────────────────────────
WITH params AS (
  SELECT
    'pierpaoloizzo@speaqi.com'::text AS pierpaolo_email,
    'PierPaolo Izzo'::text AS pierpaolo_name
),
team_row AS (
  SELECT tm.*
  FROM public.team_members tm, params p
  WHERE lower(btrim(tm.email)) = lower(btrim(p.pierpaolo_email))
     OR lower(btrim(tm.name)) = lower(btrim(p.pierpaolo_name))
)
SELECT
  tr.id AS team_member_id,
  tr.user_id AS workspace_owner_id,
  tr.name,
  tr.email,
  tr.auth_user_id AS team_auth_user_id,
  au.id AS auth_users_id,
  au.email AS auth_users_email,
  (tr.auth_user_id IS NOT DISTINCT FROM au.id) AS auth_uid_allineato
FROM team_row tr
LEFT JOIN auth.users au ON lower(btrim(au.email)) = lower(btrim(tr.email));

-- ─── 2) Conteggi contatti assegnati al collaboratore (per scope) ─────────────
WITH params AS (
  SELECT
    'pierpaoloizzo@speaqi.com'::text AS pierpaolo_email,
    'PierPaolo Izzo'::text AS pierpaolo_name
),
team_row AS (
  SELECT tm.*
  FROM public.team_members tm, params p
  WHERE lower(btrim(tm.email)) = lower(btrim(p.pierpaolo_email))
     OR lower(btrim(tm.name)) = lower(btrim(p.pierpaolo_name))
  LIMIT 1
)
SELECT
  tr.user_id AS workspace_owner_id,
  count(*) FILTER (WHERE c.contact_scope = 'crm') AS crm_scope,
  count(*) FILTER (WHERE c.contact_scope = 'holding') AS holding_scope,
  count(*) FILTER (WHERE c.contact_scope = 'personal') AS personal_scope,
  count(*) AS totale_righe_assegnate
FROM team_row tr
JOIN public.contacts c ON c.user_id = tr.user_id
WHERE
  lower(btrim(coalesce(c.responsible, ''))) = lower(btrim(tr.name))
  OR lower(btrim(coalesce(c.assigned_agent, ''))) = lower(btrim(tr.name))
GROUP BY tr.user_id;

-- ─── 3) Contatti stesso workspace ma NON assegnati (RLS li nasconde) ──────────
WITH params AS (
  SELECT
    'pierpaoloizzo@speaqi.com'::text AS pierpaolo_email,
    'PierPaolo Izzo'::text AS pierpaolo_name
),
team_row AS (
  SELECT tm.*
  FROM public.team_members tm, params p
  WHERE lower(btrim(tm.email)) = lower(btrim(p.pierpaolo_email))
     OR lower(btrim(tm.name)) = lower(btrim(p.pierpaolo_name))
  LIMIT 1
)
SELECT
  tr.user_id AS workspace_owner_id,
  count(*) AS contatti_non_assegnati_a_questo_nome
FROM team_row tr
JOIN public.contacts c ON c.user_id = tr.user_id
WHERE
  NOT (
    lower(btrim(coalesce(c.responsible, ''))) = lower(btrim(tr.name))
    OR lower(btrim(coalesce(c.assigned_agent, ''))) = lower(btrim(tr.name))
  )
GROUP BY tr.user_id;

-- ─── 4) Task pending su contatti assegnati ───────────────────────────────────
WITH params AS (
  SELECT
    'pierpaoloizzo@speaqi.com'::text AS pierpaolo_email,
    'PierPaolo Izzo'::text AS pierpaolo_name
),
team_row AS (
  SELECT tm.*
  FROM public.team_members tm, params p
  WHERE lower(btrim(tm.email)) = lower(btrim(p.pierpaolo_email))
     OR lower(btrim(tm.name)) = lower(btrim(p.pierpaolo_name))
  LIMIT 1
)
SELECT
  tr.user_id AS workspace_owner_id,
  count(*) AS task_pending
FROM team_row tr
JOIN public.contacts c ON c.user_id = tr.user_id
JOIN public.tasks t ON t.contact_id = c.id AND t.user_id = c.user_id
WHERE t.status = 'pending'
  AND (
    lower(btrim(coalesce(c.responsible, ''))) = lower(btrim(tr.name))
    OR lower(btrim(coalesce(c.assigned_agent, ''))) = lower(btrim(tr.name))
  )
GROUP BY tr.user_id;

-- ─── 5) next_followup_at su contatti assegnati (calendario “Oggi”) ────────────
WITH params AS (
  SELECT
    'pierpaoloizzo@speaqi.com'::text AS pierpaolo_email,
    'PierPaolo Izzo'::text AS pierpaolo_name
),
team_row AS (
  SELECT tm.*
  FROM public.team_members tm, params p
  WHERE lower(btrim(tm.email)) = lower(btrim(p.pierpaolo_email))
     OR lower(btrim(tm.name)) = lower(btrim(p.pierpaolo_name))
  LIMIT 1
)
SELECT
  tr.user_id AS workspace_owner_id,
  count(*) FILTER (WHERE c.next_followup_at IS NOT NULL) AS con_prossimo_followup,
  count(*) FILTER (WHERE c.next_followup_at IS NULL) AS senza_prossimo_followup
FROM team_row tr
JOIN public.contacts c ON c.user_id = tr.user_id
WHERE
  lower(btrim(coalesce(c.responsible, ''))) = lower(btrim(tr.name))
  OR lower(btrim(coalesce(c.assigned_agent, ''))) = lower(btrim(tr.name))
GROUP BY tr.user_id;

-- ─── 6) Valori distinti di responsible / assigned_agent che matchano ────────
WITH params AS (
  SELECT
    'pierpaoloizzo@speaqi.com'::text AS pierpaolo_email,
    'PierPaolo Izzo'::text AS pierpaolo_name
),
team_row AS (
  SELECT tm.*
  FROM public.team_members tm, params p
  WHERE lower(btrim(tm.email)) = lower(btrim(p.pierpaolo_email))
     OR lower(btrim(tm.name)) = lower(btrim(p.pierpaolo_name))
  LIMIT 1
)
SELECT
  c.responsible,
  c.assigned_agent,
  count(*) AS cnt
FROM team_row tr
JOIN public.contacts c ON c.user_id = tr.user_id
WHERE
  lower(btrim(coalesce(c.responsible, ''))) = lower(btrim(tr.name))
  OR lower(btrim(coalesce(c.assigned_agent, ''))) = lower(btrim(tr.name))
GROUP BY c.responsible, c.assigned_agent
ORDER BY cnt DESC
LIMIT 40;
