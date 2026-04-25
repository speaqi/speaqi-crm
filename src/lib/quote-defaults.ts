export const QUOTE_TERMS_LAST_UPDATED_IT = '25 aprile 2026'

export const DEFAULT_BANK_TRANSFER_INSTRUCTIONS = [
  'Bonifico',
  'Intestatario: The Best Italy',
  'Banca: Intesa San Paolo',
  'IBAN: IT46U0306909606100000411651',
  'In causale indicare il numero del preventivo.',
].join('\n')

export const DEFAULT_CONTRACT_TERMS = `TERMINI DI SERVIZIO – SPEAQI (SaaS)

Ultimo aggiornamento: ${QUOTE_TERMS_LAST_UPDATED_IT}

I presenti Termini di Servizio (“Termini”) disciplinano l’accesso e l’utilizzo del servizio “Speaqi”, fornito da The Best Italy, con sede in Via Guglielmo Melisurgo 4 P.IVA 10831191217 (di seguito, il “Fornitore”).

L’acquisto o l’utilizzo del servizio comporta l’accettazione integrale dei presenti Termini.

⸻

1. Oggetto del servizio

Speaqi è un servizio SaaS che consente la trasformazione di contenuti digitali in link e QR code multilingua accessibili tramite un’unica interfaccia.

Il servizio è destinato a clienti professionali (B2B).

⸻

2. Descrizione del servizio

Il servizio consente al Cliente di:

* caricare contenuti (video, audio, testo);
* ottenere versioni multilingua automatizzate;
* generare link e QR code condivisibili;
* accedere a funzionalità di gestione e analisi;
* utilizzare eventuali moduli aggiuntivi indicati nell’offerta o nel piano scelto.

Il Fornitore si riserva il diritto di modificare, aggiornare o migliorare il servizio in qualsiasi momento.

⸻

3. Accesso e utilizzo

L’accesso al servizio avviene tramite credenziali personali.

Il Cliente si impegna a:

* fornire informazioni veritiere;
* non utilizzare il servizio per finalità illecite;
* non violare diritti di terzi.

Il Cliente è responsabile dei contenuti caricati sulla piattaforma.

⸻

4. Durata e rinnovo

Il servizio è erogato su base annuale, secondo il piano acquistato.

Salvo diversa indicazione, l’abbonamento si rinnova automaticamente alla scadenza, salvo disdetta prima del rinnovo.

⸻

5. Prezzi e pagamenti

I prezzi sono indicati al momento dell’acquisto e si intendono al netto di IVA.

Il pagamento avviene in via anticipata tramite i metodi disponibili sulla piattaforma.

In caso di mancato pagamento, il Fornitore potrà sospendere o limitare l’accesso al servizio.

⸻

6. Limitazione di responsabilità

Il servizio è fornito “così com’è”.

Il Fornitore non garantisce:

* risultati economici o di performance;
* continuità ininterrotta del servizio;
* assenza totale di errori o malfunzionamenti.

Salvo dolo o colpa grave, la responsabilità del Fornitore è limitata all’importo pagato dal Cliente negli ultimi 12 mesi.

⸻

7. Contenuti e proprietà intellettuale

Il Cliente mantiene la titolarità dei contenuti caricati.

Il Cliente garantisce di avere i diritti necessari all’utilizzo dei contenuti.

Il Fornitore mantiene tutti i diritti sulla piattaforma, sul software e sui relativi elementi tecnologici.

È vietata qualsiasi riproduzione, copia o reverse engineering del servizio.

⸻

8. Riservatezza

Le Parti si impegnano a mantenere riservate le informazioni confidenziali apprese durante il rapporto.

Tale obbligo permane anche dopo la cessazione del servizio per un periodo di 2 anni.

⸻

9. Recesso e risoluzione

Il Cliente può interrompere l’abbonamento in qualsiasi momento, con effetto alla fine del periodo già pagato.

Il Fornitore può sospendere o risolvere il servizio in caso di:

* violazione dei presenti Termini;
* uso illecito del servizio;
* mancato pagamento.

⸻

10. Modifiche ai Termini

Il Fornitore si riserva il diritto di modificare i presenti Termini in qualsiasi momento.

Le modifiche saranno comunicate tramite piattaforma o email e avranno effetto dalla data indicata.

⸻

11. Legge applicabile e foro competente

I presenti Termini sono regolati dalla legge italiana.

Per qualsiasi controversia è competente in via esclusiva il Foro di Napoli.

⸻

12. Accettazione

L’utilizzo del servizio e/o il completamento dell’acquisto costituiscono accettazione dei presenti Termini.`

/** Testi salvati nei preventivi creati prima dell’aggiornamento coordinate/termini */
export const LEGACY_BANK_TRANSFER_INSTRUCTIONS =
  'Bonifico bancario intestato a Speaqi. Inserire nella causale il numero del preventivo.'

export const LEGACY_CONTRACT_TERMS_SHORT =
  "Il contratto commerciale associato al preventivo è considerato accettato alla generazione dell'offerta. L'acconto avvia la lavorazione; il saldo è dovuto alla consegna."

export function resolvePublicBankInstructions(stored: string | null | undefined): string {
  const s = String(stored || '').trim()
  if (!s) return DEFAULT_BANK_TRANSFER_INSTRUCTIONS
  if (s === LEGACY_BANK_TRANSFER_INSTRUCTIONS) return DEFAULT_BANK_TRANSFER_INSTRUCTIONS
  if (s.includes('intestato a Speaqi') && !s.includes('IT46')) return DEFAULT_BANK_TRANSFER_INSTRUCTIONS
  return s
}

export function resolvePublicContractTerms(stored: string | null | undefined): string {
  const s = String(stored || '').trim()
  if (!s) return DEFAULT_CONTRACT_TERMS
  if (s === LEGACY_CONTRACT_TERMS_SHORT) return DEFAULT_CONTRACT_TERMS
  if (s.startsWith('Il contratto commerciale associato al preventivo') && s.length < 400) {
    return DEFAULT_CONTRACT_TERMS
  }
  return s
}
