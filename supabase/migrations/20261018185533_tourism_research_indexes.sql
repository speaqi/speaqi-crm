-- Cover research foreign keys reported by the Supabase performance advisor.
create index tourism_site_sources_entity_idx on public.tourism_site_sources(user_id,entity_id);
create index tourism_poi_candidates_reviewer_idx on public.tourism_poi_candidates(reviewed_by) where reviewed_by is not null;
create index tourism_canonical_links_duplicate_owner_idx on public.tourism_canonical_links(user_id,duplicate_id);
