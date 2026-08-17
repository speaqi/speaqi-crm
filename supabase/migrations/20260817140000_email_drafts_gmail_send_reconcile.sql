-- Chiude le bozze di /email spedite a mano da Gmail.
-- Quando l'utente apre la bozza in Gmail e la invia da li, la riga in
-- email_drafts restava "pending" per sempre. La riconciliazione la chiude
-- riusando `provider_message_id` (id del messaggio realmente partito, gia unico
-- per riga) e registra qui da dove e' partito l'invio.

alter table public.email_drafts
  add column if not exists sent_via text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'email_drafts_sent_via_check'
  ) then
    alter table public.email_drafts
      add constraint email_drafts_sent_via_check
      check (sent_via is null or sent_via in ('crm', 'automation', 'gmail'));
  end if;
end $$;

comment on column public.email_drafts.sent_via is
  'crm = inviata dalla UI, automation = inviata da n8n, gmail = bozza spedita a mano da Gmail.';

-- La riconciliazione parte sempre dalle bozze pending di un workspace.
create index if not exists idx_email_drafts_pending_created
  on public.email_drafts (user_id, created_at desc)
  where status = 'pending';
