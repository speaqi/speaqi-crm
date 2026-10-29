-- Presentazioni con due pagine di contatti.
-- Le basi (destinazioni, partner, inglese) finiscono già con la slide `chiusura`, che porta i contatti di
-- Speaqi. Il 27/10 una slide `contatti` è stata aggiunta in coda a tutte le presentazioni, anche a quelle.
-- Si toglie `contatti` dove una slide di chiusura ha già info@speaqi.com; dove non c'è altra pagina di
-- contatti resta. La versione sale: i PDF in cache (uno per versione) si rifanno.
update public.tourism_decks d
set slides = (
      select coalesce(jsonb_agg(s.slide order by s.ord), '[]'::jsonb)
      from jsonb_array_elements(d.slides) with ordinality as s(slide, ord)
      where s.slide->>'id' <> 'contatti'
    ),
    version = d.version + 1,
    updated_at = now()
where jsonb_typeof(d.slides) = 'array'
  and exists (select 1 from jsonb_array_elements(d.slides) x where x->>'id' = 'contatti')
  and exists (
    select 1 from jsonb_array_elements(d.slides) y
    where y->>'id' <> 'contatti'
      and y->>'kind' = 'closing'
      and exists (select 1 from jsonb_array_elements(coalesce(y->'items', '[]'::jsonb)) i where i->>'title' ilike '%info@speaqi.com%')
  );
