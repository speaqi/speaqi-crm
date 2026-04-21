select
  c.user_id,
  c.id,
  c.legacy_id,
  c.name,
  c.company,
  c.email,
  c.phone,
  c.list_name,
  c.event_tag,
  c.updated_at
from public.contacts c
where c.legacy_id ~* '^csv-import-[0-9]+$'
order by c.updated_at desc, c.created_at desc;

select
  a.contact_id,
  c.legacy_id,
  c.name,
  c.company,
  c.email,
  c.phone,
  a.created_at,
  a.content
from public.activities a
join public.contacts c on c.id = a.contact_id
where a.type = 'import'
  and c.legacy_id ~* '^csv-import-[0-9]+$'
order by a.created_at desc;
