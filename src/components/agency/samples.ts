import { normalizeSlide, type AgencySlide, type QuoteSummary, type SlideKind } from '@/lib/agency'

// Contenuti d'esempio per la galleria dei layout (Template). Sono esempi dichiarati:
// non finiscono mai in una presentazione.

const item = (title: string, text = '', value = '') => ({ title, text, value })

const RAW: Record<SlideKind, Partial<AgencySlide>> = {
  cover: { kicker: 'Proposta', title: 'Un sito che lavora mentre dormi', body: 'Proposta per Cantina Esempio' },
  agenda: { title: 'Di cosa parliamo', items: [item('Dove siete oggi'), item('Cosa proponiamo'), item('Come lavoriamo'), item('Investimento e prossimi passi')] },
  section: { kicker: 'Capitolo', title: 'La proposta' },
  statement: { kicker: 'In una frase', title: 'Raccontate il vostro valore una volta, ovunque.', body: 'Un sistema unico per sito, social e motori AI.' },
  context: { kicker: 'Contesto', title: 'Un marchio forte, un sito che non lo dice', body: 'Clienti fedeli, prodotto riconosciuto, ma pochi contatti dal web.', items: [item('Sito del 2018', 'Non pensato per il mobile.'), item('Nessun dato', 'Le visite non si misurano.')] },
  problems: { kicker: 'Problemi', title: 'Oggi tre ostacoli frenano le richieste', items: [item('Lento da mobile', 'Chi arriva da telefono se ne va.'), item('Invisibile alle AI', 'I motori generativi non vi citano.'), item('Nessuna misura', 'Non sapete cosa funziona.')] },
  opportunities: { kicker: 'Opportunità', title: 'Tre spazi da occupare prima degli altri', items: [item('Ricerca locale', 'Chi cerca vicino a voi.'), item('Risposte AI', 'Essere la fonte citata.'), item('Export', 'Mercati in lingua.')] },
  solution: { kicker: 'Soluzione', title: 'Un ecosistema digitale, non un sito in più', body: 'Strategia, design e tecnologia nello stesso progetto.', items: [item('Posizionamento', 'Cosa dire e a chi.'), item('Piattaforma', 'Sito veloce e misurabile.'), item('Crescita', 'SEO, GEO e campagne.')] },
  services: { kicker: 'Servizi', title: 'Cosa facciamo insieme', items: [item('Brand', 'Identità e linee guida.'), item('Sito', 'Design e sviluppo.'), item('SEO e GEO', 'Ricerca e motori AI.'), item('Contenuti', 'Testi, foto, video.')] },
  process: { kicker: 'Metodo', title: 'Quattro fasi, un responsabile per fase', items: [item('Analisi', 'Ascoltiamo e misuriamo.'), item('Strategia', 'Decidiamo insieme.'), item('Produzione', 'Design e sviluppo.'), item('Lancio', 'Online e misurato.')] },
  roadmap: { kicker: 'Roadmap', title: 'Dal kickoff al lancio', items: [item('Analisi', 'Workshop e audit.', 'Fase 1'), item('Design', 'Concept e prototipi.', 'Fase 2'), item('Sviluppo', 'Sito e contenuti.', 'Fase 3'), item('Lancio', 'Messa online.', 'Fase 4')] },
  deliverables: { kicker: 'Deliverable', title: 'Cosa ricevete', items: [item('Brand book', 'Logo, colori, tipografia.'), item('Sito web', 'Responsive, in due lingue.'), item('Piano SEO', 'Parole chiave e contenuti.'), item('Report', 'Cruscotto dei risultati.')] },
  benefits: { kicker: 'Benefici', title: 'Cosa cambia per voi', items: [item('Più richieste', 'Un percorso chiaro verso il contatto.'), item('Meno tempo', 'Aggiornate da soli.'), item('Più fiducia', 'Un marchio coerente.')] },
  metrics: { kicker: 'Numeri', title: 'Il punto di partenza', items: [item('Visite al mese', 'Dal vostro analytics.', '12.400'), item('Da mobile', 'Quota delle visite.', '68%'), item('Contatti', 'Moduli inviati.', '35')], note: 'Fonte: esempio' },
  chart: { kicker: 'Dati', title: 'Da dove arrivano le visite', items: [item('Ricerca', '', '48'), item('Diretto', '', '27'), item('Social', '', '15'), item('Referral', '', '10')], note: 'Valori in percentuale, esempio' },
  comparison: { kicker: 'Prima e dopo', title: 'Dove siete, dove arrivate', items: [item('Oggi', 'Sito lento\nNessun dato\nContenuti in una lingua'), item('Con il progetto', 'Sito veloce\nCruscotto chiaro\nContenuti in tre lingue')] },
  quote: { title: 'Vogliamo che chi ci trova online capisca subito chi siamo.', note: 'Direzione, dal brief' },
  investment: { kicker: 'Investimento', title: 'L’investimento', body: 'Le cifre arrivano dal preventivo collegato.' },
  next_steps: { kicker: 'Prossimi passi', title: 'Partiamo così', items: [item('Conferma', 'Firmate la proposta.'), item('Kickoff', 'Workshop di avvio.'), item('Prima consegna', 'Concept da approvare.')] },
  closing: { kicker: 'Grazie', title: 'Costruiamolo insieme', body: 'Scriveteci: rispondiamo in giornata.' }
}

export const SAMPLE_SLIDES: Record<SlideKind, AgencySlide> = Object.fromEntries(
  Object.entries(RAW).map(([kind, raw]) => [kind, normalizeSlide({ ...raw, id: kind, kind })])
) as Record<SlideKind, AgencySlide>

export const SAMPLE_QUOTE: QuoteSummary = {
  id: 'sample',
  number: 'PREV-ESEMPIO',
  title: 'Esempio',
  status: 'sent',
  currency: 'EUR',
  billing_interval: 'one_time',
  lines: [
    { description: 'Strategia e brand', details: 'Workshop, posizionamento, identità', quantity: 1, total: 4000, list_total: null },
    { description: 'Sito web', details: 'Design e sviluppo', quantity: 1, total: 9000, list_total: null },
    { description: 'SEO e GEO', details: 'Primo trimestre', quantity: 1, total: 2400, list_total: null }
  ],
  subtotal: 15400,
  discount: 0,
  tax_rate: 22,
  tax: 3388,
  total: 18788,
  valid_until: null,
  deposit_net: 6160,
  balance_net: 9240,
  payment_note: 'Saldo alla messa online.',
  note: '',
  public_token: null,
  updated_at: null
}
