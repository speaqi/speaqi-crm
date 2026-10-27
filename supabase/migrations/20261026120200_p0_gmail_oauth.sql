-- P0: OAuth Gmail legato al browser che ha iniziato il flusso.
--
-- Lo state era solo una riga DB: un attaccante poteva generarne uno per il
-- proprio utente, far autorizzare Gmail alla vittima e collegare il suo
-- account al workspace dell'attaccante. Ora lo state ha un TTL breve, un
-- code_verifier PKCE e deve combaciare con un cookie HttpOnly.

alter table public.gmail_oauth_states
  add column if not exists code_verifier text,
  add column if not exists expires_at timestamptz not null default (now() + interval '10 minutes');

create index if not exists gmail_oauth_states_expires_idx
  on public.gmail_oauth_states(expires_at);

-- Pulizia delle richieste scadute: non servono più e non devono restare
-- utilizzabili in caso di replay.
delete from public.gmail_oauth_states
where expires_at < now() - interval '1 day';
