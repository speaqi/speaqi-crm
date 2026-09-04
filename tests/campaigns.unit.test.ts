import assert from 'node:assert/strict'
import { beforeEach, describe, mock, test } from 'node:test'
import { FakeSupabase } from './fake-supabase'
import {
  applyEnrollableContactFilter,
  campaignSlug,
  classifyImportCandidate,
  defaultCampaignSteps,
  enrollCampaignContacts,
  ensureCampaignSteps,
  structureKey,
  type CommercialCampaign,
} from '../src/lib/server/commercial-campaigns'

const USER = 'user-1'

function campaign(overrides: Partial<CommercialCampaign> = {}): CommercialCampaign {
  return {
    id: 'camp-1', user_id: USER, vertical: 'consorzi', name: 'Consorzi 2026',
    slug: 'consorzi-2026', list_name: 'Consorzi', event_tag: 'consorzi-2026',
    status: 'active', approval_status: 'approved', daily_cap: 100, daily_enrollment_cap: 30,
    sender_name: 'Massimo Morgante', sender_email: 'info@speaqi.com', reply_to: null,
    acumbamail_list_id: null, cadence_days: [1, 4, 9, 16, 28],
    brand_eyebrow: null, landing_url: 'https://speaqi.com/demo',
    import_exclude_keyword: null, import_required_country: null,
    require_marketing_attestation: false, stop_on_open: false, stop_on_click: false,
    ...overrides,
  }
}

function contact(index: number, overrides: Record<string, any> = {}) {
  return {
    id: `c-${String(index).padStart(3, '0')}`,
    user_id: USER,
    name: `Contatto ${index}`,
    company: `Azienda ${index}`,
    email: `contatto${index}@example.it`,
    status: 'New',
    event_tag: 'consorzi-2026',
    marketing_eligibility: 'eligible',
    email_unsubscribed_at: null,
    alternative_emails: [],
    source_place_id: null,
    source_google_id: null,
    normalized_website: null,
    ...overrides,
  }
}

/** Prenotazione atomica simulata: stessa aritmetica della funzione SQL. */
function capRpcs(state: { cap: number; used: number }) {
  return {
    reserve_commercial_enrollment_slots: (args: Record<string, any>) => {
      const granted = Math.max(0, Math.min(Number(args.p_wanted) || 0, state.cap - state.used))
      state.used += granted
      return granted
    },
    settle_commercial_enrollment_slots: (args: Record<string, any>) => {
      state.used -= Math.max(0, Number(args.p_reserved) || 0) - Math.max(0, Number(args.p_used) || 0)
      return null
    },
  }
}

describe('slug e chiavi', () => {
  test('lo slug e minuscolo, senza accenti e senza spazi', () => {
    assert.equal(campaignSlug('Consorzi Città 2026'), 'consorzi-citta-2026')
    assert.equal(campaignSlug('  --Ciao--  '), 'ciao')
    assert.equal(campaignSlug(''), '')
  })

  test('la chiave struttura preferisce il place id, poi il sito, poi la email', () => {
    assert.equal(structureKey({ source_place_id: 'X1', email: 'a@b.it' }), 'place:X1')
    assert.equal(structureKey({ normalized_website: 'https://WWW.Hotel.it/x', email: 'a@b.it' }), 'site:hotel.it')
    assert.equal(structureKey({ email: 'A@B.it' }), 'email:a@b.it')
  })
})

describe('filtri di import', () => {
  test('senza criteri configurati nessun record viene scartato', () => {
    const target = campaign()
    assert.equal(classifyImportCandidate(target, { email: 'a@b.it', company: 'Consorzio Alfa', country: 'FRANCIA' }), 'enroll')
  })

  test('la parola esclusa scarta il record', () => {
    const target = campaign({ import_exclude_keyword: 'consorzio' })
    assert.equal(classifyImportCandidate(target, { email: 'a@b.it', company: 'Consorzio Alfa' }), 'exclude')
    assert.equal(classifyImportCandidate(target, { email: 'a@b.it', company: 'Cantina Alfa' }), 'enroll')
  })

  test('il paese diverso parcheggia invece di scartare', () => {
    const target = campaign({ import_required_country: 'ITALIA' })
    assert.equal(classifyImportCandidate(target, { email: 'a@b.it', country: 'Italia' }), 'enroll')
    assert.equal(classifyImportCandidate(target, { email: 'a@b.it', country: ' italia ' }), 'enroll')
    assert.equal(classifyImportCandidate(target, { email: 'a@b.it', country: 'FRANCIA' }), 'park')
    assert.equal(classifyImportCandidate(target, { email: 'a@b.it', country: null }), 'park')
  })
})

