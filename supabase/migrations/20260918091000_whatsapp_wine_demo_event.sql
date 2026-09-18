-- Una demo Wine pronta e' un fatto che vale una notifica immediata: la cantina
-- ha appena lasciato sito, email e telefono e si aspetta di essere richiamata.
-- Finora l'unico posto dove quel fatto compariva era una riga in `activities`,
-- e nessuno la guardava in tempo utile.
--
-- Il vincolo elenca i tipi ammessi, quindi va esteso prima che il codice possa
-- scrivere il nuovo evento.
alter table public.whatsapp_notification_events
  drop constraint if exists whatsapp_notification_events_type_check;

alter table public.whatsapp_notification_events
  add constraint whatsapp_notification_events_type_check
  check (event_type in (
    'email_sent',
    'email_open',
    'email_click',
    'email_reply',
    'email_unsubscribe',
    'wine_demo_ready'
  ));
