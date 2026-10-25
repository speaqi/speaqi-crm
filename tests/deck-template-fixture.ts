import { DECK_TODO, normalizeTemplate } from '../src/lib/tourism-deck'

// Un modello di prova con segnaposto e slide libere: le guardie valgono per qualunque modello.
export const GENERIC = normalizeTemplate({
  base: 'prova',
  vars: { prezzo: 'in cambio garantite almeno 100.000 accessi all’anno', contatto: DECK_TODO },
  slides: [
    { id: 'cover', kind: 'cover', title: 'La mappa perfetta per {{ente}}' },
    { id: 'territorio', kind: 'cards', title: 'Tutto {{destinazione}} in una mappa sola', items: [
      { title: 'Luoghi da vedere', text: '[DA VERIFICARE: quanti] luoghi.' },
      { title: 'Itinerari', text: '[DA VERIFICARE: quanti] itinerari.' },
      { title: 'Strutture e servizi', text: '[DA VERIFICARE: quanti] servizi.' }
    ] },
    { id: 'problema', kind: 'statement', title: 'Oggi il visitatore scopre {{destinazione}} a pezzi.', body: 'Sette fonti diverse.' },
    { id: 'visitatore', kind: 'steps', title: 'Quattro passi', hint: 'Mantieni i passi.', items: [
      { title: 'Scansiona', text: 'a' }, { title: 'Lingua', text: 'b' }, { title: 'Esplora', text: 'c' }, { title: 'Chiede', text: 'd' }
    ] },
    { id: 'metodo', kind: 'steps', title: 'Cinque passi', items: [{ title: 'Analisi', text: 'a' }, { title: 'Costruzione', text: 'b' }] },
    { id: 'prezzo', kind: 'cards', title: 'La mappa è gratuita.', items: [{ title: 'Mappa', text: 'inclusa' }], note: 'In cambio: {{prezzo}}' },
    { id: 'demo', kind: 'closing', title: 'Guardate la mappa di {{ente}}', body: 'Partiamo. {{contatto}}' }
  ]
})

