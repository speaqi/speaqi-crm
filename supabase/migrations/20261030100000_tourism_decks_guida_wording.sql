-- Nelle presentazioni Tourism «mappa» diventa «guida» (testi delle slide e modello salvato).
-- Un modello senza base o con la base di prima (destinazioni-2026-10) non si tocca: viene sostituito dal codice
-- e la sua impronta deve restare quella originale.
-- Solo parole intere: «napolimap» e gli indirizzi (/maps/...) non si toccano. Un deck in
-- generazione si salta (la riscrive l'agente). La version sale, cosi' i PDF in cache si rifanno
-- e un editor aperto vede il conflitto invece di sovrascrivere.

create or replace function pg_temp.guida_wording(value jsonb) returns jsonb
language sql immutable as $$
  select regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(
                regexp_replace(value::text, '\mmappe\M', 'guide', 'g'),
              '\mMappe\M', 'Guide', 'g'),
            '\mmappa\M', 'guida', 'g'),
          '\mMappa\M', 'Guida', 'g'),
        '\mmaps\M(?!/)', 'guides', 'g'),
      '\mMaps\M(?!/)', 'Guides', 'g'),
    '\mmap\M(?!/)', 'guide', 'g'),
  '\mMap\M(?!/)', 'Guide', 'g')::jsonb
$$;

update public.tourism_decks
set slides = pg_temp.guida_wording(slides), version = version + 1, updated_at = now()
where status <> 'generating' and slides is distinct from pg_temp.guida_wording(slides);

update public.tourism_deck_templates
set content = jsonb_set(content, '{slides}', pg_temp.guida_wording(content->'slides')), version = version + 1, updated_at = now()
where jsonb_typeof(content->'slides') = 'array' and coalesce(content->>'base', '') not in ('', 'destinazioni-2026-10') and content->'slides' is distinct from pg_temp.guida_wording(content->'slides');
