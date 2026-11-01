-- Tourism Intelligence: nuovo tipo di ente «Blog e media di viaggio» (blog, riviste,
-- community e creator con sito proprio), potenziali partner di distribuzione.
-- Additiva e idempotente: aggiunge solo la riga di tassonomia.
insert into public.tourism_taxonomy (code, labels, governance)
values ('travel_media', '{"it":"Blog e media di viaggio","en":"Travel blogs and media"}'::jsonb, false)
on conflict (code) do nothing;
