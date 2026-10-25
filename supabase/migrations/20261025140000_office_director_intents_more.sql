-- Nuove intenzioni del Direttore: «find_partners» (trova partner per una città),
-- «add_entity» (aggiungi un ente a Tourism Intelligence e ai contatti) e «help»
-- (l'elenco dei comandi). Senza, l'esito si salva comunque ma senza intenzione.
alter table public.office_director_orders drop constraint if exists office_director_orders_intent_check;
alter table public.office_director_orders add constraint office_director_orders_intent_check
  check (intent in ('new_contact','build_map','check_map','presentation','find_partners','add_entity','status','events','invoice','task','help','unknown'));
