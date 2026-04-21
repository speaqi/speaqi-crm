update public.contacts
set legacy_id = 'csv-backfill-' || replace(id::text, '-', '')
where legacy_id ~* '^csv-import-[0-9]+$';
