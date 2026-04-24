-- Let collaborators read team_members for workspaces they belong to (JWT / auth_user_id),
-- so API routes can resolve workspace without service_role on every request.

CREATE OR REPLACE FUNCTION public.is_team_member_of_workspace(p_workspace_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.team_members tm
    WHERE tm.user_id = p_workspace_user_id
      AND (
        tm.auth_user_id IS NOT NULL AND tm.auth_user_id = auth.uid()
        OR (
          tm.email IS NOT NULL
          AND btrim(tm.email) <> ''
          AND lower(btrim(tm.email)) = lower(btrim(coalesce(auth.jwt()->>'email', '')))
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION public.is_team_member_of_workspace(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_team_member_of_workspace(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_team_member_of_workspace(uuid) TO service_role;

DROP POLICY IF EXISTS "team_members_owner" ON public.team_members;

CREATE POLICY "team_members_select"
ON public.team_members
FOR SELECT
TO authenticated
USING (
  auth.uid() = user_id
  OR public.is_team_member_of_workspace(user_id)
);

CREATE POLICY "team_members_insert"
ON public.team_members
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "team_members_update"
ON public.team_members
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "team_members_delete"
ON public.team_members
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);
