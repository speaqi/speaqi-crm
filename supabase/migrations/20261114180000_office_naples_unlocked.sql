-- Napoli non è più protetta (14/11/2026).
--
-- Fino a oggi gli agenti dell'Ufficio non potevano lavorare su Napoli: la mappa in
-- produzione era «intoccabile» e diverse funzioni rifiutavano ogni lavoro che la
-- nominasse (code del Direttore, decisioni, arricchimento enti, presentazioni,
-- social, tourism_activate, trigger del registro dei lavori). Il titolare ha tolto
-- la regola: Napoli si lavora come le altre città, in StudioMap e nel CRM.
--
-- Le guardie stanno in molte funzioni, ognuna ridefinita più volte. Invece di
-- ricopiarle tutte, qui si prende la definizione ATTUALE di ogni funzione dello
-- schema public che contiene il controllo e lo si spegne sul posto:
--   ... ~ '(napoli|naples)'   →   ... ~ '(napoli|naples)' and false
-- Ogni occorrenza è la condizione di un `if ... then raise exception` (o di un
-- `exists(...)` dentro quell'if), quindi «and false» rende falsa la condizione e la
-- funzione non rifiuta più niente. Nessuna occorrenza sta dentro un `not` o in un
-- filtro di selezione. CREATE OR REPLACE mantiene proprietario, grant,
-- security definer e search_path.
--
-- Le funzioni di tourism_distribution usano `~*` con altri nomi (punteggi per
-- città, non protezioni): la regex qui sotto non le tocca.
do $$
declare
  fn record;
  def text;
  patched text;
begin
  for fn in
    select p.oid, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f' and p.prosrc like '%(napoli|naples)''%'
  loop
    def := pg_get_functiondef(fn.oid);
    patched := regexp_replace(def, '~\s*''\(napoli\|naples\)''(?!\s*and false)', '~ ''(napoli|naples)'' and false', 'g');
    if patched <> def then
      execute patched;
      raise notice 'Napoli sbloccata in %', fn.proname;
    end if;
  end loop;
end
$$;
