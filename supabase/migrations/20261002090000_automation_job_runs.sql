-- Una riga per ogni corsa di un'automazione pianificata (ex workflow n8n).
--
-- La chiave (job, slot) e' la prenotazione: con piu' repliche del CRM accese,
-- ognuna prova a inserire la riga del minuto e solo una ci riesce, quindi un
-- job parte una volta sola qualunque sia il numero di repliche. Il resto della
-- riga e' lo storico che prima stava nelle "Executions" di n8n.
create table if not exists public.automation_job_runs (
  job text not null,
  slot timestamptz not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  steps jsonb,
  error text,
  primary key (job, slot)
);

create index if not exists automation_job_runs_slot_idx on public.automation_job_runs (slot);

-- Solo il service role (il pianificatore) la legge e la scrive.
alter table public.automation_job_runs enable row level security;
