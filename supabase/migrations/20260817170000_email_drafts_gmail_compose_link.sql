-- Id del messaggio della bozza Gmail: serve al link diretto che apre la
-- finestra di composizione in Gmail, dove l'estensione di tracking (MailSuite)
-- puo agganciare il pixel prima dell'invio.

alter table public.email_drafts
  add column if not exists gmail_draft_message_id text;

comment on column public.email_drafts.gmail_draft_message_id is
  'Id del messaggio della bozza Gmail, per il link mail.google.com/...#drafts?compose=<id>.';
