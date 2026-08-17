-- Modello wine seguito dalla bozza (A/B/C/D, vedi src/lib/email-wine-templates.ts).
-- Serve a /email per mostrare l'angolo usato e per rigenerare con un altro modello
-- mantenendo la scelta tra una rigenerazione e l'altra.

alter table public.email_drafts
  add column if not exists wine_template text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'email_drafts_wine_template_check'
  ) then
    alter table public.email_drafts
      add constraint email_drafts_wine_template_check
      check (wine_template is null or wine_template in ('A', 'B', 'C', 'D'));
  end if;
end $$;

comment on column public.email_drafts.wine_template is
  'Variante dei modelli email vino seguita dalla bozza: A esempio gratuito, B novita, C bottiglia, D prova sociale.';
