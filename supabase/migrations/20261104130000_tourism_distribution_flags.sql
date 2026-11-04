-- Speaqi Guides — Distribution Opportunities: «strategico» e «attivabile subito».
--
-- La prima definizione metteva fra gli attivabili subito anche le grandi compagnie di
-- crociera (una trattativa lunga, non un'attivazione rapida) e contava solo due strategici.
--   strategico        = Tier A o B e un grande canale: crociere, OTA, marketplace di esperienze,
--                       bedbank, network, oppure una compagnia aerea su almeno 3 scali delle guide
--                       (o potenziale distributivo >= 75).
--   attivabile subito = Tier A o B, facilita' di attivazione >= 70, un'email, una tipologia che
--                       decide in fretta (DMC, tour operator, agenzia, property manager, traghetti,
--                       alloggio, trasporto, marketplace) e al massimo 200 dipendenti (o ignoti).

do $mig$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p
   where p.proname = 'tourism_distribution_recompute' and p.pronamespace = 'public'::regnamespace;
  if v_def is null then raise exception 'tourism_distribution_recompute non trovata'; end if;
  if position('f.guide_hubs >= 3' in v_def) > 0 then return; end if;

  v_def := replace(v_def,
    '(f.tier_v = ''A'' and f.c_dist >= 75),',
    '(f.tier_v in (''A'',''B'') and (f.c_dist >= 75 or f.type_code in (''cruise_line'',''ota'',''experience_marketplace'',''bedbank'',''network'')
           or (f.type_code = ''airline'' and f.guide_hubs >= 3))),');
  v_def := replace(v_def,
    '(f.tier_v in (''A'',''B'') and f.c_act >= 70 and f.email is not null),',
    '(f.tier_v in (''A'',''B'') and f.c_act >= 70 and f.email is not null
           and f.type_code in (''dmc'',''tour_operator'',''travel_agency'',''property_manager'',''ferry_operator'',''accommodation'',''experience_marketplace'',''transport'')
           and (f.emp is null or f.emp <= 200)),');
  if position('f.guide_hubs >= 3' in v_def) = 0 or position('f.emp <= 200' in v_def) = 0 then
    raise exception 'sostituzione non riuscita';
  end if;
  execute v_def;
end $mig$;
