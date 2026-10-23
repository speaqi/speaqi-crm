-- La paginazione per id del set operativo deve evitare le 58k righe holding.
set local lock_timeout = '3s';
create index if not exists contacts_working_set_cursor_idx
  on public.contacts (user_id, id)
  where contact_scope is null or contact_scope in ('crm', 'personal');

-- Un solo passaggio sulle righe visibili via RLS, anziché otto count separati
-- più il conteggio cartelle. Nessuna service role o cache condivisa fra utenti.
create or replace function public.contact_workspace_summary(
  p_user_id uuid,
  p_member_name text default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with grouped as materialized (
    select c.contact_scope, c.hidden, c.is_partner, c.source, c.status,
      nullif(btrim(c.list_name), '') as list_name,
      nullif(btrim(c.event_tag), '') as event_tag,
      (c.email is not null or c.email_draft_note is not null
        or c.next_followup_at is not null or c.email_unsubscribed_at is not null) as marketing_candidate,
      count(*) as n
    from public.contacts c
    where c.user_id = p_user_id
      and (p_member_name is null
        or c.responsible ilike p_member_name or c.assigned_agent ilike p_member_name)
    group by 1, 2, 3, 4, 5, 6, 7, 8
  ), counts as (
    select coalesce(sum(n), 0) as total,
      coalesce(sum(n) filter (where contact_scope is null or contact_scope = 'crm'), 0) as crm,
      coalesce(sum(n) filter (where (contact_scope is null or contact_scope = 'crm')
        and (hidden is null or hidden = false)), 0) as crm_visible,
      coalesce(sum(n) filter (where contact_scope = 'holding'), 0) as holding,
      coalesce(sum(n) filter (where contact_scope = 'personal'), 0) as personal,
      coalesce(sum(n) filter (where is_partner = true
        and (contact_scope is null or contact_scope <> 'holding')), 0) as partner,
      coalesce(sum(n) filter (where (contact_scope is null or contact_scope = 'crm')
        and source = 'speaqi'), 0) as inbound,
      coalesce(sum(n) filter (where (contact_scope is null or contact_scope <> 'personal')
        and status not in ('closed', 'Closed', 'paid', 'Paid', 'lost', 'Lost', 'not_interested', 'Not_interested')
        and marketing_candidate), 0) as marketing
    from grouped
  ), folders as (
    select list_name, event_tag, nullif(btrim(source), '') as source, sum(n) as count
    from grouped where contact_scope = 'holding'
    group by 1, 2, 3
  )
  select jsonb_build_object(
    'counts', (select to_jsonb(counts) from counts),
    'folders', coalesce((select jsonb_agg(to_jsonb(folders) order by count desc, list_name nulls last)
      from folders), '[]'::jsonb)
  );
$$;

revoke all on function public.contact_workspace_summary(uuid, text) from public, anon;
grant execute on function public.contact_workspace_summary(uuid, text) to authenticated, service_role;
comment on function public.contact_workspace_summary(uuid, text) is
  'Badge e cartelle dei contatti con un solo scan, security invoker e filtri workspace/assegnatario.';

analyze public.contacts;
