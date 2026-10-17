# Rilascio del 17 ottobre 2026

Migrazione applicata al progetto Supabase **Speaqi Crm** (`drlaoxxodjltsycbbdvn`, PostgreSQL 17) tramite l'integrazione Supabase. La cronologia remota registra `20261017205455_tourism_intelligence`; il file locale usa la stessa versione. Il contenuto SQL remoto coincide con quello locale (MD5 `4f69c0cb939162ccb285348399e382ff`). Non rilanciare la migrazione su questo progetto.

## Backup prima della migrazione

Salvate **103.104 righe di 11 tabelle CRM**, suddivise in 112 file, nella cartella locale ignorata da Git `backups/tourism-pre-migration-20261017T2035/`. Ogni pagina è stata riletta: conteggi attesi, assenza di identificativi duplicati, validità del JSON e checksum SHA-256 sono registrati nel `manifest.json`. Cartella e file hanno permessi locali restrittivi.

Il backup contiene pagine JSON come array di record oppure oggetti `{columns, rows}`; nel secondo formato ogni riga si ricostruisce associando le colonne ai valori nella stessa posizione. Il manifest indica il formato di ogni pagina. L'esportazione usa letture paginate e non costituisce uno snapshot transazionale né un backup completo dell'intero progetto Supabase. Il ripristino non è stato provato. Nessun dato di backup è incluso nel repository.

## Verifiche sul progetto reale

- Create 7 tabelle, tutte con RLS, 7 policy, 15 funzioni e 19 categorie.
- Controllati i privilegi effettivi ereditati da Supabase: nessun accesso anonimo alle tabelle o alle funzioni Tourism. Funzioni trigger e sequenza dell'audit non eseguibili direttamente dagli utenti autenticati.
- Eseguito [release-smoke.sql](./release-smoke.sql) con il ruolo `authenticated`: importazione e reimportazione idempotente, revisione della fonte, promozione CRM idempotente, recapiti verificati, eleggibilità marketing `review`, sync in entrambe le direzioni, invalidazione della verifica, audit e isolamento fra workspace.
- L'intera prova termina con `ROLLBACK`. Dopo il rollback: zero entità, evidenze, collegamenti, revisioni e contatti di prova persistenti; conteggio contatti rimasto a 62.164. Nessun campione pilota importato. Nessuna email o ricerca AI eseguita.
- Verificate le risposte REST reali con la chiave anonima configurata: HTTP 401 / PostgreSQL `42501` per la tabella `tourism_entities` e la funzione `tourism_overview`, anziché schema mancante.
- Suite locale dopo la correzione dei privilegi: **11 test unitari + 18 test database**, tutti passati. Risultati in [test-results.txt](./test-results.txt).

I risultati strutturati sono in [release-results.json](./release-results.json). Il percorso browser autenticato sul deploy, il provider AI reale, il ripristino del backup e la concorrenza fra più processi restano fuori dalla verifica del rilascio.

## Advisor Supabase

Nessun nuovo rilievo di sicurezza rispetto al controllo precedente e nessun rilievo relativo agli oggetti Tourism. Restano i rilievi preesistenti, che non sono stati modificati da questa migrazione:

| Categoria | Rilievi | Documentazione |
| --- | ---: | --- |
| RLS senza policy (INFO) | 4 | [Indicazioni Supabase](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) |
| Search path modificabile (WARN) | 4 | [Indicazioni Supabase](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable) |
| Funzioni SECURITY DEFINER eseguibili da anon (WARN) | 6 | [Indicazioni Supabase](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable) |
| Funzioni SECURITY DEFINER eseguibili da autenticati (WARN) | 6 | [Indicazioni Supabase](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) |
| Protezione password compromesse (WARN) | 1 | [Indicazioni Supabase](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) |
