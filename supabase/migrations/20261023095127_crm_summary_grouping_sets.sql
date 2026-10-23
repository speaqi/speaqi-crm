-- Il primo riepilogo raggruppava anche per stato e flag: con work_mem basso
-- il planner ordinava tutte le righe su disco. GROUPING SETS calcola insieme
-- il totale workspace e le sole chiavi delle cartelle, nello stesso scan.
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
    select grouping(nullif(btrim(c.list_name), '')) = 1 as is_total,
      nullif(btrim(c.list_name), '') as list_name,
      nullif(btrim(c.event_tag), '') as event_tag,
      nullif(btrim(c.source), '') as source,
      count(*) as total,
      count(*) filter (where c.contact_scope is null or c.contact_scope = 'crm') as crm,
      count(*) filter (where (c.contact_scope is null or c.contact_scope = 'crm')
        and (c.hidden is null or c.hidden = false)) as crm_visible,
      count(*) filter (where c.contact_scope = 'holding') as holding,
      count(*) filter (where c.contact_scope = 'personal') as personal,
      count(*) filter (where c.is_partner = true
        and (c.contact_scope is null or c.contact_scope <> 'holding')) as partner,
      count(*) filter (where (c.contact_scope is null or c.contact_scope = 'crm')
        and c.source = 'speaqi') as inbound,
      count(*) filter (where (c.contact_scope is null or c.contact_scope <> 'personal')
        and c.status not in ('closed', 'Closed', 'paid', 'Paid', 'lost', 'Lost', 'not_interested', 'Not_interested')
        and (c.email is not null or c.email_draft_note is not null
          or c.next_followup_at is not null or c.email_unsubscribed_at is not null)) as marketing
    from public.contacts c
    where c.user_id = p_user_id
      and (p_member_name is null
        or c.responsible ilike p_member_name or c.assigned_agent ilike p_member_name)
    group by grouping sets (
      (nullif(btrim(c.list_name), ''), nullif(btrim(c.event_tag), ''), nullif(btrim(c.source), '')),
      ()
    )
  )
  select jsonb_build_object(
    'counts', (select jsonb_build_object(
      'total', total, 'crm', crm, 'crm_visible', crm_visible, 'holding', holding,
      'personal', personal, 'partner', partner, 'inbound', inbound, 'marketing', marketing
    ) from grouped where is_total),
    'folders', coalesce((select jsonb_agg(jsonb_build_object(
      'list_name', list_name, 'event_tag', event_tag, 'source', source, 'count', holding
    ) order by holding desc, list_name nulls last) from grouped where not is_total and holding > 0), '[]'::jsonb)
  );
$$;
