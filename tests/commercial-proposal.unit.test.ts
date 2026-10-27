import { readFileSync } from 'node:fs'
import { AGENCY_GENERAL_TERMS, AGENCY_CONTRACT_CODE, agencyParticularTerms, ensureAgencyContractTerms, isAgencyContract } from '../src/lib/agency-contract'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { agencyBaseSlides, DEFAULT_AGENCY_SETTINGS, DEFAULT_AGENCY_SLIDES, normalizeAgencySettings } from '../src/lib/agency'
import { applyVars, TOURISM_COMPANY_TEMPLATE, normalizeTemplate } from '../src/lib/tourism-deck'
import { GENERIC } from './deck-template-fixture'
import { defaultQuoteTemplate, normalizeQuoteTemplate, proposalText, quoteCompletionIssues, quoteDraftFromTemplate } from '../src/lib/commercial-proposal'

test('Agency ha una base commerciale personalizzabile senza contaminare altri clienti', () => {
  const settings = normalizeAgencySettings({ ...DEFAULT_AGENCY_SETTINGS, contact: 'Mario · info@example.com' })
  const one = agencyBaseSlides(settings, { cliente: 'Alfa', progetto: 'Sito Alfa', contatto: settings.contact, servizi: 'Design' })
  const two = agencyBaseSlides(settings, { cliente: 'Beta', progetto: 'Sito Beta', contatto: settings.contact, servizi: 'SEO' })
  assert.equal(one[0].title, 'Sito Alfa')
  assert.equal(two[0].title, 'Sito Beta')
  assert.equal(one.at(-1)?.body, settings.contact)
  assert.ok(one.some(s => s.kind === 'investment'))
  assert.ok(one.some(s => s.kind === 'deliverables'))
  one[1].items.push({ title: 'Solo Alfa', text: '', value: '' })
  assert.ok(!JSON.stringify(two).includes('Solo Alfa'))
  assert.ok(!JSON.stringify(DEFAULT_AGENCY_SLIDES).includes('Solo Alfa'))
})

test('i due contratti e i modelli salvati sono separati e le vecchie basi restano leggibili', () => {
  assert.notEqual(defaultQuoteTemplate('agency').contract_terms, defaultQuoteTemplate('tourism').contract_terms)
  const template = normalizeTemplate({ ...GENERIC, quote_template: { ...defaultQuoteTemplate('tourism'), contract_terms: 'Accordo approvato per {{ente}}' } })
  assert.equal(template.quote_template?.contract_terms, 'Accordo approvato per {{ente}}')
  const slides = applyVars(template, { ente: 'Ente Alfa', destinazione: 'Alfa' })
  assert.match(slides[0].title, /Ente Alfa/)
  assert.equal(normalizeAgencySettings({}).proposal_slides?.length, DEFAULT_AGENCY_SLIDES.length)
})

test('un prezzo assente richiede conferma; lo zero esplicito resta gratuito', () => {
  const template = normalizeQuoteTemplate({ items: [{ description: 'Servizio {{cliente}}', unit_price: null }, { description: 'Incluso', unit_price: 0 }], contract_terms: 'Accordo approvato' }, 'agency')
  const draft = quoteDraftFromTemplate(template, { cliente: 'Alfa' })
  assert.equal(draft.status, 'draft')
  assert.equal(draft.items[0].description, 'Servizio Alfa')
  assert.match(draft.items[0].details || '', /DA VERIFICARE/)
  assert.equal(draft.items[1].unit_price, 0)
  assert.equal(draft.items[1].details, '')
  assert.equal(quoteCompletionIssues(draft).length, 1)
  draft.items[0].details = 'Confermato'
  assert.equal(quoteCompletionIssues(draft).length, 0)
  assert.equal(template.items[0].unit_price, null)
})

