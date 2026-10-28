-- Query sui contatti: meno lavoro per il database (Supabase Free, CPU scarsa).
--
-- 1. La query piu' pesante del workspace (pg_stat_statements, ottobre 2026) e'
--    `contacts ... where user_id = $1 and email ilike $2`: 46 mila chiamate,
--    ~100 ms in media, scansione completa dei 62 mila contatti ogni volta
--    (2,8 s con la cache fredda). La fanno lo stop della sequenza Wine, il
--    webhook Acumbamail, i lead Speaqi, le candidature, il Direttore: tutti
--    cercano l'indirizzo senza distinguere le maiuscole. Un indice trigram
--    serve `ilike` cosi' com'e', senza cambiare una riga di codice.
--
-- 2. Nove indici su `contacts` mai usati (idx_scan = 0 da marzo). Ogni UPDATE
--    non-HOT di un contatto li riscrive tutti: sono solo costo.
--    Restano gli indici unici e quelli usati da campagne e pausa marketing.
--
-- Rollback: `drop index if exists public.contacts_email_trgm_idx;` e le
-- create index in fondo, commentate.

create extension if not exists pg_trgm with schema extensions;

create index if not exists contacts_email_trgm_idx
  on public.contacts using gin (email extensions.gin_trgm_ops)
  where email is not null;

drop index if exists public.contacts_user_last_contact_idx;
drop index if exists public.contacts_user_value_idx;
drop index if exists public.contacts_user_industry_idx;
drop index if exists public.contacts_user_win_probability_idx;
drop index if exists public.contacts_user_score_idx;
drop index if exists public.contacts_user_marketing_status_idx;
drop index if exists public.contacts_user_assigned_agent_idx;
drop index if exists public.contacts_user_category_idx;
drop index if exists public.contacts_user_priority_idx;

-- Rollback degli indici tolti (definizioni lette da pg_indexes prima di toglierli):
-- create index contacts_user_category_idx on public.contacts (user_id, category, next_action_at);
-- create index contacts_user_marketing_status_idx on public.contacts (user_id, marketing_status);
-- create index contacts_user_assigned_agent_idx on public.contacts (user_id, assigned_agent);
-- create index contacts_user_score_idx on public.contacts (user_id, score desc);
-- create index contacts_user_value_idx on public.contacts (user_id, value desc nulls last);
-- create index contacts_user_priority_idx on public.contacts (user_id, priority desc);
-- create index contacts_user_last_contact_idx on public.contacts (user_id, last_contact_at desc);
-- create index contacts_user_industry_idx on public.contacts (user_id, industry);
-- create index contacts_user_win_probability_idx on public.contacts (user_id, win_probability desc);
