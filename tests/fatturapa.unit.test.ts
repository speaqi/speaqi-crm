import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildFatturaXml,
  computeFeTotals,
  feDestinatario,
  feText,
  grossToNetLine,
  isValidPartitaIva,
  progressivoInvio,
  quoteItemsToFeLines,
  splitComuneProvincia,
  validateFeInput,
  type FeInvoiceInput,
} from '../src/lib/fatturapa'

const seller = {
  denominazione: 'TheBestItaly',
  partitaIva: '10831191217',
  codiceFiscale: '95125440636',
  regimeFiscale: 'RF01',
  indirizzo: 'Via Toledo 1',
  cap: '80134',
  comune: 'Napoli',
  provincia: 'NA',
  iban: 'IT60 X054 2811 1010 0000 0123 456',
}

function input(overrides: Partial<FeInvoiceInput> = {}): FeInvoiceInput {
  return {
    seller,
    customer: {
      denominazione: 'Hotel Bellavista S.r.l.',
      partitaIva: '01234567897',
      codiceDestinatario: 'M5UXCR1',
      indirizzo: 'Corso Italia 10',
      cap: '80067',
      comune: 'Sorrento',
      provincia: 'NA',
    },
    numero: '12',
    data: '2026-10-22',
    progressivoInvio: progressivoInvio(2026, 12, 1),
    lines: [{ description: 'Video nella mappa', quantity: 1, unitPrice: 400, vatRate: 22 }],
    paymentMethod: 'MP08',
    ...overrides,
  }
}

