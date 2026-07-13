-- Pertinenza contatto: quante volte l'ho effettivamente lavorato.
-- Ogni interazione registrata (chiamata, nota, email inviata, esito follow-up)
-- fa +1 su engagement_count. La dashboard usa questo valore per portare in
-- cima i contatti "trascinati" (sentiti tante volte) e non farli sparire sotto
-- lead mai contattati che risultano fermi da decine di giorni.

alter table public.contacts
  add column if not exists engagement_count integer not null default 0;

comment on column public.contacts.engagement_count is
  'Numero di interazioni registrate col contatto (chiamate, note, email inviate, esiti follow-up). Segnale di pertinenza per il ranking in dashboard: più lo lavori, più sale.';

-- Backfill dallo storico: conta le attività che rappresentano un tocco reale,
-- escludendo eventi passivi/automatici (aperture, click, disiscrizioni, import,
-- log di sistema) e le note interne che non toccano last_contact_at.
with touch_counts as (
  select contact_id, count(*)::int as cnt
  from public.activities
  where type not in ('system', 'import', 'email_open', 'email_click', 'unsubscribe')
    and coalesce(metadata ->> 'note_kind', '') <> 'internal'
  group by contact_id
)
update public.contacts c
set engagement_count = tc.cnt
from touch_counts tc
where tc.contact_id = c.id;

-- Incremento atomico usato dal backend a ogni interazione registrata.
-- SECURITY INVOKER: rispetta la RLS del chiamante (aggiorna solo i propri contatti).
create or replace function public.increment_contact_engagement(p_contact_id uuid)
returns void
language sql
as $$
  update public.contacts
  set engagement_count = coalesce(engagement_count, 0) + 1
  where id = p_contact_id;
$$;

grant execute on function public.increment_contact_engagement(uuid) to authenticated, service_role;