describe('step predefiniti', () => {
  test('la campagna nasce con cinque email utilizzabili', () => {
    const steps = defaultCampaignSteps(campaign())
    assert.equal(steps.length, 5)
    assert.deepEqual(steps.map((step) => step.day_offset), [1, 4, 9, 16, 28])
    assert.ok(steps.every((step) => step.body_text_template.includes('{{landing_url}}')))
    assert.equal(steps.filter((step) => step.only_without_engagement).length, 1)
  })

  test('ensureCampaignSteps non riscrive uno step esistente', async () => {
    const target = campaign()
    const db = new FakeSupabase({
      commercial_campaign_steps: [
        { id: 's1', campaign_id: target.id, step_number: 1, day_offset: 1, subject_template: 'Scritto a mano', body_text_template: 'Testo mio', body_html_template: '', only_without_engagement: false },
      ],
    })
    const steps = await ensureCampaignSteps(db, target)
    assert.equal(steps.length, 5)
    assert.equal(steps[0].subject_template, 'Scritto a mano')
  })
})

describe('definizione di contatto arruolabile', () => {
  // La scheda della campagna conta gli arruolabili con lo stesso filtro che usa
  // il motore per pescarli. Se i due divergessero, la pagina mostrerebbe un
  // bacino pieno accanto a zero arruolamenti, senza spiegare perche.
  test('la scheda conta esattamente i contatti che il motore arruolerebbe', async () => {
    const rows = [
      contact(1),
      contact(2, { marketing_eligibility: 'review' }),
      contact(3, { email_unsubscribed_at: '2026-01-01T00:00:00Z' }),
      contact(4, { status: 'Paid' }),
      contact(5, { email: null }),
      contact(6, { event_tag: 'altra-campagna' }),
    ]
    const target = campaign()
    const state = { cap: 30, used: 0 }

    const counter = new FakeSupabase({ contacts: rows }, capRpcs(state))
    const counted = await applyEnrollableContactFilter(
      counter.from('contacts').select('id', { count: 'exact', head: true }),
      target
    )

    const engine = new FakeSupabase({ contacts: rows.map((row) => ({ ...row })) }, capRpcs(state))
    const report = await enrollCampaignContacts(engine, target, { limit: 30, dryRun: false })

    assert.equal(counted.count, 1)
    assert.equal(report.inserted, counted.count)
  })

  test('con attestazione richiesta il conteggio si stringe come l arruolamento', async () => {
    const rows = [
      contact(1),
      contact(2, { hospitality_filter_decision: 'include', marketing_legal_basis: 'legittimo interesse', marketing_source_acquired_at: '2026-01-01' }),
    ]
    const target = campaign({ require_marketing_attestation: true })
    const db = new FakeSupabase({ contacts: rows }, capRpcs({ cap: 30, used: 0 }))
    const counted = await applyEnrollableContactFilter(
      db.from('contacts').select('id', { count: 'exact', head: true }),
      target
    )
    assert.equal(counted.count, 1)
  })
})

