-- Priorità della superguida: fra le città da fare, quali prima.
--
-- «Da fare» su trecento città non dice da dove partire. La priorità ordina il
-- lavoro: 1 = subito (grandi volumi o città-simbolo delle crociere), 2 = dopo le
-- prime, 3 = più avanti. Ha senso solo per una guida ancora da fare o in
-- lavorazione: una guida pubblicata o scartata non ha priorità.

alter table public.shipping_ports
  add column if not exists guide_priority smallint check (guide_priority is null or guide_priority between 1 and 3);

alter table public.shipping_ports drop constraint if exists shipping_ports_guide_priority_open;
alter table public.shipping_ports add constraint shipping_ports_guide_priority_open
  check (guide_priority is null or guide_status in ('planned', 'in_progress'));
