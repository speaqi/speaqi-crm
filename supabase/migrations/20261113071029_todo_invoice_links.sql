-- Le schede della lavagna restano attività; un documento può riguardarne più
-- d'una e ogni attività può avere più fatture, senza duplicare i documenti.
create table public.todo_invoice_links (
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, invoice_id)
);
create index todo_invoice_links_invoice_idx on public.todo_invoice_links(user_id, invoice_id);
alter table public.todo_invoice_links enable row level security;
create policy todo_invoice_links_owner on public.todo_invoice_links for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, delete on public.todo_invoice_links to authenticated;

create function public.check_todo_invoice_link() returns trigger language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from public.tasks t where t.id = new.task_id and t.user_id = new.user_id and t.contact_id is null)
     or not exists (select 1 from public.invoices i where i.id = new.invoice_id and i.user_id = new.user_id) then
    raise exception 'Attività o fattura non accessibile';
  end if;
  return new;
end; $$;
create trigger todo_invoice_links_check before insert or update on public.todo_invoice_links
  for each row execute function public.check_todo_invoice_link();
