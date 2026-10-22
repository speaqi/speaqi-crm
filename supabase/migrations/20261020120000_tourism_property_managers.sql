-- Property manager: chi gestisce gli affitti brevi di una citta' per conto dei
-- proprietari. Ospitano proprio gli stranieri a cui serve una guida, quindi sono
-- un canale B2B come gli hotel.
--
-- Solo aziende. Un host privato con tre appartamenti e' una persona, e il
-- catalogo non importa persone (`tourism_entity_guard` blocca kind='person').
-- Le fonti sono elenchi pubblici: soci delle associazioni di categoria, siti e
-- bilanci degli operatori, Registro Imprese come fonte di candidati da
-- verificare. Mai i portali di prenotazione.

insert into public.tourism_taxonomy(code, labels, governance) values
 ('property_manager','{"it":"Property manager · affitti brevi","en":"Short-term rental property manager"}',false)
on conflict (code) do nothing;
