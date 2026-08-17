-- I modelli email vino diventano modificabili da /impostazioni/email-ai.
-- Il testo vive in user_settings come tutti gli altri campi del framework:
-- vuoto = si usano i modelli di default del codice.

alter table public.user_settings
  add column if not exists email_wine_templates text;

comment on column public.user_settings.email_wine_templates is
  'Modelli email vino in formato testo: blocchi "### ID | Etichetta" con righe opzionali Quando:/Oggetto: e corpo.';

-- Con i modelli modificabili gli id non sono piu solo A-D: si possono
-- aggiungere varianti nuove senza toccare il codice.
alter table public.email_drafts
  drop constraint if exists email_drafts_wine_template_check;

alter table public.email_drafts
  add constraint email_drafts_wine_template_check
  check (wine_template is null or wine_template ~ '^[A-Z0-9]{1,8}$');
