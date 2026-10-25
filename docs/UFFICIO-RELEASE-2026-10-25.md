# Ufficio — ricevuta del rilascio del 25 ottobre 2026

Il titolare ha autorizzato il rilascio con «Vai in produzione». Questa ricevuta distingue schema applicato, pubblicazione del codice e attivazione del worker.

## Database di produzione

- Progetto Supabase: Speaqi Crm, `drlaoxxodjltsycbbdvn`.
- Migration `office_persistent_work` applicata con successo. Versione assegnata dal servizio: **20261025172333**. Il file locale è allineato a questa versione; la registrazione nel database resta intatta.
- Le sette tabelle `office_work_*` hanno RLS attiva. Nessuna nuova funzione privilegiata è eseguibile da `anon` o `authenticated`.
- Verifica transazionale reale dell'accodamento idempotente superata con rollback: nessun lavoro di prova persistito, nessuna esecuzione o spesa.
- Interruttori e budget degli agenti invariati. La migration non importa o esegue le code.
- Backup completo già presente in Storage: `speaqi-backup_2026-10-25_0200.json.gz`, 20.201.809 byte. Non è stato eseguito un ripristino.
- Advisor dopo la migration: nessuna nuova segnalazione sugli oggetti dei lavori. Le segnalazioni preesistenti rimangono fuori da questo rilascio.

La revisione automatica ha respinto un'esportazione locale ampia e una modifica della cronologia interna delle migration. Nessuna delle due è stata eseguita: sono stati conservati il backup remoto esistente e la registrazione originale del servizio.

## Codice e verifiche

La PR #78 integra anche `main` fino a `40a1be8` (#86). Le decisioni web e Telegram passano dal servizio comune e dalla transazione dei lavori; le risposte alle domande riprendono l'incarico originale. Le presentazioni multiple producono dipendenze distinte, le foto restano limitate alla destinazione nominata, e la validazione usa il limite del template attuale. Una sintesi riuscita non chiude un lavoro con riserve economiche ancora incerte.

Dopo l'integrazione: **680 test applicativi, 679 superati, 1 saltato, nessun errore**; build ottimizzata e controllo tipi superati. I 22 test SQL dedicati avevano già verificato lo stesso DDL ora applicato; il cambio del nome del file non modifica lo schema. Vedere anche [rapporto del collaudo](UFFICIO-TEST-REPORT.md).

## Attivazione da completare su Railway

L'accesso al servizio Railway non è disponibile nel contesto iniziale del rilascio. Il titolare ha chiesto di riprovarlo dopo la pubblicazione. Non equiparare il merge GitHub o la migration riuscita a un worker attivo.

Verificare il deploy della PR #78 sul servizio CRM, poi impostare `OFFICE_WORKER_ENABLED=true` e aggiungere **soltanto** `office-work` all'elenco esistente di `AUTOMATION_SCHEDULER_JOBS`; preservare gli altri valori, gli interruttori e i budget. Verificare heartbeat, primo turno ed esiti su `automation_job_runs` e `office_work_items`, senza creare una generazione a pagamento come test del rilascio. Al controllo iniziale il registro del pianificatore mostrava il backup, ma nessun job Ufficio.

Le istruzioni di attivazione e sospensione restano nella [guida operativa](UFFICIO-OPERATING-GUIDE.md). L'osservazione del worker e la consegna Telegram sul deploy rimangono da attestare dopo l'accesso a Railway.
