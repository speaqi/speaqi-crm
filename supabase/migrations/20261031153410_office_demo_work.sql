-- Aggiunge solo l'azione dell'agente demo; non attiva agenti né turni.
create or replace function public.office_work_action_allowed(p_agent text,p_action text) returns boolean
language sql immutable set search_path='' as $$
  select (p_agent='director' and p_action in ('interpret_order','director_status','list_events','record_task','create_contact','plan'))
    or (p_agent='demo_builder' and p_action='create_demo')
    or (p_agent='mymaps_builder' and p_action='import_mymaps')
    or (p_agent='maps_quality' and p_action='check_map')
    or (p_agent='languages_voice' and p_action in ('complete_languages','refresh_outdated'))
    or (p_agent='entity_enricher' and p_action='verify_tourism_entity')
    or (p_agent='presentations' and p_action='prepare_presentation')
    or (p_action='agent_run' and p_agent in ('director','mymaps_builder','maps_quality','languages_voice','entity_enricher','presentations',
      'sales_followup','finance','events_scout','news_watch','social','db_cleaner'))
$$;
