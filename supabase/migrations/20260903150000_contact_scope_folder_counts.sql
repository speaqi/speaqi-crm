-- Conteggi per cartella delle liste separate senza scaricare le righe.
--
-- La pagina /contacts costruiva i chip "Cartelle" contando in memoria l'intero
-- elenco contatti: con 58k righe in scope 'holding' significava trasferire
-- l'intero archivio al browser per stampare otto numeri. Questa funzione
-- restituisce le combinazioni (list_name, event_tag, source) con il loro
-- conteggio: l'etichetta la compone il client con holdingListLabel(), come
-- prima.
--
-- security invoker: la funzione legge `contacts` con i permessi del chiamante,
-- quindi le policy RLS restano quelle dell'utente.

create or replace function public.contact_scope_folder_counts(p_scope text)
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
  where coalesce(c.contact_scope, 'crm') = p_scope
  group by 1, 2, 3
  order by 4 desc, 1 nulls last;
$$;

comment on function public.contact_scope_folder_counts(text) is
  'Conteggi (list_name, event_tag, source) per scope contatto: alimenta i chip cartella senza caricare le righe.';

grant execute on function public.contact_scope_folder_counts(text) to authenticated;