describe('arruolamento', () => {
  let state: { cap: number; used: number }

  beforeEach(() => { state = { cap: 30, used: 0 } })

  test('riusa i contatti CRM che portano gia il tag', async () => {
    const db = new FakeSupabase(
      { contacts: Array.from({ length: 10 }, (_, index) => contact(index + 1)) },
      capRpcs(state)
    )
    const report = await enrollCampaignContacts(db, campaign(), { limit: 30, dryRun: false })
    assert.equal(report.granted, 30)
    assert.equal(report.from_crm, 10)
    assert.equal(report.inserted, 10)
    assert.equal(db.tables.commercial_enrollments.length, 10)
    // Ogni iscrizione nasce con la prima email gia programmata.
    assert.equal(db.tables.commercial_messages.length, 10)
    assert.ok(db.tables.commercial_messages.every((row) => row.step_number === 1 && row.status === 'scheduled'))
  })

  test('non arruola due volte lo stesso contatto', async () => {
    const db = new FakeSupabase(
      {
        contacts: [contact(1), contact(2)],
        commercial_enrollments: [
          { id: 'e1', campaign_id: 'camp-1', contact_id: 'c-001', structure_key: 'email:contatto1@example.it', primary_email: 'contatto1@example.it' },
        ],
      },
      capRpcs(state)
    )
    const report = await enrollCampaignContacts(db, campaign(), { limit: 30, dryRun: false })
    assert.equal(report.from_crm, 1)
    assert.equal(db.tables.commercial_enrollments.length, 2)
  })

  test('il tetto arruolamenti limita il giro e restituisce i posti non usati', async () => {
    state.used = 25
    const db = new FakeSupabase(
      { contacts: Array.from({ length: 20 }, (_, index) => contact(index + 1)) },
      capRpcs(state)
    )
    const report = await enrollCampaignContacts(db, campaign(), { limit: 30, dryRun: false })
    assert.equal(report.granted, 5)
    assert.equal(report.inserted, 5)
    // Tutti e cinque i posti prenotati sono stati usati: nulla torna indietro.
    assert.equal(state.used, 30)
  })

  test('il tetto invii non viene toccato dall arruolamento', async () => {
    const db = new FakeSupabase(
      { contacts: Array.from({ length: 50 }, (_, index) => contact(index + 1)) },
      capRpcs(state)
    )
    // daily_cap 100 (invii) e daily_enrollment_cap 30 (arruolamenti): il giro
    // si ferma a 30, non a 100.
    const report = await enrollCampaignContacts(db, campaign({ daily_cap: 100 }), { limit: 100, dryRun: false })
    assert.equal(report.granted, 30)
    assert.equal(report.inserted, 30)
  })

  test('salta disiscritti, non idonei e contatti chiusi', async () => {
    const db = new FakeSupabase(
      {
        contacts: [
          contact(1, { email_unsubscribed_at: '2026-01-01T00:00:00Z' }),
          contact(2, { marketing_eligibility: 'suppressed' }),
          contact(3, { status: 'Lost' }),
          contact(4),
        ],
      },
      capRpcs(state)
    )
    const report = await enrollCampaignContacts(db, campaign(), { limit: 30, dryRun: false })
    assert.equal(report.inserted, 1)
    assert.equal(db.tables.commercial_enrollments[0].primary_email, 'contatto4@example.it')
  })

  test('una email in blacklist non rientra da un altra struttura', async () => {
    const db = new FakeSupabase(
      {
        contacts: [contact(1), contact(2)],
        commercial_suppressions: [
          { id: 'sup-1', user_id: USER, campaign_id: null, structure_key: 'email:altro@example.it', email: 'contatto1@example.it', reason: 'unsubscribe' },
        ],
      },
      capRpcs(state)
    )
    const report = await enrollCampaignContacts(db, campaign(), { limit: 30, dryRun: false })
    assert.equal(report.inserted, 1)
    assert.equal(db.tables.commercial_enrollments[0].primary_email, 'contatto2@example.it')
  })

  test('la soppressione di un altra campagna non blocca questa', async () => {
    const db = new FakeSupabase(
      {
        contacts: [contact(1)],
        commercial_suppressions: [
          { id: 'sup-1', user_id: USER, campaign_id: 'camp-altra', structure_key: null, email: 'contatto1@example.it', reason: 'unsubscribe' },
        ],
      },
      capRpcs(state)
    )
    const report = await enrollCampaignContacts(db, campaign(), { limit: 30, dryRun: false })
    assert.equal(report.inserted, 1)
  })

  test('il dry run non prenota e non scrive nulla', async () => {
    const db = new FakeSupabase({ contacts: [contact(1), contact(2)] }, capRpcs(state))
    const report = await enrollCampaignContacts(db, campaign(), { limit: 30, dryRun: true })
    assert.equal(report.from_crm, 2)
    assert.equal(report.inserted, 0)
    assert.equal(state.used, 0)
    assert.equal((db.tables.commercial_enrollments || []).length, 0)
    assert.equal(db.calls.length, 0)
  })

  test('con attestazione richiesta arruola solo i contatti attestati', async () => {
    const db = new FakeSupabase(
      {
        contacts: [
          contact(1),
          contact(2, { hospitality_filter_decision: 'include', marketing_legal_basis: 'legittimo interesse', marketing_source_acquired_at: '2026-01-01' }),
        ],
      },
      capRpcs(state)
    )
    const report = await enrollCampaignContacts(db, campaign({ require_marketing_attestation: true }), { limit: 30, dryRun: false })
    assert.equal(report.inserted, 1)
    assert.equal(db.tables.commercial_enrollments[0].contact_id, 'c-002')
  })
})

describe('import dalla lista sorgente', () => {
  test('un errore sulla lista azzera quella fonte e viene dichiarato', async () => {
    const state = { cap: 30, used: 0 }
    const db = new FakeSupabase({ contacts: [contact(1)] }, capRpcs(state))
    process.env.ACUMBAMAIL_AUTH_TOKEN = ''
    const report = await enrollCampaignContacts(db, campaign({ acumbamail_list_id: '999' }), { limit: 30, dryRun: false })
    assert.equal(report.from_crm, 1)
    assert.equal(report.from_list, 0)
    assert.match(String(report.list_error), /ACUMBAMAIL_AUTH_TOKEN/)
    // L'arruolamento dal CRM e comunque andato a buon fine.
    assert.equal(report.inserted, 1)
  })
})
