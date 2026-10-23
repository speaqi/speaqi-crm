# Ufficio — lavoro assegnato a Codex

Richiesta corrente: **02 Costruttore My Maps** e **04 Controllo qualità mappe**.
**03 Lingue e voce** e **05 Pulizia database** sono assegnati a Claude.
I checkout e le modifiche locali del 03 restano separati e intatti.

- 02: branch `codex/office-02-mymaps`, base CRM `agenti/01-direttore`,
  base StudioMap `main`. PR CRM #51 e StudioMap #134 aperte; nessuna migration nuova.
- 04: branch `codex/office-04-quality`, base `codex/office-02-mymaps` nei due
  repository. PR in preparazione; rapporti e proposte, nessuna correzione applicata.
- 02 verificato: CRM 451 unit passati + 1 skip, 40 DB; TypeScript e build verdi.
  StudioMap 1343 test passati + 1 skip, typecheck pulito, 6 test anche su pg.
- 04: traduzioni controllabili solo dove esistono testi salvati; copertura
  mancante dichiarata. Nessun intervento sul servizio traduzioni del 03.
- PR precedenti aperte e non unite: CRM #44 base, #47 finanza, #48 commerciale,
  #49 direttore. I prompt 02 e 04 non dipendono dal 03.

Nessun agente acceso, invio, pubblicazione, migration operativa o deploy.
Napoli esclusa dalle mutazioni. Limiti e prove effettive saranno nelle PR.
