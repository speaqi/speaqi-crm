/**
 * Testi di partenza per un verticale, dentro il motore campagne generico.
 *
 * `defaultCampaignSteps` nasce con cinque tappe volutamente neutre: servono a
 * far nascere una campagna utilizzabile, non a vendere. Un verticale su cui si
 * e deciso cosa dire merita invece le sue email vere gia dentro la sequenza —
 * altrimenti la campagna parte con il testo segnaposto, e il segnaposto
 * finisce in casella al primo giro di cron.
 *
 * Resta configurazione, non codice di processo: il preset e solo il contenuto
 * iniziale. Da qui in poi comandano le righe su `commercial_campaigns` e
 * `commercial_campaign_steps`, riscrivibili dalla scheda della campagna senza
 * toccare questo file (e uno step gia inviato non si riscrive affatto: lo
 * impedisce un trigger).
 */

export type CampaignPresetStep = {
  subject_template: string
  body: string
  /** Solo il richiamo si ferma davanti a un segnale: vedi sotto, passo 2. */
  only_without_engagement?: boolean
}

export type CampaignPreset = {
  vertical: string
  /** Etichetta nel selettore di "Nuova campagna". */
  label: string
  description: string
  name: string
  list_name: string
  event_tag: string
  brand_eyebrow: string
  landing_url: string
  cadence_days: number[]
  steps: CampaignPresetStep[]
}

/**
 * Consorzi di tutela e di promozione (vino, food DOP/IGP, turistici).
 *
 * Il destinatario non e un'azienda che vende un prodotto: e un ente che
 * promuove una denominazione **e** i suoi soci. Da qui le tre scelte di copy
 * che distinguono questa sequenza da quella Hospitality:
 *
 * - **Il patrimonio informativo esiste gia** (disciplinare, storia, soci,
 *   itinerari, materiali di fiera) e parla una lingua sola. Si parte da li,
 *   mai da un elenco di funzioni: il QR, la traduzione e il concierge non sono
 *   il prodotto.
 * - **I soci sono il moltiplicatore**: il passo 3 e l'unico argomento che un
 *   consorzio non sente da nessun altro fornitore — una base sola per l'ente,
 *   una scheda per ciascun socio, senza moltiplicare il lavoro per il loro
 *   numero.
 * - **Una domanda sola per email.** Il link e la prova, non una seconda
 *   richiesta: due richieste in fondo a una email fredda istituzionale ne
 *   annullano una.
 *
 * Forma di cortesia ovunque, nessun riferimento ad aperture o click (che il
 * motore conosce ma che non si dichiarano mai), prove solo fra quelle
 * verificate: le cantine gia clienti, il GAL Molise, il servizio Rai 3.
 */
