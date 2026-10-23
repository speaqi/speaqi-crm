# Ufficio — lavoro assegnato a Codex

Richiesta corrente: **02 Costruttore My Maps** e **04 Controllo qualità mappe**.
**03 Lingue e voce** e **05 Pulizia database** sono assegnati a Claude.
I checkout e le modifiche locali del 03 restano separati e intatti.

- 02: branch `codex/office-02-mymaps`, base CRM `agenti/01-direttore`,
  base StudioMap `main`. PR CRM #51 e StudioMap #134 aperte; nessuna migration nuova.
- 04: branch `codex/office-04-quality`, base `codex/office-02-mymaps` nei due
  repository. PR CRM #52 e StudioMap #135 aperte; rapporti e proposte, nessuna correzione applicata.
- 02 verificato: CRM 451 unit passati + 1 skip, 40 DB; TypeScript e build verdi.
  StudioMap 1343 test passati + 1 skip, typecheck pulito, 6 test anche su pg.
- 04: traduzioni controllabili solo dove esistono testi salvati; copertura
  mancante dichiarata. Nessun intervento sul servizio traduzioni del 03.
- PR precedenti aperte e non unite: CRM #44 base, #47 finanza, #48 commerciale,
  #49 direttore. I prompt 02 e 04 non dipendono dal 03.

Nessun agente acceso, invio, pubblicazione, migration operativa o deploy.
Napoli esclusa dalle mutazioni. Limiti e prove effettive saranno nelle PR.

## Consegna 02 e 04

| Prompt | CRM | StudioMap | Base |
|---|---|---|---|
| 02 | https://github.com/speaqi/speaqi-crm/pull/51 | https://github.com/speaqi/studiomap/pull/134 | CRM Direttore #49, StudioMap main |
| 04 | https://github.com/speaqi/speaqi-crm/pull/52 | https://github.com/speaqi/studiomap/pull/135 | Prompt 02 nei due repository |

Verifiche finali 04: CRM 455 unit passati + 1 skip preesistente, 40 DB;
`npx tsc --noEmit` e `npx next build` riusciti. StudioMap 1350 test passati +
1 skip preesistente, typecheck pulito; 7 test qualità anche su PostgreSQL
locale isolato. Le API/modelli remoti sono simulati, non attestano un test di
produzione. Nessuna nuova migration per 02/04; configurazione del segreto
condiviso e deploy restano da fare dopo revisione. Tutte le PR sono non unite.
