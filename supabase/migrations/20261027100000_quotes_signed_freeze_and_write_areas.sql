-- Preventivi: cosa resta fermo dopo la firma e chi puo' scrivere.
--
-- 1. Un preventivo accettato o firmato (contract_accepted_at) non cambia piu'
--    righe, importi, IVA, acconto, valuta ne' tipo di pagamento. L'API lo
--    rifiuta gia' con un messaggio chiaro; il trigger vale anche per chi scrive
--    direttamente con la propria sessione (REST di Supabase), che prima poteva
--    far pagare un'offerta diversa da quella firmata.
-- 2. Le policy restano quelle di prima per la lettura (la coda "Oggi" mostra
--    ai collaboratori i preventivi inviati dei loro contatti), ma creare e
--    modificare richiede l'area Preventivi, e cancellare resta al titolare.
--    Prima la policy era FOR ALL: bastava essere assegnati al contatto.
-- 3. business_goals segue l'area Finanza, come le API che lo usano.
--
-- Le aree di default (allowed_areas null) sono quelle di src/lib/areas.ts:
-- oggi, pipeline, contatti, followup. Cambiandole li', vanno cambiate qui.

create or replace function public.crm_member_has_area(p_workspace uuid, p_area text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.team_members tm
    where tm.user_id = p_workspace
      and (
        tm.auth_user_id = auth.uid()
        or (
          tm.email is not null
          and btrim(tm.email) <> ''
          and lower(btrim(tm.email)) = lower(btrim(coalesce(auth.jwt()->>'email', '')))
        )
      )
      and (
        p_area = 'oggi'
        or p_area = any(coalesce(tm.allowed_areas, array['pipeline', 'contatti', 'followup']::text[]))
      )
  )
$$;

-- La stessa condizione della policy di prima: collaboratore del workspace
-- responsabile o agente assegnato del contatto del preventivo.
create or replace function public.crm_is_contact_assignee(p_workspace uuid, p_contact uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.team_members tm
    join public.contacts c
      on c.id = p_contact
     and c.user_id = p_workspace
    where tm.user_id = p_workspace
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
$$;

revoke all on function public.crm_member_has_area(uuid, text) from public, anon;
revoke all on function public.crm_is_contact_assignee(uuid, uuid) from public, anon;
grant execute on function public.crm_member_has_area(uuid, text) to authenticated, service_role;
grant execute on function public.crm_is_contact_assignee(uuid, uuid) to authenticated, service_role;

drop policy if exists "quotes_workspace" on public.quotes;
drop policy if exists "quotes_select" on public.quotes;
drop policy if exists "quotes_insert" on public.quotes;
drop policy if exists "quotes_update" on public.quotes;
drop policy if exists "quotes_delete" on public.quotes;

create policy "quotes_select"
on public.quotes
for select to authenticated
using (
  auth.uid() = user_id
  or public.crm_is_contact_assignee(user_id, contact_id)
);

create policy "quotes_insert"
on public.quotes
for insert to authenticated
with check (
  auth.uid() = user_id
  or (
    public.crm_member_has_area(user_id, 'preventivi')
    and public.crm_is_contact_assignee(user_id, contact_id)
  )
);

create policy "quotes_update"
on public.quotes
for update to authenticated
using (
  auth.uid() = user_id
  or (
    public.crm_member_has_area(user_id, 'preventivi')
    and public.crm_is_contact_assignee(user_id, contact_id)
  )
)
with check (
  auth.uid() = user_id
  or (
    public.crm_member_has_area(user_id, 'preventivi')
    and public.crm_is_contact_assignee(user_id, contact_id)
  )
);

create policy "quotes_delete"
on public.quotes
for delete to authenticated
using (auth.uid() = user_id);

drop policy if exists "business_goals_workspace" on public.business_goals;
create policy "business_goals_workspace"
on public.business_goals
for all to authenticated
using (
  auth.uid() = user_id
  or public.crm_member_has_area(user_id, 'finanza')
)
with check (
  auth.uid() = user_id
  or public.crm_member_has_area(user_id, 'finanza')
);

create or replace function public.quotes_freeze_signed_amounts()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.contract_accepted_at is not null and (
    new.items is distinct from old.items
    or new.currency is distinct from old.currency
    or new.subtotal_amount is distinct from old.subtotal_amount
    or new.discount_amount is distinct from old.discount_amount
    or new.tax_rate is distinct from old.tax_rate
    or new.tax_amount is distinct from old.tax_amount
    or new.total_amount is distinct from old.total_amount
    or new.payment_terms_mode is distinct from old.payment_terms_mode
    or new.deposit_percent is distinct from old.deposit_percent
    or new.deposit_manual_amount is distinct from old.deposit_manual_amount
    or new.deposit_amount is distinct from old.deposit_amount
    or new.balance_amount is distinct from old.balance_amount
    or new.billing_interval is distinct from old.billing_interval
  ) then
    raise exception 'Il preventivo è già stato accettato: righe e importi non si possono più cambiare. Duplica il preventivo per proporre un''offerta diversa.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists quotes_freeze_signed_amounts on public.quotes;
create trigger quotes_freeze_signed_amounts
before update on public.quotes
for each row execute function public.quotes_freeze_signed_amounts();
