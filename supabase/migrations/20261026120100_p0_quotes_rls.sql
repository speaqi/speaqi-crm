-- P0: chiudere la scrittura diretta dei collaboratori sui preventivi e
-- togliere definitivamente il token di firma da `quotes`.
--
-- Da eseguire DOPO il deploy del codice che legge/scrive quote_secrets.
-- Prima di questa migration il token è già stato copiato in quote_secrets.
-- Il trigger della prima migration sincronizza anche le scritture legacy
-- avvenute durante il deploy. Non sovrascrivere qui i secret più recenti.

update public.quotes
set quote_acceptance_token = null
where quote_acceptance_token is not null;

-- Dopo il deploy nessun percorso pubblico deve registrare sessioni Stripe.
revoke all on function public.mark_quote_checkout_created(text, text, text)
  from public, anon, authenticated;
grant execute on function public.mark_quote_checkout_created(text, text, text) to service_role;

-- ── Preventivi ─────────────────────────────────────────────────────────────
-- Proprietario: accesso completo.
-- Collaboratore assegnato: sola lettura, così le API possono mostrare il
-- preventivo ma non modificarlo (le route di scrittura sono già owner-only).

drop policy if exists "quotes_workspace" on public.quotes;
drop policy if exists "quotes_owner_all" on public.quotes;
create policy "quotes_owner_all"
on public.quotes
for all to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "quotes_collaborator_read" on public.quotes;
create policy "quotes_collaborator_read"
on public.quotes
for select to authenticated
using (
  exists (
    select 1
    from public.team_members tm
    join public.contacts c
      on c.id = quotes.contact_id
     and c.user_id = quotes.user_id
    where tm.user_id = quotes.user_id
      and (
        tm.auth_user_id = auth.uid()
        or (
          tm.email is not null
          and btrim(tm.email) <> ''
          and lower(btrim(tm.email)) = lower(btrim(coalesce(auth.jwt()->>'email', '')))
        )
      )
      and (
        lower(btrim(coalesce(c.responsible, ''))) = lower(btrim(tm.name))
        or lower(btrim(coalesce(c.assigned_agent, ''))) = lower(btrim(tm.name))
      )
  )
);

-- ── Obiettivi aziendali ───────────────────────────────────────────────────
-- Erano leggibili e scrivibili da qualsiasi collaboratore del workspace,
-- anche senza area finanza. Ora servono l'area `finanza` esplicita
-- (allowed_areas), come già fa l'API /api/finance/goals.

drop policy if exists "business_goals_workspace" on public.business_goals;
drop policy if exists "business_goals_owner" on public.business_goals;
create policy "business_goals_owner"
on public.business_goals
for all to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "business_goals_finanza" on public.business_goals;
create policy "business_goals_finanza"
on public.business_goals
for all to authenticated
using (
  exists (
    select 1
    from public.team_members tm
    where tm.user_id = business_goals.user_id
      and (
        tm.auth_user_id = auth.uid()
        or (
          tm.email is not null
          and btrim(tm.email) <> ''
          and lower(btrim(tm.email)) = lower(btrim(coalesce(auth.jwt()->>'email', '')))
        )
      )
      and 'finanza' = any(coalesce(tm.allowed_areas, '{}'::text[]))
  )
)
with check (
  exists (
    select 1
    from public.team_members tm
    where tm.user_id = business_goals.user_id
      and (
        tm.auth_user_id = auth.uid()
        or (
          tm.email is not null
          and btrim(tm.email) <> ''
          and lower(btrim(tm.email)) = lower(btrim(coalesce(auth.jwt()->>'email', '')))
        )
      )
      and 'finanza' = any(coalesce(tm.allowed_areas, '{}'::text[]))
  )
);