test('segnaposto: nessuna sostituzione ricorsiva e nessuna interpretazione dei dollari', () => {
  assert.equal(proposalText('{{cliente}} / {{mancante}}', { cliente: '$& {{ente}}' }), '$& {{ente}} / [DA VERIFICARE: mancante]')
  assert.equal(quoteCompletionIssues({ contract_terms: '{{cliente}}' }).length, 1)
  assert.equal(quoteCompletionIssues({ contract_terms: '[DA VERIFICARE oppure NON APPLICABILE]' }).length, 1)
})

test('le alternative non selezionate non bloccano il contratto', () => {
  const items = [{ choice_group_id: 'g', selected: false, details: '[DA VERIFICARE]' }, { choice_group_id: 'g', selected: true, details: 'Concordato' }]
  assert.equal(quoteCompletionIssues({ contract_terms: 'Approvato', items }).length, 0)
  items[0].selected = true
  assert.equal(quoteCompletionIssues({ contract_terms: 'Approvato', items }).length, 1)
})

test('la base Tourism aziende non eredita gratuità e soglie della partnership destinazioni', () => {
  const slides = applyVars(TOURISM_COMPANY_TEMPLATE, { ente: 'Hotel Alfa', destinazione: 'Capri', contatto: 'info@example.com' })
  const text = JSON.stringify(slides)
  assert.equal(slides.length, 12)
  assert.match(slides[0].title, /Hotel Alfa/)
  assert.doesNotMatch(text, /100\.000|mappa è gratuita|500 punti/)
  assert.match(text, /preventivo e nel contratto/)
  assert.match(text, /30 giorni/)
})

test('Agency usa integralmente il documento approvato, anche nei modelli personalizzati', () => {
  assert.equal(AGENCY_GENERAL_TERMS, readFileSync(new URL('../public/contratti/SPEAQI-AGENCY-CGC-v1.0.txt', import.meta.url), 'utf8').trim())
  assert.equal(defaultQuoteTemplate('agency').contract_terms, AGENCY_GENERAL_TERMS)
  const template = normalizeQuoteTemplate({ contract_terms: 'Consegna entro 30 giorni per {{cliente}}' }, 'agency')
  const draft = quoteDraftFromTemplate(template, { cliente: 'Alfa' })
  assert.ok(draft.contract_terms.startsWith(AGENCY_GENERAL_TERMS))
  assert.equal(agencyParticularTerms(draft.contract_terms), 'Consegna entro 30 giorni per Alfa')
  assert.equal(ensureAgencyContractTerms(draft.contract_terms), draft.contract_terms)
  const tampered = draft.contract_terms.replace('Foro di Napoli', 'Foro di Milano')
  assert.ok(ensureAgencyContractTerms(tampered).startsWith(AGENCY_GENERAL_TERMS))
  assert.equal(agencyParticularTerms(ensureAgencyContractTerms(tampered)), 'Consegna entro 30 giorni per Alfa')
  assert.equal(isAgencyContract({ contract_terms: AGENCY_CONTRACT_CODE }), true)
  assert.equal(isAgencyContract({ agency_project_id: 'agency-id' }), true)
  assert.equal(isAgencyContract({ contract_terms: defaultQuoteTemplate('tourism').contract_terms }), false)
})

test('la vecchia base Agency viene sostituita senza trascinare segnaposto obsoleti', () => {
  const template = normalizeQuoteTemplate({ contract_terms: 'ACCORDO DI SERVIZI — SPEAQI AGENCY\n[DA VERIFICARE]' }, 'agency')
  assert.equal(template.contract_terms, AGENCY_GENERAL_TERMS)
  assert.equal(quoteCompletionIssues(template).length, 0)
})

test('i preventivi Agency precedenti non possono essere inviati senza le condizioni obbligatorie', () => {
  assert.equal(quoteCompletionIssues({ agency_project_id: 'p', contract_terms: 'Condizioni precedenti personalizzate' }).length, 1)
  assert.equal(quoteCompletionIssues({ agency_project_id: 'p', contract_terms: AGENCY_GENERAL_TERMS }).length, 0)
})
