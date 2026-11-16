# Esplora LeadOcean

La vista CRM **Contatti → Esplora LeadOcean** consulta l'API ufficiale per cercare aziende e persone. La connessione OAuth MCP dell'assistente è separata e non fornisce al CRM una chiave API utilizzabile.

## Configurazione

1. Recuperare dal proprio account LeadOcean una chiave API con permesso `search`.
2. Impostare `LEADOCEAN_API_KEY` come variabile segreta nell'ambiente server del CRM; per lo sviluppo locale si può usare `.env.local`, per l'ambiente pubblicato la variabile va impostata nella relativa configurazione server.
3. Riavviare o ridistribuire l'applicazione. La chiave non deve essere pubblicata nel repository né esposta come variabile `NEXT_PUBLIC_*`.

La sezione e l'API richiedono un utente amministratore del CRM. La chiave resta sul server e non viene inviata al browser. La dashboard non rivela email o telefoni personali e non importa automaticamente i risultati.

## Ricerca e limiti

- Il conteggio preliminare è gratuito; ogni azienda o persona restituita consuma un record. La dashboard richiede al massimo 25 record per pagina.
- La ricerca persone usa il filtro predefinito del servizio sulla disponibilità e sullo stato delle email; le schede mostrate non contengono gli indirizzi email.
- In caso di filtri non supportati o limite di profondità, la pagina mostra un avviso. Il catalogo non garantisce la copertura di tutte le aziende o persone esistenti.
- Le 534 categorie suggerite sono uno snapshot dell'elenco LeadOcean consultato il 15 novembre 2026. Il servizio può aggiornarle.

Documentazione: https://leadocean.io/docs/search e https://leadocean.io/docs/filters.
