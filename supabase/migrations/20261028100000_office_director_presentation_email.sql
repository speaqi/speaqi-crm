-- Nuova intenzione del Direttore: «presentation_email» (la bozza email con il link di
-- una presentazione approvata, copiata fra le bozze di Gmail). Da applicare prima del
-- codice: con il registro dei lavori acceso l'intenzione si scrive sull'ordine.
alter table public.office_director_orders drop constraint if exists office_director_orders_intent_check;
alter table public.office_director_orders add constraint office_director_orders_intent_check
  check (intent in ('new_contact','build_map','check_map','presentation','find_partners','add_entity','rename_entity','presentation_email','status','events','invoice','task','help','unknown'));
