-- Align collaborator RLS with app logic: match team member by auth_user_id OR email;
-- case-insensitive trimmed match on responsible / assigned_agent vs team_members.name.

-- Contacts
DROP POLICY IF EXISTS "contacts_workspace" ON public.contacts;

CREATE POLICY "contacts_workspace"
ON public.contacts
FOR ALL TO authenticated
USING (
  auth.uid() = user_id
  OR EXISTS (
    SELECT 1
    FROM public.team_members tm
    WHERE tm.user_id = contacts.user_id
      AND (
        tm.auth_user_id = auth.uid()
        OR (
          tm.email IS NOT NULL
          AND btrim(tm.email) <> ''
          AND lower(btrim(tm.email)) = lower(btrim(coalesce(auth.jwt()->>'email', '')))
        )
      )
      AND (
        lower(btrim(coalesce(contacts.responsible, ''))) = lower(btrim(tm.name))
        OR lower(btrim(coalesce(contacts.assigned_agent, ''))) = lower(btrim(tm.name))
      )
  )
)
WITH CHECK (
  auth.uid() = user_id
  OR EXISTS (
    SELECT 1
    FROM public.team_members tm
    WHERE tm.user_id = contacts.user_id
      AND (
        tm.auth_user_id = auth.uid()
        OR (
          tm.email IS NOT NULL
          AND btrim(tm.email) <> ''
          AND lower(btrim(tm.email)) = lower(btrim(coalesce(auth.jwt()->>'email', '')))
        )
      )
      AND (
        lower(btrim(coalesce(contacts.responsible, ''))) = lower(btrim(tm.name))
        OR lower(btrim(coalesce(contacts.assigned_agent, ''))) = lower(btrim(tm.name))
      )
  )
);

-- Tasks
DROP POLICY IF EXISTS "tasks_workspace" ON public.tasks;

CREATE POLICY "tasks_workspace"
ON public.tasks
FOR ALL TO authenticated
USING (
  auth.uid() = user_id
  OR EXISTS (
    SELECT 1
    FROM public.team_members tm
    JOIN public.contacts c
      ON c.id = tasks.contact_id
     AND c.user_id = tasks.user_id
    WHERE tm.user_id = tasks.user_id
      AND (
        tm.auth_user_id = auth.uid()
        OR (
          tm.email IS NOT NULL
          AND btrim(tm.email) <> ''
          AND lower(btrim(tm.email)) = lower(btrim(coalesce(auth.jwt()->>'email', '')))
        )
      )
      AND (
        lower(btrim(coalesce(c.responsible, ''))) = lower(btrim(tm.name))
        OR lower(btrim(coalesce(c.assigned_agent, ''))) = lower(btrim(tm.name))
      )
  )
)
WITH CHECK (
  auth.uid() = user_id
  OR EXISTS (
    SELECT 1
    FROM public.team_members tm
    JOIN public.contacts c
      ON c.id = tasks.contact_id
     AND c.user_id = tasks.user_id
    WHERE tm.user_id = tasks.user_id
      AND (
        tm.auth_user_id = auth.uid()
        OR (
          tm.email IS NOT NULL
          AND btrim(tm.email) <> ''
          AND lower(btrim(tm.email)) = lower(btrim(coalesce(auth.jwt()->>'email', '')))
        )
      )
      AND (
        lower(btrim(coalesce(c.responsible, ''))) = lower(btrim(tm.name))
        OR lower(btrim(coalesce(c.assigned_agent, ''))) = lower(btrim(tm.name))
      )
  )
);

-- Activities
DROP POLICY IF EXISTS "activities_workspace" ON public.activities;

CREATE POLICY "activities_workspace"
ON public.activities
FOR ALL TO authenticated
USING (
  auth.uid() = user_id
  OR EXISTS (
    SELECT 1
    FROM public.team_members tm
    JOIN public.contacts c
      ON c.id = activities.contact_id
     AND c.user_id = activities.user_id
    WHERE tm.user_id = activities.user_id
      AND (
        tm.auth_user_id = auth.uid()
        OR (
          tm.email IS NOT NULL
          AND btrim(tm.email) <> ''
          AND lower(btrim(tm.email)) = lower(btrim(coalesce(auth.jwt()->>'email', '')))
        )
      )
      AND (
        lower(btrim(coalesce(c.responsible, ''))) = lower(btrim(tm.name))
        OR lower(btrim(coalesce(c.assigned_agent, ''))) = lower(btrim(tm.name))
      )
  )
)
WITH CHECK (
  auth.uid() = user_id
  OR EXISTS (
    SELECT 1
    FROM public.team_members tm
    JOIN public.contacts c
      ON c.id = activities.contact_id
     AND c.user_id = activities.user_id
    WHERE tm.user_id = activities.user_id
      AND (
        tm.auth_user_id = auth.uid()
        OR (
          tm.email IS NOT NULL
          AND btrim(tm.email) <> ''
          AND lower(btrim(tm.email)) = lower(btrim(coalesce(auth.jwt()->>'email', '')))
        )
      )
      AND (
        lower(btrim(coalesce(c.responsible, ''))) = lower(btrim(tm.name))
        OR lower(btrim(coalesce(c.assigned_agent, ''))) = lower(btrim(tm.name))
      )
  )
);

-- Pipeline stages: collaborators read owner pipeline when linked by auth_user_id or email
DROP POLICY IF EXISTS "pipeline_stages_read_workspace" ON public.pipeline_stages;

CREATE POLICY "pipeline_stages_read_workspace"
ON public.pipeline_stages
FOR SELECT TO authenticated
USING (
  auth.uid() = user_id
  OR EXISTS (
    SELECT 1
    FROM public.team_members tm
    WHERE tm.user_id = pipeline_stages.user_id
      AND (
        tm.auth_user_id = auth.uid()
        OR (
          tm.email IS NOT NULL
          AND btrim(tm.email) <> ''
          AND lower(btrim(tm.email)) = lower(btrim(coalesce(auth.jwt()->>'email', '')))
        )
      )
  )
);
