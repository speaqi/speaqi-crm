# Ufficio Speaqi — registro di avanzamento

Ordine: **0 → 11 → 10 → 1 → 3 → 2 → 4 → 5 → 6 → 7 → 8 → 9 → 12**.
Le PR restano aperte e non vengono unite. Ogni branch nuovo parte dal precedente;
le migration si consegnano in ordine crescente e non si applicano a database operativi.
Tutti gli agenti restano `enabled=false`. Nessun invio o pubblicazione senza un clic umano;
Napoli non si modifica. Fonti, budget prima della spesa e idempotenza sono obbligatori.

| Prompt | Agente | Stato | Branch | PR | Note |
|---|---|---|---|---|---|
| 0 | Base comune | PR aperta | `codex/office-base` | #44 | PR preesistente conservata, senza rifare il lavoro né cambiarne il branch. Migration `20261022160000_office_agents.sql`; test unit, DB, TypeScript, build e browser verificati. |
| 11 | Finanza | PR aperta | `agenti/11-finanza` | #47 | Base `codex/office-base`; migration `20261022170450_office_finance.sql`, non applicata a DB operativi. 432 unit passati, 1 skip preesistente; 30 DB, TypeScript e build verdi. Nessuna nuova env; nessun invio. |
| 10 | Commerciale | in corso | `agenti/10-commerciale` | — | Parte dal Prompt 11. |
| 1 | Direttore | da fare | `agenti/01-direttore` | — | Parte dal Prompt 10. |
| 3 | Lingue e voce | da fare | `agenti/03-lingue-voce` | — | Verificare accesso e regole di StudioMap e Speaqi. |
| 2 | Costruttore My Maps | da fare | `agenti/02-mymaps` | — | Verificare accesso e regole di StudioMap. |
| 4 | Qualità mappe | da fare | `agenti/04-qualita-mappe` | — | Verificare accesso e regole di StudioMap. |
| 5 | Pulizia database | da fare | `agenti/05-pulizia-database` | — | Solo proposte; unione transazionale soltanto dopo approvazione. |
| 6 | Eventi e fiere | da fare | `agenti/06-eventi` | — | Fonti ufficiali e date verificate. |
| 7 | Osservatorio novità | da fare | `agenti/07-novita` | — | L'invio Telegram richiede comunque un clic umano secondo le regole comuni. |
| 8 | Arricchimento enti | da fare | `agenti/08-enti` | — | Evidenze obbligatorie, solo campi vuoti e indirizzi istituzionali. |
| 9 | Presentazioni | da fare | `agenti/09-presentazioni` | — | Riutilizzare la pipeline esistente; nessuna approvazione automatica. |
| 12 | Social | da fare | `agenti/12-social` | — | Solo bozze; nessun nuovo contenuto su Napoli non già approvato. |

## Decisioni prudenti e limiti

- Il Prompt 0 ha già la PR #44, sul branch storico `codex/office-base`: si riusa
  come base della catena, senza creare una seconda PR per lo stesso prompt.
- Il testo del Prompt 7 ammette un riepilogo Telegram con `settings.telegram=true`;
  la regola comune «nessun invio senza clic umano» prevale: la preparazione e la
  scelta del canale non costituiscono autorizzazione a inviare automaticamente.
- I test con servizi simulati non attestano una prova in produzione. Per ogni PR
  verranno indicati servizi, credenziali e percorsi non verificati dal vivo.
