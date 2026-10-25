-- Nuova intenzione del Direttore: «rename_entity» (rinomina un ente di Tourism
-- Intelligence, ed eventualmente ne prepara la presentazione). Senza, l'esito si
-- salva comunque ma senza intenzione.
alter table public.office_director_orders drop constraint if exists office_director_orders_intent_check;
alter table public.office_director_orders add constraint office_director_orders_intent_check
  check (intent in ('new_contact','build_map','check_map','presentation','find_partners','add_entity','rename_entity','status','events','invoice','task','help','unknown'));
