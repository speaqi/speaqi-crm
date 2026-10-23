-- Numerazione 2026 riallineata alla serie del pannello Aruba (FPR n/26).
--
-- Il CRM era partito dalla propria serie: la fattura per Esposito aveva preso il
-- 21 e quella per Tenuta Sette Ponti il 22, mentre su Aruba l'ultima emessa era
-- FPR 18/26 (la stessa vendita a Esposito, fatta dal pannello). Le due numerazioni
-- del CRM non sono mai arrivate allo SDI: nessun file con quei numeri e' stato
-- caricato su Aruba, quindi si possono correggere senza effetti fuori dal CRM.
--
--   N. 21 (Esposito)      -> FPR 18/26, gia' emessa e consegnata da Aruba
--   N. 22 (Sette Ponti)   -> FPR 19/26, ancora da inviare
--   contatore 2026        -> 19 (la prossima sara' FPR 20/26)
--   formato del numero    -> FPR {n}/{yy}
--
-- Il guard dei numeri (invoices_guard) vieta di cambiarli: si spegne solo per
-- queste due righe e si riaccende nella stessa transazione. Ogni UPDATE e'
-- condizionato allo stato di partenza, quindi su un altro database, o rilanciata,
-- non fa niente.

alter table public.invoices disable trigger invoices_guard;

-- Esposito: emessa dal pannello Aruba, il CRM la registra com'e'. L'XML con il
-- numero 21 non e' mai partito: si toglie perche' dice il numero sbagliato.
update public.invoices
set number = 18,
    numero = 'FPR 18/26',
    status = 'delivered',
    sdi_status = 'Emessa e consegnata dal pannello Aruba (FPR 18/26)',
    sdi_detail = null,
    last_error = null,
    xml = null
where year = 2026
  and number = 21
  and numero = '21'
  and aruba_env = 'manual'
  and aruba_filename is null;

-- Sette Ponti: mai inviata (errore di accesso ad Aruba). Prende il numero libero
-- della serie di Aruba; l'XML si rifa' al prossimo invio col numero nuovo.
update public.invoices
set number = 19,
    numero = 'FPR 19/26',
    xml = null
where year = 2026
  and number = 22
  and numero = '22'
  and status = 'error'
  and sent_at is null
  and aruba_filename is null;

alter table public.invoices enable trigger invoices_guard;

update public.invoice_counters
set last_number = 19
where year = 2026
  and last_number = 22;

update public.invoice_settings
set numero_formato = 'FPR {n}/{yy}'
where numero_formato = '{n}';
