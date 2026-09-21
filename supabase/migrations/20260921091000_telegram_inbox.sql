-- Note vocali da Telegram che diventano attivita del To Do.
--
-- Ogni messaggio che arriva al bot lascia qui una riga: cosa ha sentito il
-- trascrittore, cosa ne ha capito il modello, cosa e stato scritto davvero.
-- Serve a due cose precise. La prima: Telegram riconsegna lo stesso update
-- finche non riceve un 200, e senza un vincolo di unicita un vocale capitato
-- durante un riavvio creerebbe le stesse attivita due o tre volte. La seconda:
-- quando un vocale viene capito male si vuole poter leggere cosa aveva
-- sentito, non indovinare.
create table if not exists public.telegram_inbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- L'id dell'update Telegram: e la chiave dell'idempotenza, non un dettaglio
  -- di diagnostica.
  update_id bigint not null,
  chat_id text not null,
  message_id bigint,
  kind text not null default 'text',
  transcript text,
  -- Quello che il modello ha deciso di fare, come lista di azioni.
  intent jsonb,
  created_task_ids uuid[] not null default '{}',
  updated_task_ids uuid[] not null default '{}',
  status text not null default 'received',
  error text,
  created_at timestamptz not null default now()
);

create unique index if not exists telegram_inbox_update_idx
  on public.telegram_inbox (update_id);

create index if not exists telegram_inbox_user_idx
  on public.telegram_inbox (user_id, created_at desc);

alter table public.telegram_inbox enable row level security;

drop policy if exists "telegram_inbox_owner" on public.telegram_inbox;
create policy "telegram_inbox_owner" on public.telegram_inbox
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

comment on table public.telegram_inbox is
  'Un messaggio ricevuto dal bot Telegram: trascrizione, intento riconosciuto e attivita create o aggiornate. update_id e unico: Telegram riconsegna finche non riceve 200.';
