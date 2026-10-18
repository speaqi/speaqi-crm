-- Reference-data extension: OTA is a commercial category, not governance.
-- Run as catalog administrator before importing OTA candidates.
insert into public.tourism_taxonomy(code,labels,governance)
values ('ota','{"it":"OTA · agenzia di viaggi online","en":"Online travel agency"}'::jsonb,false)
on conflict (code) do nothing;