describe('fatturapa', () => {
  it('controlla la partita IVA', () => {
    assert.equal(isValidPartitaIva('10831191217'), true)
    assert.equal(isValidPartitaIva('IT 10831191217'), true)
    assert.equal(isValidPartitaIva('10831191218'), false)
    assert.equal(isValidPartitaIva('123'), false)
  })

  it('calcola imposta e totale in centesimi, sul riepilogo', () => {
    const totals = computeFeTotals([
      { description: 'a', quantity: 3, unitPrice: 0.1, vatRate: 22 },
      { description: 'b', quantity: 1, unitPrice: 0.2, vatRate: 22 },
    ])
    assert.equal(totals.imponibileCents, 50)
    assert.equal(totals.impostaCents, 11)
    assert.equal(totals.totaleCents, 61)
  })

  it('400 + IVA = 488', () => {
    assert.equal(computeFeTotals(input().lines).totaleCents, 48800)
  })

  it('un incasso IVA compresa torna netto senza perdere il centesimo', () => {
    const line = grossToNetLine('Rinnovo', 488, 22)
    assert.equal(line.unitPrice, 400)
    assert.equal(computeFeTotals([line]).totaleCents, 48800)
  })

  it('aggiunge il bollo solo senza IVA e sopra 77,47', () => {
    const lines = [{ description: 'x', quantity: 1, unitPrice: 100, vatRate: 0 }]
    assert.equal(computeFeTotals(lines, { bolloVirtuale: true, naturaEsente: 'N2.2' }).bolloCents, 200)
    assert.equal(computeFeTotals([{ ...lines[0], unitPrice: 50 }], { bolloVirtuale: true }).bolloCents, 0)
    assert.equal(computeFeTotals(lines).bolloCents, 0)
  })

  it('codice destinatario, PEC e cliente estero', () => {
    assert.deepEqual(feDestinatario({ ...input().customer, codiceDestinatario: 'm5uxcr1' }), { codice: 'M5UXCR1', pec: null })
    assert.deepEqual(feDestinatario({ ...input().customer, codiceDestinatario: '', pec: 'a@pec.it' }), { codice: '0000000', pec: 'a@pec.it' })
    assert.deepEqual(feDestinatario({ ...input().customer, nazione: 'DE' }), { codice: 'XXXXXXX', pec: null })
  })

  it('separa comune e provincia solo quando la sigla c’e’ davvero', () => {
    assert.deepEqual(splitComuneProvincia('Napoli (NA)'), { comune: 'Napoli', provincia: 'NA' })
    assert.deepEqual(splitComuneProvincia('Sorrento NA'), { comune: 'Sorrento', provincia: 'NA' })
    assert.deepEqual(splitComuneProvincia('Bari'), { comune: 'Bari', provincia: null })
  })

  it('ripulisce il testo per lo SDI', () => {
    assert.equal(feText('“Mappa” – 400 € …'), '"Mappa" - 400 EUR ...')
    assert.equal(feText('riga\nnuova\temoji 🚢'), 'riga nuova emoji')
  })

  it('genera un XML FPR12 con i campi obbligatori', () => {
    const out = buildFatturaXml(input())
    assert.match(out, /^<\?xml version="1\.0" encoding="UTF-8"\?><p:FatturaElettronica versione="FPR12"/)
    assert.match(out, /<CodiceDestinatario>M5UXCR1<\/CodiceDestinatario>/)
    assert.match(out, /<IdFiscaleIVA><IdPaese>IT<\/IdPaese><IdCodice>10831191217<\/IdCodice><\/IdFiscaleIVA><CodiceFiscale>95125440636<\/CodiceFiscale>/)
    assert.match(out, /<RegimeFiscale>RF01<\/RegimeFiscale>/)
    assert.match(out, /<ImportoTotaleDocumento>488\.00<\/ImportoTotaleDocumento>/)
    assert.match(out, /<PrezzoUnitario>400\.00<\/PrezzoUnitario><PrezzoTotale>400\.00<\/PrezzoTotale><AliquotaIVA>22\.00<\/AliquotaIVA>/)
    assert.match(out, /<ImponibileImporto>400\.00<\/ImponibileImporto><Imposta>88\.00<\/Imposta><EsigibilitaIVA>I<\/EsigibilitaIVA>/)
    assert.match(out, /<ModalitaPagamento>MP08<\/ModalitaPagamento><ImportoPagamento>488\.00<\/ImportoPagamento><\/DettaglioPagamento>/)
    assert.doesNotMatch(out, /<IBAN>/)
  })

  it('con il bonifico scrive l’IBAN, con la PEC il destinatario 0000000', () => {
    const out = buildFatturaXml(input({ paymentMethod: 'MP05', customer: { ...input().customer, codiceDestinatario: null, pec: 'hotel@pec.it' } }))
    assert.match(out, /<IBAN>IT60X0542811101000000123456<\/IBAN>/)
    assert.match(out, /<CodiceDestinatario>0000000<\/CodiceDestinatario><PECDestinatario>hotel@pec.it<\/PECDestinatario>/)
  })

  it('le righe senza IVA vogliono la natura', () => {
    const lines = [{ description: 'x', quantity: 1, unitPrice: 100, vatRate: 0 }]
    assert.ok(validateFeInput(input({ lines })).some((e) => e.includes('natura')))
    const out = buildFatturaXml(input({ lines, naturaEsente: 'N2.2', bolloVirtuale: true }))
    assert.match(out, /<AliquotaIVA>0\.00<\/AliquotaIVA><Natura>N2\.2<\/Natura>/)
    assert.match(out, /<DatiBollo><BolloVirtuale>SI<\/BolloVirtuale><ImportoBollo>2\.00<\/ImportoBollo><\/DatiBollo><ImportoTotaleDocumento>102\.00/)
  })

  it('rifiuta i dati che lo SDI scarterebbe, con messaggi leggibili', () => {
    const errors = validateFeInput(input({ seller: { ...seller, partitaIva: '123' }, customer: { ...input().customer, cap: '801', partitaIva: '', codiceFiscale: '' } }))
    assert.ok(errors.some((e) => e.includes('partita IVA di chi emette')))
    assert.ok(errors.some((e) => e.includes('CAP del cliente')))
    assert.ok(errors.some((e) => e.includes('partita IVA o il codice fiscale del cliente')))
    assert.throws(() => buildFatturaXml(input({ lines: [] })), /non ha righe/)
  })

  it('cliente con partita IVA ma senza codice destinatario ne’ PEC: si ferma', () => {
    const errors = validateFeInput(input({ customer: { ...input().customer, codiceDestinatario: '', pec: '' } }))
    assert.ok(errors.some((e) => e.includes('cassetto fiscale')))
  })

  it('privato con solo codice fiscale', () => {
    const out = buildFatturaXml(input({ customer: { denominazione: 'Mario Rossi', codiceFiscale: 'RSSMRA80A01F839W', indirizzo: 'Via Roma 1', cap: '80100', comune: 'Napoli' } }))
    assert.doesNotMatch(out, /<CessionarioCommittente><DatiAnagrafici><IdFiscaleIVA>/)
    assert.match(out, /<CodiceFiscale>RSSMRA80A01F839W<\/CodiceFiscale>/)
    assert.match(out, /<CodiceDestinatario>0000000<\/CodiceDestinatario><\/DatiTrasmissione>/)
  })

  it('preventivo -> righe: solo le alternative scelte, sconto in negativo', () => {
    const lines = quoteItemsToFeLines(
      [
        { description: 'Piattaforma', quantity: 1, unit_price: 990 },
        { description: '1 anno', unit_price: 400, choice_group_id: 'g', selected: true },
        { description: '2 anni', unit_price: 700, choice_group_id: 'g', selected: false },
      ],
      22,
      90
    )
    assert.deepEqual(lines.map((l) => [l.description, l.unitPrice]), [['Piattaforma', 990], ['1 anno', 400], ['Sconto', -90]])
    assert.equal(computeFeTotals(lines).imponibileCents, 130000)
  })

  it('progressivo di invio: corto, alfanumerico, diverso a ogni tentativo', () => {
    const a = progressivoInvio(2026, 12, 1)
    assert.match(a, /^[A-Z0-9]{1,10}$/)
    assert.notEqual(a, progressivoInvio(2026, 12, 2))
    assert.notEqual(a, progressivoInvio(2027, 12, 1))
  })
})
