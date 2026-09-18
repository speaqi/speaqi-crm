-- Un invio Wine fallito per un limite temporaneo dell'API non e' un invio
-- perso: e' un invio da riprovare. Finora `failed` era uno stato terminale e
-- nessuno ci tornava sopra — il 13 settembre 2026 sono rimaste a terra 46
-- email, tutte con lo stesso `addMergeTag (429)`, e le cantine non le hanno
-- mai ricevute.
--
-- Il contatore tiene il ritentativo limitato: senza, un errore permanente
-- (indirizzo rifiutato, campagna malformata) rimetterebbe la stessa riga in
-- coda a ogni giro del cron, per sempre.
alter table public.wine_project_followup_events
  add column if not exists retry_count smallint not null default 0;

comment on column public.wine_project_followup_events.retry_count is
  'Quante volte l''evento e'' stato rimesso in coda dopo un fallimento di invio temporaneo.';

-- L'indice serve al giro di recupero, che cerca i falliti scaduti: senza,
-- ogni esecuzione scorrerebbe tutta la tabella degli eventi.
create index if not exists wine_project_followup_events_retry_idx
  on public.wine_project_followup_events (status, retry_count, due_at)
  where status = 'failed';
