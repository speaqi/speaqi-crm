-- Lingua della campagna.
--
-- Il motore aveva saluto, fallback azienda, testo del bottone e piede di
-- disiscrizione scritti in italiano dentro al codice: una campagna verso
-- destinatari esteri usciva con testo inglese e cornice italiana. La lingua e
-- una proprieta della campagna, non del contatto, perche gli step sono uno per
-- campagna e vengono scelti per numero.

alter table public.commercial_campaigns
  add column if not exists locale text not null default 'it';

do $$
begin
  alter table public.commercial_campaigns
    add constraint commercial_campaigns_locale_check check (locale in ('it', 'en'));
exception
  when duplicate_object then null;
end
$$;

comment on column public.commercial_campaigns.locale is
  'Lingua dei testi di cornice generati dal motore (saluto, CTA, disiscrizione). I testi degli step vanno scritti nella stessa lingua.';
