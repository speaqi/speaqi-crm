-- La rotazione di /api/automation/wine-project-replies decideva "chi
-- sincronizzare per primo" guardando l'ultima riga in gmail_messages per
-- contatto. Una cantina senza mai uno scambio email non ottiene pero'
-- nessuna riga li: il suo "ultimo sync" restava per sempre a zero, e
-- l'ordinamento la riproponeva in cima a ogni giro. Su 570 cantine arruolate,
-- solo una manciata ha mai scambiato email: la rotazione restava bloccata su
-- quel sottoinsieme silenzioso e non avrebbe mai raggiunto le altre, nemmeno
-- lasciandola girare per giorni — scoperto dal vivo il 18 settembre 2026,
-- due chiamate consecutive da 100 contatti hanno dato zero messaggi entrambe.
--
-- Questa tabella registra "ho controllato" a prescindere dall'esito: trovare
-- zero messaggi e' comunque un controllo fatto, e la prossima cantina deve
-- avere la precedenza.
create table if not exists public.wine_project_reply_checks (
  contact_id uuid primary key references public.contacts(id) on delete cascade,
  checked_at timestamptz not null default now()
);

comment on table public.wine_project_reply_checks is
  'Ultimo controllo Gmail per una cantina Wine Project, a prescindere dal fatto che abbia trovato messaggi. Guida la rotazione di /api/automation/wine-project-replies: senza questa riga, una cantina silenziosa verrebbe riproposta in cima a ogni giro invece di far posto alle altre.';

alter table public.wine_project_reply_checks enable row level security;

drop policy if exists "wine_project_reply_checks_owner" on public.wine_project_reply_checks;
create policy "wine_project_reply_checks_owner" on public.wine_project_reply_checks
  for all using (
    exists (
      select 1 from public.contacts c
      where c.id = wine_project_reply_checks.contact_id and c.user_id = auth.uid()
    )
  );