const CONSORZI: CampaignPreset = {
  vertical: 'consorzi',
  label: 'Consorzi di tutela e promozione',
  description:
    'Cinque email a consorzi di tutela e promozione: patrimonio informativo del consorzio, scena concreta, i soci, i mercati esteri, chiusura.',
  name: 'Consorzi Italia 2026 · Sequenza 5 email',
  list_name: 'Consorzi Italia 2026',
  event_tag: 'consorzi-2026',
  brand_eyebrow: 'SPEAQI · CONSORZI E TERRITORI',
  landing_url: 'https://speaqi.com/destinations',
  cadence_days: [1, 4, 9, 16, 28],
  steps: [
    {
      subject_template: '{{azienda}}: chi arriva non parla italiano',
      body: `{{saluto}}

sono Massimo Morgante, fondatore di Speaqi.

Un consorzio ha già tutto: disciplinare, storia della denominazione, soci, prodotti, itinerari, materiali di fiera. Quasi sempre in una lingua sola, e sparso fra sito, brochure, PDF e pannelli.

Speaqi raccoglie quel patrimonio in un'unica base informativa e lo rende consultabile in oltre 50 lingue: da una pagina web, da un QR su un cartello, su un collarino o su un materiale di fiera. Chi arriva non scarica nulla, inquadra e legge, ascolta o guarda nella propria lingua. Quando un'informazione cambia si aggiorna una volta sola e vale ovunque, senza ristampe.

Qui è raccontato come funziona su un territorio: {{landing_url}}

Sarebbe possibile una call di quindici minuti con lei o con chi segue la promozione di {{azienda}}?

Cordiali saluti,`,
    },
    {
      // Il richiamo a tre giorni e l'unico passo che si ferma davanti a un
      // segnale: chi ha gia aperto non ha bisogno di sentirsi dire "torno
      // sulla mia email precedente".
      only_without_engagement: true,
      subject_template: 'Un esempio concreto per {{azienda}}',
      body: `{{saluto}}

sono Massimo Morgante, fondatore di Speaqi.

Torno brevemente sulla mia email precedente, con una scena concreta.

Un buyer tedesco davanti al vostro banco in fiera inquadra il QR sul materiale del consorzio: trova la denominazione, i soci e i prodotti spiegati in tedesco, con audio e video, e può fare domande ricevendo risposte basate solo su quello che il consorzio ha pubblicato. La stessa pagina, in inglese, la apre un visitatore fermo davanti a un cartello sul territorio.

È lo stesso contenuto, scritto una volta: {{landing_url}}

Mi indichi un giorno e le mostro come funzionerebbe per {{azienda}}: quindici minuti.

Cordiali saluti,`,
    },
    {
      subject_template: 'I soci di {{azienda}}, ognuno con la propria pagina',
      body: `{{saluto}}

sono Massimo Morgante, fondatore di Speaqi.

La difficoltà di un consorzio non è raccontare la denominazione: è farlo per tutti i soci senza moltiplicare il lavoro per il loro numero.

Con Speaqi il consorzio tiene una base unica — territorio, denominazione, itinerari — e ogni socio ha dentro la propria scheda: azienda, prodotti, visite, contatti. Una mappa sola porta a tutti, e ogni socio può usare il proprio QR su bottiglia, confezione o punto vendita. Il consorzio aggiorna il proprio racconto, il socio il suo, e le lingue seguono da sole.

Stiamo lavorando così con cantine come San Salvatore, Dalibra e Leonarda Tardi, e con enti territoriali come il GAL Molise. Il modello è questo: {{landing_url}}

Vuole che prepari la pagina di esempio di uno dei vostri soci, così la guarda con calma?

Cordiali saluti,`,
    },
    {
      subject_template: '{{azienda}} e i mercati esteri',
      body: `{{saluto}}

sono Massimo Morgante, fondatore di Speaqi.

Ogni fiera e ogni delegazione estera chiede lo stesso lavoro: tradurre di nuovo materiali che esistono già, stamparli, e ritrovarsi mesi dopo con versioni che non coincidono più fra loro.

Speaqi toglie quel passaggio. Il consorzio mantiene una fonte sola: da lì escono le pagine nelle lingue dei mercati, i QR sui materiali e i contenuti audio e video. Chi riceve il materiale in fiera se lo riporta a casa e lo ritrova aggiornato, nella propria lingua.

Rai 3 ha raccontato il progetto in un servizio dedicato: https://www.youtube.com/watch?v=HMb5XQEY4cM

Come si applica a un territorio è spiegato qui: {{landing_url}}

Mi indichi un momento buono e la chiamo io: quindici minuti, per capire se ha senso per {{azienda}}.

Cordiali saluti,`,
    },
    {
      subject_template: 'Ultimo messaggio da parte mia',
      body: `{{saluto}}

sono Massimo Morgante, fondatore di Speaqi.

Chiudo qui i miei messaggi, per non disturbarla oltre.

Se il tema tornerà utile — una fiera da preparare, un percorso sul territorio, i soci da raccontare a chi non parla italiano — mi scriva a questo indirizzo o mi chiami al +39 389 686 8162: ripartiamo da dove serve a voi.

Intanto lascio qui come funziona, se vorrà guardarlo con calma: {{landing_url}}

Grazie per l'attenzione e buon lavoro.

Cordiali saluti,`,
    },
  ],
}

export const CAMPAIGN_PRESETS: CampaignPreset[] = [CONSORZI]

/** Il preset di un verticale, se esiste. Un verticale sconosciuto non e un errore. */
export function campaignPreset(vertical?: string | null): CampaignPreset | null {
  const key = String(vertical || '').trim().toLowerCase()
  if (!key) return null
  return CAMPAIGN_PRESETS.find((preset) => preset.vertical === key) || null
}

/** Righe per il selettore di "Nuova campagna": nessun testo, solo cosa si sceglie. */
export function campaignPresetOptions() {
  return CAMPAIGN_PRESETS.map((preset) => ({
    vertical: preset.vertical,
    label: preset.label,
    description: preset.description,
    name: preset.name,
    event_tag: preset.event_tag,
    steps: preset.steps.length,
  }))
}
