-- Allow collaborator accounts (matched by team_members.email) to work inside owner's workspace
-- while restricting access to contacts assigned to that collaborator.

-- Contacts
DROP POLICY IF EXISTS "contacts_owner" ON public.contacts;
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
      AND lower(coalesce(tm.email, '')) = lower(coalesce(auth.jwt()->>'email', ''))
      AND contacts.responsible = tm.name
  )
)
WITH CHECK (
  auth.uid() = user_id
  OR EXISTS (
    SELECT 1
    FROM public.team_members tm
    WHERE tm.user_id = contacts.user_id
      AND lower(coalesce(tm.email, '')) = lower(coalesce(auth.jwt()->>'email', ''))
      AND contacts.responsible = tm.name
  )
);

-- Tasks
DROP POLICY IF EXISTS "tasks_owner" ON public.tasks;
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
      AND lower(coalesce(tm.email, '')) = lower(coalesce(auth.jwt()->>'email', ''))
      AND c.responsible = tm.name
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
      AND lower(coalesce(tm.email, '')) = lower(coalesce(auth.jwt()->>'email', ''))
      AND c.responsible = tm.name
  )
);

-- Activities
DROP POLICY IF EXISTS "activities_owner" ON public.activities;
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
      AND lower(coalesce(tm.email, '')) = lower(coalesce(auth.jwt()->>'email', ''))
      AND c.responsible = tm.name
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
      AND lower(coalesce(tm.email, '')) = lower(coalesce(auth.jwt()->>'email', ''))
      AND c.responsible = tm.name
  )
);

-- Pipeline stages: collaborators can read owner pipeline, only owner can mutate.
DROP POLICY IF EXISTS "pipeline_stages_owner" ON public.pipeline_stages;
DROP POLICY IF EXISTS "pipeline_stages_read_workspace" ON public.pipeline_stages;
DROP POLICY IF EXISTS "pipeline_stages_insert_owner" ON public.pipeline_stages;
DROP POLICY IF EXISTS "pipeline_stages_update_owner" ON public.pipeline_stages;
DROP POLICY IF EXISTS "pipeline_stages_delete_owner" ON public.pipeline_stages;

CREATE POLICY "pipeline_stages_read_workspace"
ON public.pipeline_stages
FOR SELECT TO authenticated
USING (
  auth.uid() = user_id
  OR EXISTS (
    SELECT 1
    FROM public.team_members tm
    WHERE tm.user_id = pipeline_stages.user_id
      AND lower(coalesce(tm.email, '')) = lower(coalesce(auth.jwt()->>'email', ''))
  )
);

CREATE POLICY "pipeline_stages_insert_owner"
ON public.pipeline_stages
FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "pipeline_stages_update_owner"
ON public.pipeline_stages
FOR UPDATE TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "pipeline_stages_delete_owner"
ON public.pipeline_stages
FOR DELETE TO authenticated
USING (auth.uid() = user_id);
