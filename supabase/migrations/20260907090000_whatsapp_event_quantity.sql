-- Un invio di massa e un fatto solo con una quantita, non centoventi fatti.
--
-- Le sequenze commerciali (Wine Project, Hospitality e i verticali che verranno)
-- partono via Acumbamail come una campagna sola verso N destinatari. Scrivere
-- una riga di coda per destinatario significherebbe centoventi insert per ogni
-- giro del cron per dire una cosa che il riepilogo poi ricompatta in "120 email
-- inviate". Qui la riga resta una e porta il numero.
--
-- Gli eventi individuali (aperture, click, risposte) restano a quantita 1: li
-- ogni riga e un fatto distinto, con il suo contatto e il suo orario.

alter table public.whatsapp_notification_events
  add column if not exists quantity integer not null default 1;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'whatsapp_notification_events_quantity_check') then
    alter table public.whatsapp_notification_events
      add constraint whatsapp_notification_events_quantity_check check (quantity > 0);
  end if;
end
$$;

comment on column public.whatsapp_notification_events.quantity is
  'Quante email copre questa riga. 1 per i fatti individuali; per un invio di campagna e il numero di destinatari del batch. Il riepilogo somma questa colonna, non conta le righe.';
