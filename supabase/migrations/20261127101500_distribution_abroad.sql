-- Agente Distribuzione: seconda proposta, guide di città estere su richiesta (a pacchetti di
-- codici prepagati) per le aziende italiane che vendono viaggi all'estero. Solo aggiunte.

-- Profilo: le destinazioni estere nominate e il passo «write_abroad».
alter table public.partner_profiles add column if not exists abroad text[] not null default '{}';
alter table public.partner_profiles drop constraint if exists partner_profiles_next_check;
alter table public.partner_profiles add constraint partner_profiles_next_check
  check (next in ('write','write_abroad','find_email','read_site','guide_needed','destination_body','no_contact','skip'));

-- Sequenza: quale proposta, e di quali città si parla (i promemoria ripetono le stesse).
alter table public.distribution_outreach add column if not exists offer text not null default 'resale';
alter table public.distribution_outreach drop constraint if exists distribution_outreach_offer_check;
alter table public.distribution_outreach add constraint distribution_outreach_offer_check check (offer in ('resale','abroad'));
alter table public.distribution_outreach add column if not exists abroad text[] not null default '{}';
