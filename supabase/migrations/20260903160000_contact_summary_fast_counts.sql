-- I conteggi della sidebar erano il nuovo collo di bottiglia dell'apertura pagina.
--
-- Misurato su produzione (62.001 contatti):
--   contact_scope_folder_counts  1322 ms  (seq scan + sort esterno su disco)
--   conteggio "marketing"         782 ms  (seq scan dell'intera tabella)
-- Il resto dei conteggi stava sotto gli 80 ms. Siccome /api/contacts/summary
-- attende tutte le query, l'apertura di /contacts e /kanban aspettava 1,3 s.

-- 1) La RPC usava coalesce(contact_scope,'crm'): l'espressione non è sargable,
--    l'indice (user_id, contact_scope, ...) restava inutilizzato e il planner
--    stimava 311 righe invece di 58.227 (187× di errore), scegliendo un
--    GroupAggregate con sort su disco invece di una HashAggregate.
--    'holding' non è mai il fallback del coalesce, quindi il confronto diretto
--    dà esattamente lo stesso risultato. Aggiunto anche il filtro su user_id:
--    RLS resta la barriera di sicurezza, questo è solo un aiuto al planner.
--    Misurato dopo: 141 ms.
drop function if exists public.contact_scope_folder_counts(text);

create or replace function public.contact_scope_folder_counts(p_scope text, p_user_id uuid)
returns table (
  list_name text,
  event_tag text,
  source text,
  contacts_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    nullif(btrim(c.list_name), '') as list_name,
    nullif(btrim(c.event_tag), '') as event_tag,
    nullif(btrim(c.source), '') as source,
    count(*)::bigint as contacts_count
  from public.contacts c
  where c.user_id = p_user_id
    and c.contact_scope = p_scope
  group by 1, 2, 3
  order by 4 desc, 1 nulls last;
$$;

comment on function public.contact_scope_folder_counts(text, uuid) is
  'Conteggi (list_name, event_tag, source) per scope contatto: alimenta i chip cartella senza caricare le righe.';

grant execute on function public.contact_scope_folder_counts(text, uuid) to authenticated;

-- 2) Il badge "marketing" conta quasi tutta la tabella (61.908 righe su 62.001),
--    quindi nessun indice lo rende selettivo: il costo era la scansione di
--    righe larghe 63 colonne. Un indice parziale coprente sulle sole colonne
--    del filtro trasforma la query in un Index Only Scan su voci strette.
--    Misurato: 782 ms -> 31 ms.
create index if not exists contacts_marketing_badge_idx
  on public.contacts (user_id, contact_scope, status)
  where (
    email is not null
    or email_draft_note is not null
    or next_followup_at is not null
    or email_unsubscribed_at is not null
  );
