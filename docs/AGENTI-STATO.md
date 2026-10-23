# Ufficio Speaqi — stato del Prompt 0

Questa PR riguarda esclusivamente **Prompt 0 — Base comune** di
`docs/AGENTI-UFFICIO.md`. Il registro degli handler è vuoto: nessun agente
operativo dei prompt 1–12 viene installato o avviato da questo branch.

- Branch: `codex/office-base`, base `main`.
- PR: https://github.com/speaqi/speaqi-crm/pull/44, aperta e non unita.
- Migration: `supabase/migrations/20261022160000_office_agents.sql`.
  Verificata solo su Postgres locale usa-e-getta, non applicata a database
  operativi. Prima di distribuire il codice occorre applicarla al database
  di destinazione, dopo le migration precedenti e previa revisione della PR.
- Gli agenti futuri nascono `enabled=false`. Le decisioni sulle uscite
  registrano solo approvazione o rifiuto, senza invii o pubblicazioni.
- Verifiche: test unitari, test DB con concorrenza e RLS, TypeScript,
  build Next e browser con API simulate. I dettagli sono nella PR.
- Non verificati dal vivo: Supabase/PostgREST e worker Railway di produzione,
  fatturazione OpenAI. Nessun deploy o modifica a mappe reali; Napoli intatta.
