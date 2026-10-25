-- Le intenzioni del Direttore cresciute dopo la prima migration: «events» (prossime fiere)
-- e «invoice» (bozza della fattura di un preventivo). Senza, il salvataggio dell'esito
-- veniva rifiutato dal vincolo e l'ordine restava «in lavorazione».
alter table public.office_director_orders drop constraint if exists office_director_orders_intent_check;
alter table public.office_director_orders add constraint office_director_orders_intent_check
  check (intent in ('new_contact','build_map','check_map','presentation','status','events','invoice','task','unknown'));
